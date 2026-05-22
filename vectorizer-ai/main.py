"""
Phase 3 — Semantic Vectorizer
- Streams documents missing a vector in batches (no OOM).
- Encodes title + content with all-MiniLM-L6-v2 (384-dim).
- Writes back via pgvector. Resumable: WHERE vector IS NULL.
"""
import os, sys, time
import psycopg2
from psycopg2.extras import execute_batch
from pgvector.psycopg2 import register_vector
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

DSN = os.environ.get(
    "PG_DSN",
    "host=localhost port=5432 dbname=search_engine user=search_admin password=supersecretpassword",
)
MODEL_NAME = "all-MiniLM-L6-v2"
BATCH = 64
MAX_CHARS = 4000  # cap input length before tokenizer truncation


# Open a pgvector-aware Postgres connection.
def connect():
    conn = psycopg2.connect(DSN)
    register_vector(conn)
    return conn


# Count docs needing embeddings and docs already done.
def counts(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM documents WHERE vector IS NULL")
        pending = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM documents WHERE vector IS NOT NULL")
        done = cur.fetchone()[0]
    return pending, done


# Yield batches of (id, text) for docs without a vector.
def stream_pending(conn, batch_size):
    while True:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, COALESCE(title,'') || ' ' || COALESCE(content,'') "
                "FROM documents WHERE vector IS NULL ORDER BY id LIMIT %s",
                (batch_size,),
            )
            rows = cur.fetchall()
        if not rows:
            return
        yield rows


# Persist a batch of (id, vector) pairs back to documents.
def write_batch(conn, pairs):
    with conn.cursor() as cur:
        execute_batch(
            cur,
            "UPDATE documents SET vector = %s WHERE id = %s",
            [(vec, doc_id) for doc_id, vec in pairs],
            page_size=BATCH,
        )
    conn.commit()


def main():
    print(f"[VEC] loading model {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)
    print(f"[VEC] embedding dim = {model.get_sentence_embedding_dimension()}")

    conn = connect()
    pending, already_done = counts(conn)
    print(f"[VEC] pending={pending}  already_vectorized={already_done}")
    if pending == 0:
        print("[VEC] nothing to do."); return

    processed = 0
    t0 = time.time()
    with tqdm(total=pending, desc="embedding", unit="doc") as bar:
        for rows in stream_pending(conn, BATCH):
            ids = [r[0] for r in rows]
            texts = [(r[1] or "")[:MAX_CHARS] for r in rows]
            vecs = model.encode(
                texts, batch_size=BATCH, show_progress_bar=False,
                normalize_embeddings=True, convert_to_numpy=True,
            )
            write_batch(conn, list(zip(ids, vecs)))
            processed += len(rows)
            bar.update(len(rows))

    dt = time.time() - t0
    print(f"[VEC] done. processed={processed} skipped={already_done} elapsed={dt:.1f}s "
          f"({processed/max(dt,1e-9):.1f} docs/sec)")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[VEC] interrupted — rerun to resume.", file=sys.stderr)
        sys.exit(130)
