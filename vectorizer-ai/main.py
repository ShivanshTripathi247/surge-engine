"""
Phase 3 — Semantic Vectorizer (wiki-scale, CUDA)
- Streams unvectorized documents from a server-side cursor (no OOM).
- Encodes title + content with all-MiniLM-L6-v2 (384-dim) on GPU.
- Writes vectors back via pgvector. Resumable: WHERE vector IS NULL.
"""
import os
import sys
import time
import uuid
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_batch
from pgvector.psycopg2 import register_vector
from sentence_transformers import SentenceTransformer
from tqdm import tqdm
import torch

DSN = os.environ.get(
    "PG_DSN",
    "host=localhost port=5433 dbname=surge_wiki user=surge_admin password=local_dev_pwd",
)
MODEL_NAME = "all-MiniLM-L6-v2"
DB_CHUNK = 5000          # rows fetched from Postgres per round-trip
ENCODE_BATCH = 512       # batch size handed to the GPU
MAX_CHARS = 4000         # truncate before tokenizer to keep input bounded
CHECKPOINT_EVERY = 100_000
VRAM_LIMIT_GB = 3.5

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
ERROR_LOG = LOG_DIR / "vectorizer_errors.log"

BAR = "━" * 40


def connect():
    conn = psycopg2.connect(DSN)
    register_vector(conn)
    return conn


def fmt_hms(seconds: float) -> str:
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def vram_stats():
    if not torch.cuda.is_available():
        return 0.0, 0.0
    used = torch.cuda.memory_allocated() / (1024 ** 3)
    total = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    return used, total


def log_errors(ids, exc):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    with ERROR_LOG.open("a") as f:
        for doc_id in ids:
            f.write(f"{ts}\t{doc_id}\t{type(exc).__name__}: {exc}\n")


def encode_with_fallback(model, ids, texts):
    """Encode a batch; on failure, retry per-document and log bad IDs."""
    try:
        vecs = model.encode(
            texts,
            batch_size=ENCODE_BATCH,
            show_progress_bar=False,
            normalize_embeddings=True,
            convert_to_numpy=True,
        )
        return list(zip(ids, vecs)), []
    except Exception as exc:
        good = []
        bad = []
        for doc_id, text in zip(ids, texts):
            try:
                vec = model.encode(
                    [text],
                    batch_size=1,
                    show_progress_bar=False,
                    normalize_embeddings=True,
                    convert_to_numpy=True,
                )[0]
                good.append((doc_id, vec))
            except Exception as inner:
                bad.append(doc_id)
                log_errors([doc_id], inner)
        if bad:
            print(f"[VEC] batch error: {exc} — {len(bad)} doc(s) skipped, logged.")
        return good, bad


def write_pairs(conn, pairs):
    if not pairs:
        return
    with conn.cursor() as cur:
        execute_batch(
            cur,
            "UPDATE documents SET vector = %s WHERE id = %s",
            [(vec, doc_id) for doc_id, vec in pairs],
            page_size=1000,
        )
    conn.commit()


def main():
    # ── Device selection ─────────────────────────────────────────────
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("WARNING: CUDA not available, falling back to CPU")
        print("Install: pip install torch --index-url https://download.pytorch.org/whl/cu118")
    gpu_name = torch.cuda.get_device_name(0) if device == "cuda" else "cpu"

    model = SentenceTransformer(MODEL_NAME, device=device)

    # ── Counts ───────────────────────────────────────────────────────
    count_conn = connect()
    with count_conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM documents")
        total_docs = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM documents WHERE vector IS NOT NULL")
        already_done = cur.fetchone()[0]
    count_conn.close()
    remaining = total_docs - already_done

    # ── Startup banner ───────────────────────────────────────────────
    print(BAR)
    print("  SURGE WIKI VECTORIZER")
    print(f"  Device: {device} ({gpu_name})")
    print(f"  Model: {MODEL_NAME} (384-dim)")
    print(f"  Total docs: {total_docs:,}")
    print(f"  Already vectorized: {already_done:,} (resuming)")
    print(f"  Remaining: {remaining:,}")
    print(BAR, flush=True)

    if remaining == 0:
        print("[VEC] nothing to do.")
        return

    LOG_DIR.mkdir(parents=True, exist_ok=True)

    # ── Streaming read connection (server-side cursor) ───────────────
    # Named cursors require a transaction; we never commit on this conn.
    # No register_vector here — we only fetch id + text.
    read_conn = psycopg2.connect(DSN)
    cursor_name = f"vec_cur_{uuid.uuid4().hex[:8]}"
    read_cur = read_conn.cursor(name=cursor_name)
    read_cur.itersize = DB_CHUNK
    read_cur.execute(
        "SELECT id, COALESCE(title,'') || ' ' || COALESCE(content,'') "
        "FROM documents WHERE vector IS NULL ORDER BY id"
    )

    # Separate write connection (server-side cursor connections can't run other queries).
    write_conn = connect()

    processed = 0
    errors = 0
    last_checkpoint = 0
    t0 = time.time()

    try:
        with tqdm(total=remaining, desc="Vectorizing", unit="doc",
                  smoothing=0.05, dynamic_ncols=True) as bar:
            while True:
                rows = read_cur.fetchmany(DB_CHUNK)
                if not rows:
                    break

                ids = [r[0] for r in rows]
                texts = [(r[1] or "")[:MAX_CHARS] for r in rows]

                # encode in sub-batches of ENCODE_BATCH
                all_pairs = []
                for i in range(0, len(rows), ENCODE_BATCH):
                    sub_ids = ids[i:i + ENCODE_BATCH]
                    sub_txt = texts[i:i + ENCODE_BATCH]
                    pairs, bad = encode_with_fallback(model, sub_ids, sub_txt)
                    all_pairs.extend(pairs)
                    errors += len(bad)

                write_pairs(write_conn, all_pairs)

                processed += len(rows)
                bar.update(len(rows))

                # ── VRAM safety ──────────────────────────────────────
                if device == "cuda":
                    used, _ = vram_stats()
                    if used > VRAM_LIMIT_GB:
                        torch.cuda.empty_cache()
                        print("VRAM cache cleared", flush=True)

                # ── 100k checkpoint ──────────────────────────────────
                milestone = (processed // CHECKPOINT_EVERY) * CHECKPOINT_EVERY
                if milestone > last_checkpoint and milestone > 0:
                    last_checkpoint = milestone
                    elapsed = time.time() - t0
                    rate = processed / max(elapsed, 1e-9)
                    used, total = vram_stats()
                    tag = f"{milestone // 1000}k"
                    print(
                        f"[{tag}] {processed:,}/{total_docs:,} | "
                        f"{rate:,.0f} docs/sec | "
                        f"VRAM: {used:.1f}/{total:.1f} GB | "
                        f"elapsed: {fmt_hms(elapsed)}",
                        flush=True,
                    )
    finally:
        try:
            read_cur.close()
        except Exception:
            pass
        read_conn.close()
        write_conn.close()

    # ── Final summary ────────────────────────────────────────────────
    elapsed = time.time() - t0
    rate = processed / max(elapsed, 1e-9)
    h = int(elapsed // 3600)
    m = int((elapsed % 3600) // 60)
    print(BAR)
    print("  VECTORIZATION COMPLETE")
    print(f"  Documents vectorized: {processed:,}")
    print(f"  Time taken: {h}h {m:02d}m")
    print(f"  Average speed: {rate:,.0f} docs/sec")
    print(f"  Errors logged: {errors} (see {ERROR_LOG})")
    print(BAR, flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[VEC] interrupted — rerun to resume.", file=sys.stderr)
        sys.exit(130)
