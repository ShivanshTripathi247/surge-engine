-- ============================================================
-- Surge Wiki Schema
-- Wikipedia-scale search engine (4.2M articles)
-- Apply with:
-- docker exec -i <container> psql -U surge_admin -d surge_wiki < infrastructure/wiki-schema.sql
-- ============================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- documents
-- Core table — one row per Wikipedia article
-- vector column intentionally has no index yet —
-- HNSW index is created AFTER all 4.2M rows are loaded
-- because building it incrementally is 10x slower
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
    id         BIGSERIAL PRIMARY KEY,
    url        TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL,
    content    TEXT,
    vector     vector(384),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- links
-- Directed edge list extracted from [[wikitext]] links
-- source_url → target_url
-- Used exclusively by the PageRank computation
-- Both indexes are required:
--   idx_links_target → "who links TO this page?" (PageRank inner loop)
--   idx_links_source → "how many links does this page send?" (outDegree)
-- ============================================================
CREATE TABLE IF NOT EXISTS links (
    source_url TEXT NOT NULL,
    target_url TEXT NOT NULL,
    PRIMARY KEY (source_url, target_url)
);

CREATE INDEX IF NOT EXISTS idx_links_target 
    ON links (target_url);

CREATE INDEX IF NOT EXISTS idx_links_source 
    ON links (source_url);

-- ============================================================
-- pagerank
-- Written by the SciPy PageRank script after convergence
-- Read by the API at query time for hybrid scoring
-- ============================================================
CREATE TABLE IF NOT EXISTS pagerank (
    url        TEXT PRIMARY KEY,
    score      DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- inverted_index
-- Written by the C++ indexer
-- term → postings JSONB: {"doc_id": term_frequency}
-- ============================================================
CREATE TABLE IF NOT EXISTS inverted_index (
    term     TEXT PRIMARY KEY,
    postings JSONB NOT NULL
);

-- ============================================================
-- query_log
-- Written by the Express API on every search
-- Powers the analytics dashboard
-- ============================================================
CREATE TABLE IF NOT EXISTS query_log (
    id           SERIAL PRIMARY KEY,
    query_text   TEXT NOT NULL,
    result_count INT,
    top_score    DOUBLE PRECISION,
    latency_ms   INT,
    searched_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_log_time 
    ON query_log (searched_at DESC);

-- ============================================================
-- HNSW vector index
-- Created AFTER all documents are loaded and vectorized
-- Uncomment and run this separately once vectorization is done:
-- ============================================================
-- CREATE INDEX idx_documents_vector_hnsw
--     ON documents
--     USING hnsw (vector vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);

-- ============================================================
-- Bulk loading performance settings
-- These make INSERT/COPY dramatically faster during ingestion
-- Run these before starting the parser
-- ============================================================
ALTER SYSTEM SET checkpoint_completion_target = '0.9';
ALTER SYSTEM SET wal_buffers = '64MB';
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET work_mem = '64MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET max_wal_size = '4GB';
SELECT pg_reload_conf();