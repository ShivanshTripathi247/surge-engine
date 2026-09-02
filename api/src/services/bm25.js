// BM25 scoring against the JSONB inverted_index.
//
// Production-grade adjustments for the 6.6M-doc corpus. The naive
// "fetch every postings JSONB, parse in Node, score every candidate"
// shape OOMs because a single common-word posting list can be hundreds
// of MB. Three coupled changes fix this:
//
//   1. Skip terms whose document frequency exceeds MAX_DF. Their IDF
//      contribution is small but their postings list is the largest
//      thing in any query. This is the cause of the previous OOM.
//
//   2. Fetch only the top-K postings by tf per surviving term, server-side,
//      via a LATERAL ORDER BY tf DESC LIMIT K. Postgres uses an internal
//      top-K heap, so cost per term is O(df · log K) not O(df · log df).
//
//   3. Return only the top-N candidate documents to the hybrid ranker.
//      Long-tail candidates wouldn't make the top-10 anyway; dropping
//      them bounds memory at every downstream stage.
//
// This is the same "top-K retrieval" pattern Lucene/Tantivy use; WAND
// and MaxScore are further refinements that prune even more aggressively
// during scoring. We don't need that yet — top-K alone moves us from
// OOM-on-common-queries to stable sub-second latency.
const pool = require("../db");

const K1 = 1.5;
const B = 0.75;
const CORPUS_N = Number(process.env.CORPUS_N || 6_617_310);
const MAX_DF = Number(process.env.BM25_MAX_DF || 1_000_000);
const POSTINGS_LIMIT = Number(process.env.BM25_POSTINGS_LIMIT || 2000);
const BM25_TOP_K = Number(process.env.BM25_TOP_K || 200);
const MIN_TERM_LEN = Number(process.env.BM25_MIN_TERM_LEN || 2);
const AVGDL_SAMPLE = 50_000;

let N = CORPUS_N;
let AVGDL = 0;

async function init() {
  N = CORPUS_N;
  const a = await pool.query(
    `SELECT COALESCE(AVG(LENGTH(COALESCE(title,'') || ' ' || COALESCE(content,''))), 1)::float AS avgdl
       FROM (SELECT title, content FROM documents LIMIT $1) s`,
    [AVGDL_SAMPLE]
  );
  AVGDL = a.rows[0].avgdl || 1;
  console.log(
    `BM25 stats: N=${N.toLocaleString()} avgdl=${Math.round(AVGDL)} ` +
    `max_df=${MAX_DF.toLocaleString()} per_term_postings=${POSTINGS_LIMIT} top_k=${BM25_TOP_K}`
  );
}

// Standard BM25 IDF with the +1 smoothing.
function idf(df) {
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

// Single bounded SQL: per query term, drop if df>=MAX_DF and otherwise
// keep only the top POSTINGS_LIMIT postings by tf. Returns flat rows.
async function fetchTopPostings(terms) {
  // CTEs are MATERIALIZED so the planner cannot inline the df subquery
  // into the inner loop. Without these hints Postgres re-parses each term's
  // JSONB once per output row (~10,000 reparses → 100+ seconds). With
  // MATERIALIZED, df is computed exactly once per term (~150 ms total).
  const sql = `
    WITH q AS MATERIALIZED (
      SELECT unnest($1::text[]) AS term
    ),
    term_data AS MATERIALIZED (
      SELECT
        ii.term,
        ii.postings,
        (SELECT count(*) FROM jsonb_object_keys(ii.postings))::int AS df
      FROM inverted_index ii
      JOIN q USING (term)
    ),
    filt AS MATERIALIZED (
      SELECT term, postings, df FROM term_data WHERE df < $2
    )
    SELECT
      f.term,
      f.df,
      (p.key)::int   AS doc_id,
      (p.value)::int AS tf
    FROM filt f
    CROSS JOIN LATERAL (
      SELECT key, value
      FROM jsonb_each_text(f.postings)
      ORDER BY (value)::int DESC
      LIMIT $3
    ) p
  `;
  const { rows } = await pool.query(sql, [terms, MAX_DF, POSTINGS_LIMIT]);
  return rows;
}

// Fetch character lengths for a bounded set of candidate IDs.
async function fetchDocLengths(ids) {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT id, LENGTH(COALESCE(title,'') || ' ' || COALESCE(content,'')) AS dl
       FROM documents WHERE id = ANY($1::int[])`,
    [ids]
  );
  return new Map(rows.map(r => [r.id, Number(r.dl) || AVGDL]));
}

// Score query terms against the corpus. Returns Map<doc_id, bm25_score>
// containing at most BM25_TOP_K entries — the strongest candidates.
async function score(terms) {
  const unique = [...new Set(
    (terms || []).map(t => (t || "").toLowerCase())
                 .filter(t => t.length >= MIN_TERM_LEN)
  )];
  if (unique.length === 0) return new Map();

  const rows = await fetchTopPostings(unique);
  if (rows.length === 0) return new Map();

  const candidateIds = [...new Set(rows.map(r => r.doc_id))];
  const docLen = await fetchDocLengths(candidateIds);

  // Aggregate per-term contributions into a per-doc score.
  const raw = new Map();
  for (const r of rows) {
    const w = idf(r.df);
    if (w <= 0) continue;
    const dl = docLen.get(r.doc_id) || AVGDL;
    const norm = r.tf + K1 * (1 - B + B * (dl / AVGDL));
    const s = w * (r.tf * (K1 + 1)) / norm;
    raw.set(r.doc_id, (raw.get(r.doc_id) || 0) + s);
  }

  // Top-K cutoff: only the strongest BM25 candidates compete in the hybrid stage.
  if (raw.size <= BM25_TOP_K) return raw;
  const sorted = [...raw.entries()].sort((a, b) => b[1] - a[1]).slice(0, BM25_TOP_K);
  return new Map(sorted);
}

module.exports = { init, score };
