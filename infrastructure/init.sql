-- schema.sql
-- Run this against your search_engine database before starting the crawler.
-- All new tables are additive — existing data is untouched.

-- ============================================================
-- Core documents table (existing — shown for reference)
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id         SERIAL PRIMARY KEY,
  url        TEXT NOT NULL UNIQUE,
  title      TEXT,
  content    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Link graph — one row per directed edge (source → target).
-- Used by the PageRank pass in Phase 2.
--
-- Design notes:
--   • source_url and target_url are bare TEXT, not FKs into documents.
--     This lets us record edges to pages we haven't crawled yet.
--   • The composite primary key enforces uniqueness and gives a B-tree
--     index on (source_url, target_url) — the PageRank pass reads this
--     as "give me all pages that link to X" using the target_url index.
-- ============================================================
CREATE TABLE IF NOT EXISTS links (
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  PRIMARY KEY (source_url, target_url)
);

-- Index for the PageRank query "who links TO this page?"
-- PageRank iterates: for each doc, sum PageRank(linker) / outDegree(linker)
-- across all linkers. This index makes the inner lookup O(log n).
CREATE INDEX IF NOT EXISTS idx_links_target ON links (target_url);

-- Index for "how many links does this page send out?" (outDegree calculation)
CREATE INDEX IF NOT EXISTS idx_links_source ON links (source_url);

-- ============================================================
-- PageRank scores — written by the C++ Phase 2 indexer after convergence.
-- The query engine (Phase 4) reads this to combine with BM25 + cosine.
-- ============================================================
CREATE TABLE IF NOT EXISTS pagerank (
  url        TEXT PRIMARY KEY,
  score      DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Inverted index — written by the C++ Phase 2 indexer.
-- Stores term → {doc_id: tf, ...} as JSONB for cross-language portability.
-- ============================================================
CREATE TABLE IF NOT EXISTS inverted_index (
  term       TEXT PRIMARY KEY,
  postings   JSONB NOT NULL  -- {"42": 3, "107": 1} → doc_id: term_frequency
);

-- ============================================================
-- Query analytics — written by the Phase 4 Express API.
-- Powers the analytics dashboard tab in Phase 5.
-- ============================================================
CREATE TABLE IF NOT EXISTS query_log (
  id            SERIAL PRIMARY KEY,
  query_text    TEXT NOT NULL,
  result_count  INT,
  top_score     DOUBLE PRECISION,
  latency_ms    INT,
  searched_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for dashboard queries: "most searched terms this week"
CREATE INDEX IF NOT EXISTS idx_query_log_time ON query_log (searched_at DESC);