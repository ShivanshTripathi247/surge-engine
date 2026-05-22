// BM25 scoring against the inverted_index JSONB postings.
const pool = require("../db");

const K1 = 1.5;
const B = 0.75;

let N = 0;
let AVGDL = 0;
const docLenCache = new Map();

// Cache N (doc count) and avgdl on startup for fast scoring.
async function init() {
  const a = await pool.query("SELECT COUNT(*)::int AS n FROM documents");
  N = a.rows[0].n || 1;
  const b = await pool.query(
    "SELECT COALESCE(AVG(LENGTH(COALESCE(title,'') || ' ' || COALESCE(content,''))),1)::float AS avgdl FROM documents"
  );
  AVGDL = b.rows[0].avgdl || 1;
  console.log(`[bm25] N=${N} avgdl=${AVGDL.toFixed(1)}`);
}

// Fetch raw lengths for the candidate docs we'll score.
async function loadDocLengths(ids) {
  const missing = ids.filter((id) => !docLenCache.has(id));
  if (missing.length === 0) return;
  const { rows } = await pool.query(
    "SELECT id, LENGTH(COALESCE(title,'') || ' ' || COALESCE(content,'')) AS dl FROM documents WHERE id = ANY($1::int[])",
    [missing]
  );
  for (const r of rows) docLenCache.set(r.id, Number(r.dl) || 1);
}

// IDF with the standard +1 smoothing.
function idf(df) {
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

// Score all candidate docs for a list of terms; returns Map<doc_id, score>.
async function score(terms) {
  const unique = [...new Set(terms.map((t) => t.toLowerCase()))].filter(Boolean);
  if (unique.length === 0) return new Map();

  const { rows } = await pool.query(
    "SELECT term, postings FROM inverted_index WHERE term = ANY($1::text[])",
    [unique]
  );

  const candidateIds = new Set();
  const termPostings = [];
  for (const r of rows) {
    const p = r.postings || {};
    const df = Object.keys(p).length;
    if (df === 0) continue;
    termPostings.push({ term: r.term, postings: p, df });
    for (const id of Object.keys(p)) candidateIds.add(Number(id));
  }
  if (candidateIds.size === 0) return new Map();
  await loadDocLengths([...candidateIds]);

  const scores = new Map();
  for (const { df, postings } of termPostings) {
    const w = idf(df);
    for (const [idStr, tfRaw] of Object.entries(postings)) {
      const id = Number(idStr);
      const tf = Number(tfRaw) || 0;
      const dl = docLenCache.get(id) || AVGDL;
      const norm = tf + K1 * (1 - B + B * (dl / AVGDL));
      const s = w * (tf * (K1 + 1)) / norm;
      scores.set(id, (scores.get(id) || 0) + s);
    }
  }
  return scores;
}

module.exports = { init, score };
