"""Multistream parallel reader for enwiki dumps.

Each multistream offset points to an independently-decompressible bz2 block
containing up to 100 <page> elements wrapped in a <mediawiki> root that is
*not* present at the block level. We wrap the decompressed bytes with a
synthetic root element before XML parsing.
"""

import bz2
import logging
import multiprocessing as mp
import os
import re
import xml.etree.ElementTree as ET

import config
import schema
from cleaner import clean
from extractor import extract_links, title_to_url

log = logging.getLogger("parser")

_REDIRECT_RE = re.compile(r"^\s*#REDIRECT", re.IGNORECASE)
_DISAMBIG_RE = re.compile(r"\{\{\s*(disambiguation|disambig|dab|hndis|geodis)\s*[}|]", re.IGNORECASE)


def read_offsets(index_path: str):
    """Return a sorted list of unique byte offsets from the multistream index."""
    offsets = []
    last = None
    with bz2.open(index_path, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                off_str, _rest = line.split(":", 1)
                off = int(off_str)
            except ValueError:
                continue
            if off != last:
                offsets.append(off)
                last = off
    offsets.sort()
    return offsets


def _read_block(fh, start: int, end: int) -> bytes:
    fh.seek(start)
    if end is None:
        return fh.read()
    return fh.read(end - start)


def _decompress_block(raw: bytes) -> bytes:
    try:
        return bz2.decompress(raw)
    except OSError:
        dec = bz2.BZ2Decompressor()
        return dec.decompress(raw)


_NS_RE = re.compile(r"^\{[^}]+\}")


def _localname(tag: str) -> str:
    return _NS_RE.sub("", tag)


def _parse_block_xml(decompressed: bytes):
    """Yield (title, wikitext) tuples for ns=0 non-redirect pages."""
    wrapped = b"<root>" + decompressed + b"</root>"
    try:
        root = ET.fromstring(wrapped)
    except ET.ParseError:
        return
    for page in root:
        if _localname(page.tag) != "page":
            continue
        ns_text = None
        title_text = None
        wikitext = None
        redirect_present = False
        for child in page:
            ln = _localname(child.tag)
            if ln == "ns":
                ns_text = (child.text or "").strip()
            elif ln == "title":
                title_text = child.text or ""
            elif ln == "redirect":
                redirect_present = True
            elif ln == "revision":
                for r in child:
                    if _localname(r.tag) == "text":
                        wikitext = r.text or ""
                        break
        if ns_text != "0":
            continue
        if redirect_present:
            continue
        if not title_text or wikitext is None:
            continue
        yield title_text, wikitext


def _worker(
    worker_id: int,
    work_q: mp.Queue,
    doc_queue: mp.Queue,
    link_queue: mp.Queue,
    counter,
    existing_urls_set,
    stop_event,
):
    """Worker process: pull (offset, end) jobs from work_q until sentinel."""
    logging.basicConfig(
        filename=config.LOG_FILE,
        level=logging.INFO,
        format="%(asctime)s [w%(process)d] %(message)s",
    )
    try:
        fh = open(config.DUMP_PATH, "rb")
    except OSError as e:
        log.error("worker %d cannot open dump: %s", worker_id, e)
        return

    doc_batch = []
    link_batch = []

    try:
        while True:
            if stop_event.is_set():
                break
            item = work_q.get()
            if item is None:
                break
            off, end = item
            try:
                raw = _read_block(fh, off, end)
                decompressed = _decompress_block(raw)
            except Exception as e:
                log.warning("worker %d block @%d decompress failed: %s", worker_id, off, e)
                continue

            for title, wikitext in _parse_block_xml(decompressed):
                if _REDIRECT_RE.match(wikitext):
                    continue
                if _DISAMBIG_RE.search(wikitext):
                    continue

                url = title_to_url(title)
                if not url:
                    continue
                if existing_urls_set is not None and url in existing_urls_set:
                    with counter.get_lock():
                        counter.value += 1
                    continue

                content = clean(wikitext)
                if len(content) < config.MIN_CONTENT_LENGTH:
                    with counter.get_lock():
                        counter.value += 1
                    continue

                links = extract_links(wikitext)

                doc_batch.append((url, title, content))
                for tgt in links:
                    if tgt != url:
                        link_batch.append((url, tgt))

                with counter.get_lock():
                    counter.value += 1

                if len(doc_batch) >= config.BATCH_SIZE_DOCS:
                    doc_queue.put(doc_batch)
                    doc_batch = []
                if len(link_batch) >= config.BATCH_SIZE_LINKS:
                    link_queue.put(link_batch)
                    link_batch = []
    finally:
        if doc_batch:
            doc_queue.put(doc_batch)
        if link_batch:
            link_queue.put(link_batch)
        fh.close()


def spawn_workers(doc_queue, link_queue, counter, stop_event, limit_offsets=None):
    """Read index, split offsets, spawn worker processes. Returns list of Process."""
    log.info("reading multistream index from %s", config.INDEX_PATH)
    offsets = read_offsets(config.INDEX_PATH)
    log.info("got %d unique offsets", len(offsets))
    if limit_offsets is not None:
        offsets = offsets[:limit_offsets]
        log.info("limited to first %d offsets (test mode)", len(offsets))

    file_size = os.path.getsize(config.DUMP_PATH)

    # Preload existing urls so workers skip them (only practical at modest scale;
    # for full run, the DB-side ON CONFLICT DO NOTHING handles dedup as backstop).
    existing = None
    try:
        n_docs = schema.count_documents()
        if 0 < n_docs <= 600_000:
            conn = schema.get_connection()
            try:
                with conn.cursor(name="urls_cursor") as cur:
                    cur.itersize = 50_000
                    cur.execute("SELECT url FROM documents")
                    existing = set(row[0] for row in cur)
            finally:
                conn.close()
            log.info("preloaded %d existing urls for in-memory skip", len(existing))
    except Exception as e:
        log.warning("could not preload existing urls: %s", e)
        existing = None

    # Dynamic work queue: pre-fill (off, end) jobs + one sentinel per worker.
    # Workers pull one block at a time, so fast workers keep grabbing new
    # work instead of waiting on slow chunk-mates.
    work_q: mp.Queue = mp.Queue()
    for i, off in enumerate(offsets):
        nxt = offsets[i + 1] if i + 1 < len(offsets) else file_size
        work_q.put((off, nxt))
    for _ in range(config.NUM_WORKERS):
        work_q.put(None)

    procs = []
    for i in range(config.NUM_WORKERS):
        p = mp.Process(
            target=_worker,
            args=(i, work_q, doc_queue, link_queue, counter, existing, stop_event),
            daemon=False,
        )
        p.start()
        procs.append(p)
    return procs, len(offsets)
