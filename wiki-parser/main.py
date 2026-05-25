import argparse
import logging
import multiprocessing as mp
import os
import sys
import time

from tqdm import tqdm

import config
import schema
from loader import DocumentWriter, LinkWriter, ThroughputLogger, SENTINEL
from parser import spawn_workers


def setup_logging():
    os.makedirs(os.path.dirname(config.LOG_FILE) or ".", exist_ok=True)
    logging.basicConfig(
        filename=config.LOG_FILE,
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(message)s",
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true",
                    help="process only first ~1000 articles (first ~10 offsets)")
    ap.add_argument("--full", action="store_true", help="full run")
    ap.add_argument("--limit-offsets", type=int, default=None,
                    help="limit number of multistream offsets to process")
    args = ap.parse_args()

    if not (args.test or args.full or args.limit_offsets):
        ap.error("specify --test or --full")

    setup_logging()
    log = logging.getLogger("main")

    print("[1/8] checking database connection...")
    conn = schema.get_connection()
    conn.close()

    print("[2/8] verifying tables...")
    schema.verify_tables()

    print("[3/8] counting existing documents...")
    already = schema.count_documents()
    if already > 0:
        print(f"      resuming from {already:,} articles")

    limit = args.limit_offsets if args.limit_offsets else (10 if args.test else None)

    print("[4/8] parsing multistream index (this takes ~30s)...")
    doc_queue: mp.Queue = mp.Queue(maxsize=64)
    link_queue: mp.Queue = mp.Queue(maxsize=512)
    counter = mp.Value("Q", 0)
    stop_event = mp.Event()

    print(f"[5/8] spawning {config.NUM_WORKERS} workers...")
    procs, n_offsets = spawn_workers(
        doc_queue, link_queue, counter, stop_event, limit_offsets=limit
    )
    print(f"      {len(procs)} workers active over {n_offsets} offsets")

    print("[6/8] starting writer threads...")
    stats = {"docs": 0, "links": 0}
    doc_writer = DocumentWriter(doc_queue, stats)
    link_writers = [LinkWriter(link_queue, stats) for _ in range(3)]
    log_stop = mp.Event()  # use threading.Event semantics-compatible
    import threading
    log_stop_t = threading.Event()
    tput = ThroughputLogger(stats, log_stop_t, interval=60)
    doc_writer.start()
    for lw in link_writers:
        lw.start()
    tput.start()

    print("[7/8] processing... (Ctrl-C to interrupt safely)")
    approx_total = n_offsets * 100  # ~100 articles per multistream block
    pbar = tqdm(total=approx_total, unit="art", smoothing=0.05)
    start = time.time()
    last = 0
    last_log = start
    try:
        while any(p.is_alive() for p in procs):
            time.sleep(1.0)
            cur = counter.value
            if cur > last:
                pbar.update(cur - last)
                last = cur
            now = time.time()
            if now - last_log >= 60:
                elapsed = now - start
                rate = cur / elapsed if elapsed > 0 else 0
                remaining = (approx_total - cur) / rate if rate > 0 else 0
                msg = (f"[ETA] processed={cur:,} elapsed={elapsed/60:.1f}m "
                       f"rate={rate*60:.0f}/min eta={remaining/60:.1f}m")
                print(msg, flush=True)
                last_log = now
        # drain final counter
        cur = counter.value
        if cur > last:
            pbar.update(cur - last)
    except KeyboardInterrupt:
        print("\n[!] interrupted — flushing and shutting down workers...")
        stop_event.set()
        for p in procs:
            p.join(timeout=30)
            if p.is_alive():
                p.terminate()
    finally:
        pbar.close()
        for p in procs:
            p.join()
        # signal writers to exit after queues drain
        doc_queue.put(SENTINEL)
        for _ in link_writers:
            link_queue.put(SENTINEL)
        doc_writer.join()
        for lw in link_writers:
            lw.join()
        log_stop_t.set()
        tput.join(timeout=2)

    print("[8/8] done.")
    elapsed = time.time() - start
    hrs = int(elapsed // 3600)
    mins = int((elapsed % 3600) // 60)
    final_total = schema.count_documents()
    print("================ SUMMARY ================")
    print(f"  documents (this run):  {stats['docs']:,}")
    print(f"  links     (this run):  {stats['links']:,}")
    print(f"  total in DB now:       {final_total:,}")
    print(f"  time taken:            {hrs}h {mins}m")
    if elapsed > 0:
        print(f"  avg speed:             {stats['docs']*60/elapsed:,.0f} articles/min")
    print("=========================================")
    print("Safe to resume — run main.py again to continue.")


if __name__ == "__main__":
    # Python 3.14 defaults to 'forkserver', which can't rebuild mp.Queue
    # semaphores in spawned children. 'fork' inherits them directly on Linux.
    mp.set_start_method("fork", force=True)
    main()
