"""
Wikipedia-scale PageRank.

Streams the `links` table out of local Postgres, builds a column-stochastic
sparse adjacency matrix, runs power iteration with dangling-node handling, and
writes the converged scores back into the `pagerank` table.

Designed to checkpoint after every iteration so a 2-3h run survives crashes.
"""

import os
import sys
import time
import pickle
import signal
import traceback
from datetime import timedelta
from pathlib import Path

import numpy as np
import psutil
import psycopg2
import psycopg2.extras
from scipy import sparse
from tqdm import tqdm


DB = dict(
    host="localhost",
    port=5433,
    dbname="surge_wiki",
    user="surge_admin",
    password="local_dev_pwd",
)

DAMPING = 0.85
MAX_ITERATIONS = 100
EPSILON = 1e-6
LINK_CHUNK = 1_000_000
WRITE_BATCH = 10_000
MIN_FREE_GB = 6

HERE = Path(__file__).resolve().parent
LOG_DIR = HERE / "logs"
LOG_DIR.mkdir(exist_ok=True)
CKPT_RANKS = LOG_DIR / "pagerank_checkpoint.npy"
CKPT_META = LOG_DIR / "pagerank_checkpoint_meta.pkl"
CKPT_URLMAP = LOG_DIR / "pagerank_urlmap.pkl"
CKPT_MATRIX = LOG_DIR / "pagerank_matrix.npz"


def fmt_dt(seconds: float) -> str:
    if seconds < 0 or not np.isfinite(seconds):
        return "?"
    return str(timedelta(seconds=int(seconds)))


def check_ram():
    avail_gb = psutil.virtual_memory().available / (1024 ** 3)
    if avail_gb < MIN_FREE_GB:
        print(
            f"ERROR: only {avail_gb:.1f} GB RAM available; "
            f"need at least {MIN_FREE_GB} GB for the 6.6M-node graph.",
            flush=True,
        )
        sys.exit(1)
    print(f"RAM check passed: {avail_gb:.1f} GB available.", flush=True)


def proc_mem_gb() -> float:
    return psutil.Process(os.getpid()).memory_info().rss / (1024 ** 3)


def connect():
    return psycopg2.connect(**DB)


def have_checkpoint() -> bool:
    return (
        CKPT_RANKS.exists()
        and CKPT_META.exists()
        and CKPT_URLMAP.exists()
        and CKPT_MATRIX.exists()
    )


def delete_checkpoint():
    for p in (CKPT_RANKS, CKPT_META, CKPT_URLMAP, CKPT_MATRIX):
        try:
            p.unlink()
        except FileNotFoundError:
            pass


def ask_resume() -> bool:
    print("Checkpoint found from previous run. Resume? (y/n)", flush=True)
    try:
        ans = input().strip().lower()
    except EOFError:
        # Non-interactive (e.g. nohup). Default to resume so we don't throw
        # away an in-progress run.
        print("(no tty — defaulting to resume)", flush=True)
        return True
    return ans.startswith("y")


def load_graph():
    """
    Returns: (M_csr, url_to_id, dangling_mask, total_edges)

    M is column-stochastic: M[i, j] = 1/outdeg(j) iff j → i.
    The universe of nodes is `documents.url`. Edges pointing to/from URLs
    that are not in `documents` are dropped (they'd be dangling sinks
    with no associated article anyway).
    """
    conn = connect()
    conn.set_session(readonly=True)
    cur = conn.cursor()

    print("Building URL → id map from documents...", flush=True)
    cur.execute("SELECT COUNT(*) FROM documents")
    n_docs = cur.fetchone()[0]

    url_to_id: dict[str, int] = {}
    with conn.cursor(name="doc_url_stream") as scur:
        scur.itersize = 200_000
        scur.execute("SELECT url FROM documents")
        with tqdm(
            total=n_docs,
            desc="URL map",
            unit="url",
            unit_scale=True,
            file=sys.stdout,
            mininterval=1.0,
        ) as bar:
            for (url,) in scur:
                if url not in url_to_id:
                    url_to_id[url] = len(url_to_id)
                bar.update(1)
    N = len(url_to_id)
    print(f"URL map built: {N:,} nodes.", flush=True)

    cur.execute("SELECT COUNT(*) FROM links")
    total_links = cur.fetchone()[0]
    print(f"Total edges in links table: {total_links:,}", flush=True)

    # Accumulate COO arrays per chunk, concatenate at the end. int32 is fine —
    # N ≈ 6.6M fits comfortably in signed 32-bit.
    row_chunks: list[np.ndarray] = []
    col_chunks: list[np.ndarray] = []
    kept = 0
    dropped = 0

    with conn.cursor(name="link_stream") as scur:
        scur.itersize = LINK_CHUNK
        scur.execute("SELECT source_url, target_url FROM links")

        with tqdm(
            total=total_links,
            desc="Loading graph",
            unit="edge",
            unit_scale=True,
            file=sys.stdout,
            mininterval=1.0,
        ) as bar:
            while True:
                rows = scur.fetchmany(LINK_CHUNK)
                if not rows:
                    break
                # Filter to edges where both endpoints are in our universe.
                src_ids = np.empty(len(rows), dtype=np.int32)
                tgt_ids = np.empty(len(rows), dtype=np.int32)
                n_ok = 0
                local_dropped = 0
                get = url_to_id.get
                for s, t in rows:
                    si = get(s, -1)
                    ti = get(t, -1)
                    if si >= 0 and ti >= 0:
                        src_ids[n_ok] = si
                        tgt_ids[n_ok] = ti
                        n_ok += 1
                    else:
                        local_dropped += 1
                if n_ok:
                    # In M (column-stochastic), row=target, col=source.
                    row_chunks.append(tgt_ids[:n_ok].copy())
                    col_chunks.append(src_ids[:n_ok].copy())
                kept += n_ok
                dropped += local_dropped
                bar.update(len(rows))

    cur.close()
    conn.close()

    print(
        f"Edges kept: {kept:,} | dropped (non-document endpoints): {dropped:,}",
        flush=True,
    )

    print("Concatenating COO arrays...", flush=True)
    rows_arr = np.concatenate(row_chunks) if row_chunks else np.empty(0, np.int32)
    cols_arr = np.concatenate(col_chunks) if col_chunks else np.empty(0, np.int32)
    del row_chunks, col_chunks

    print("Computing out-degrees...", flush=True)
    out_deg = np.bincount(cols_arr, minlength=N).astype(np.float32)
    dangling_mask = out_deg == 0

    print("Constructing column-stochastic CSR matrix...", flush=True)
    # data[i] = 1 / outdeg(source of edge i)
    data = (1.0 / out_deg[cols_arr]).astype(np.float32)
    M = sparse.csr_matrix(
        (data, (rows_arr, cols_arr)),
        shape=(N, N),
        dtype=np.float32,
    )
    del data, rows_arr, cols_arr, out_deg

    mem_gb = proc_mem_gb()
    print(
        f"Graph loaded: {N:,} nodes | {kept:,} edges | {mem_gb:.2f} GB RAM",
        flush=True,
    )
    print(f"Dangling nodes (no outgoing links): {int(dangling_mask.sum()):,}", flush=True)

    return M, url_to_id, dangling_mask, kept


def save_initial_artifacts(M, url_to_id, dangling_mask, total_edges):
    print("Saving matrix + url map (one-time, for resume)...", flush=True)
    sparse.save_npz(CKPT_MATRIX, M)
    with open(CKPT_URLMAP, "wb") as f:
        pickle.dump(
            {
                "url_to_id": url_to_id,
                "dangling_mask": dangling_mask,
                "N": M.shape[0],
                "total_edges": total_edges,
            },
            f,
            protocol=pickle.HIGHEST_PROTOCOL,
        )


def load_initial_artifacts():
    print("Loading matrix + url map from checkpoint...", flush=True)
    M = sparse.load_npz(CKPT_MATRIX)
    with open(CKPT_URLMAP, "rb") as f:
        meta = pickle.load(f)
    return M, meta["url_to_id"], meta["dangling_mask"], meta["total_edges"]


def save_iter_checkpoint(ranks, iteration, deltas, started_at):
    np.save(CKPT_RANKS, ranks)
    with open(CKPT_META, "wb") as f:
        pickle.dump(
            {
                "iteration": iteration,
                "deltas": deltas,
                "started_at": started_at,
            },
            f,
            protocol=pickle.HIGHEST_PROTOCOL,
        )


def load_iter_checkpoint():
    ranks = np.load(CKPT_RANKS)
    with open(CKPT_META, "rb") as f:
        meta = pickle.load(f)
    return ranks, meta["iteration"], meta["deltas"], meta["started_at"]


def power_iterate(M, dangling_mask, ranks, start_iter, deltas, started_at):
    N = M.shape[0]
    teleport = (1.0 - DAMPING) / N

    print("Starting PageRank power iteration...", flush=True)
    print("━" * 36, flush=True)

    converged = False
    final_delta = None
    last_iter = start_iter

    iter_start_wall = time.time()
    # Track wall time spent in iterations done in THIS process run, so ETA is
    # responsive after a resume.
    iter_times: list[float] = []

    for it in range(start_iter + 1, MAX_ITERATIONS + 1):
        t0 = time.time()

        dangling_sum = DAMPING * float(ranks[dangling_mask].sum()) / N
        new_ranks = DAMPING * (M @ ranks) + dangling_sum + teleport

        # Re-normalise to guard against float32 drift.
        new_ranks /= new_ranks.sum()

        delta = float(np.abs(new_ranks - ranks).sum())
        ranks = new_ranks
        deltas.append(delta)
        last_iter = it

        dt = time.time() - t0
        iter_times.append(dt)
        elapsed = time.time() - started_at
        avg = sum(iter_times) / len(iter_times)
        remaining = max(0, MAX_ITERATIONS - it)
        eta = avg * remaining

        save_iter_checkpoint(ranks, it, deltas, started_at)

        if delta < EPSILON:
            print(
                f"Iter {it:>3}/{MAX_ITERATIONS} | delta={delta:.2e} | CONVERGED ✓",
                flush=True,
            )
            converged = True
            final_delta = delta
            break

        print(
            f"Iter {it:>3}/{MAX_ITERATIONS} | delta={delta:.2e} | "
            f"elapsed={fmt_dt(elapsed)} | eta=~{fmt_dt(eta)}",
            flush=True,
        )
        final_delta = delta

    return ranks, last_iter, final_delta, converged


def write_results(ranks, url_to_id):
    N = len(url_to_id)
    id_to_url = [None] * N
    for url, i in url_to_id.items():
        id_to_url[i] = url

    conn = connect()
    cur = conn.cursor()

    # TRUNCATE so the table reflects this run only. ON CONFLICT in the spec
    # below handles concurrent writers / partial reruns gracefully.
    print("Clearing pagerank table...", flush=True)
    cur.execute("TRUNCATE pagerank")
    conn.commit()

    sql = (
        "INSERT INTO pagerank (url, score, updated_at) VALUES %s "
        "ON CONFLICT (url) DO UPDATE "
        "SET score = EXCLUDED.score, updated_at = EXCLUDED.updated_at"
    )

    now_clause = "NOW()"
    template = f"(%s, %s, {now_clause})"

    with tqdm(
        total=N,
        desc="Writing PageRank scores",
        unit="row",
        unit_scale=True,
        file=sys.stdout,
        mininterval=1.0,
    ) as bar:
        batch = []
        for i in range(N):
            batch.append((id_to_url[i], float(ranks[i])))
            if len(batch) >= WRITE_BATCH:
                psycopg2.extras.execute_values(cur, sql, batch, template=template)
                conn.commit()
                bar.update(len(batch))
                batch.clear()
        if batch:
            psycopg2.extras.execute_values(cur, sql, batch, template=template)
            conn.commit()
            bar.update(len(batch))

    cur.close()
    conn.close()


def print_summary(ranks, url_to_id, iteration, final_delta, total_seconds):
    N = len(ranks)
    top_idx = np.argpartition(-ranks, 10)[:10]
    top_idx = top_idx[np.argsort(-ranks[top_idx])]

    id_to_url = [None] * N
    for url, i in url_to_id.items():
        id_to_url[i] = url

    PREFIX = "https://en.wikipedia.org/wiki/"

    def short(url: str) -> str:
        return url[len(PREFIX):] if url.startswith(PREFIX) else url

    total_str = fmt_dt(total_seconds)
    delta_str = f"{final_delta:.2e}" if final_delta is not None else "?"

    lines = []
    lines.append("╔══════════════════════════════════════════════════╗")
    lines.append("║              PAGERANK COMPLETE                   ║")
    lines.append("╠══════════════════════════════════════════════════╣")
    lines.append(f"║ Articles scored:    {N:>10,}                   ║")
    lines.append(f"║ Iterations:         {iteration:>10}                   ║")
    lines.append(f"║ Final delta:        {delta_str:>10}                   ║")
    lines.append(f"║ Total time:         {total_str:>10}                   ║")
    lines.append("╠══════════════════════════════════════════════════╣")
    lines.append("║ TOP 10 HIGHEST RANKED                            ║")
    for rank_pos, idx in enumerate(top_idx, start=1):
        title = short(id_to_url[idx])[:28]
        score = ranks[idx]
        lines.append(f"║ {rank_pos:>2}. {title:<28} {score:.6f}    ║")
    lines.append("╚══════════════════════════════════════════════════╝")
    print("\n".join(lines), flush=True)


def main():
    check_ram()

    resume = False
    if have_checkpoint():
        if ask_resume():
            resume = True
        else:
            print("Discarding old checkpoint and starting fresh.", flush=True)
            delete_checkpoint()

    if resume:
        M, url_to_id, dangling_mask, total_edges = load_initial_artifacts()
        ranks, start_iter, deltas, started_at = load_iter_checkpoint()
        print(
            f"Resumed at iteration {start_iter}. "
            f"Last delta={deltas[-1]:.2e} | {M.shape[0]:,} nodes | "
            f"{total_edges:,} edges",
            flush=True,
        )
    else:
        M, url_to_id, dangling_mask, total_edges = load_graph()
        save_initial_artifacts(M, url_to_id, dangling_mask, total_edges)
        N = M.shape[0]
        ranks = np.full(N, 1.0 / N, dtype=np.float32)
        start_iter = 0
        deltas = []
        started_at = time.time()
        save_iter_checkpoint(ranks, start_iter, deltas, started_at)

    iteration = start_iter
    final_delta = deltas[-1] if deltas else None

    try:
        ranks, iteration, final_delta, _converged = power_iterate(
            M, dangling_mask, ranks, start_iter, deltas, started_at
        )

        write_results(ranks, url_to_id)
        total_seconds = time.time() - started_at
        print_summary(ranks, url_to_id, iteration, final_delta, total_seconds)

        # Clean up the checkpoint on a successful, fully-written run.
        delete_checkpoint()

    except Exception:
        pct = (iteration / MAX_ITERATIONS) * 100
        print(
            f"\nCRASHED at iteration {iteration} | {pct:.0f}% complete",
            flush=True,
        )
        traceback.print_exc()
        try:
            save_iter_checkpoint(ranks, iteration, deltas, started_at)
            print(
                "Checkpoint saved — run again to resume from last iteration.",
                flush=True,
            )
        except Exception:
            print("Failed to save checkpoint:", flush=True)
            traceback.print_exc()
        sys.exit(1)


def _on_sigterm(signum, frame):
    # Translate SIGTERM into an exception so the try/except in main() runs
    # and a checkpoint is written.
    raise KeyboardInterrupt(f"received signal {signum}")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _on_sigterm)
    main()
