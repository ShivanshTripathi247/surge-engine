import logging
import queue
import threading
import time

import psycopg2
from psycopg2 import pool as pgpool
from psycopg2.extras import execute_values

import config

log = logging.getLogger("loader")

SENTINEL = None  # sentinel pushed to queues to signal shutdown


class _Pool:
    _instance = None

    @classmethod
    def get(cls):
        if cls._instance is None:
            cls._instance = pgpool.ThreadedConnectionPool(
                minconn=1,
                maxconn=8,
                host=config.DB_HOST,
                port=config.DB_PORT,
                dbname=config.DB_NAME,
                user=config.DB_USER,
                password=config.DB_PASSWORD,
            )
        return cls._instance


class DocumentWriter(threading.Thread):
    def __init__(self, doc_queue, stats):
        super().__init__(daemon=True, name="DocumentWriter")
        self.q = doc_queue
        self.stats = stats

    def run(self):
        pool = _Pool.get()
        while True:
            batch = self.q.get()
            if batch is SENTINEL:
                return
            if not batch:
                continue
            conn = pool.getconn()
            try:
                with conn.cursor() as cur:
                    execute_values(
                        cur,
                        "INSERT INTO documents (url, title, content) VALUES %s "
                        "ON CONFLICT (url) DO NOTHING",
                        batch,
                        page_size=500,
                    )
                conn.commit()
                self.stats["docs"] += len(batch)
            except Exception as e:
                conn.rollback()
                log.exception("doc batch failed: %s", e)
            finally:
                pool.putconn(conn)


class LinkWriter(threading.Thread):
    def __init__(self, link_queue, stats):
        super().__init__(daemon=True, name="LinkWriter")
        self.q = link_queue
        self.stats = stats

    def run(self):
        pool = _Pool.get()
        while True:
            batch = self.q.get()
            if batch is SENTINEL:
                return
            if not batch:
                continue
            conn = pool.getconn()
            try:
                with conn.cursor() as cur:
                    execute_values(
                        cur,
                        "INSERT INTO links (source_url, target_url) VALUES %s "
                        "ON CONFLICT DO NOTHING",
                        batch,
                        page_size=5000,
                    )
                conn.commit()
                self.stats["links"] += len(batch)
            except Exception as e:
                conn.rollback()
                log.exception("link batch failed: %s", e)
            finally:
                pool.putconn(conn)


class ThroughputLogger(threading.Thread):
    def __init__(self, stats, stop_event, interval=60):
        super().__init__(daemon=True, name="ThroughputLogger")
        self.stats = stats
        self.stop_event = stop_event
        self.interval = interval

    def run(self):
        start = time.time()
        last_docs = 0
        while not self.stop_event.wait(self.interval):
            elapsed = max(1, time.time() - start)
            docs = self.stats["docs"]
            links = self.stats["links"]
            recent = docs - last_docs
            rate = recent * 60 / self.interval
            last_docs = docs
            msg = (f"[LOADER] {docs:,} docs written | "
                   f"{links:,} links written | {rate:,.0f} docs/min")
            log.info(msg)
            print(msg, flush=True)
