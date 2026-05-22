const pool = require("../db");

// Fetch PageRank scores for a list of URLs; returns Map<url, score>.
async function fetchScores(urls) {
  if (!urls || urls.length === 0) return new Map();
  const { rows } = await pool.query(
    "SELECT url, score FROM pagerank WHERE url = ANY($1::text[])",
    [urls]
  );
  const m = new Map();
  for (const r of rows) m.set(r.url, Number(r.score));
  return m;
}

module.exports = { fetchScores };
