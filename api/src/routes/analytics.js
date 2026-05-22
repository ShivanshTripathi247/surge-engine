const express = require("express");
const router = express.Router();
const pool = require("../db");

// Analytics summary for dashboard.
router.get("/", async (_req, res) => {
  try {
    const top = await pool.query(
      "SELECT query_text, COUNT(*)::int AS hits FROM query_log GROUP BY query_text ORDER BY hits DESC LIMIT 10"
    );
    const zero = await pool.query("SELECT COUNT(*)::int AS n FROM query_log WHERE result_count = 0");
    const avgTop = await pool.query("SELECT COALESCE(AVG(top_score),0)::float AS avg_top FROM query_log");
    const buckets = await pool.query(`
      SELECT
        SUM(CASE WHEN top_score >= 0   AND top_score < 0.2 THEN 1 ELSE 0 END)::int AS b0,
        SUM(CASE WHEN top_score >= 0.2 AND top_score < 0.4 THEN 1 ELSE 0 END)::int AS b1,
        SUM(CASE WHEN top_score >= 0.4 AND top_score < 0.6 THEN 1 ELSE 0 END)::int AS b2,
        SUM(CASE WHEN top_score >= 0.6 AND top_score < 0.8 THEN 1 ELSE 0 END)::int AS b3,
        SUM(CASE WHEN top_score >= 0.8 AND top_score <= 1  THEN 1 ELSE 0 END)::int AS b4
      FROM query_log`);
    const docs = await pool.query("SELECT COUNT(*)::int AS n FROM documents");
    const terms = await pool.query("SELECT COUNT(*)::int AS n FROM inverted_index");

    res.json({
      topQueries: top.rows,
      zeroResultCount: zero.rows[0].n,
      avgTopScore: avgTop.rows[0].avg_top,
      scoreBuckets: {
        "0.0-0.2": buckets.rows[0].b0,
        "0.2-0.4": buckets.rows[0].b1,
        "0.4-0.6": buckets.rows[0].b2,
        "0.6-0.8": buckets.rows[0].b3,
        "0.8-1.0": buckets.rows[0].b4,
      },
      totalDocuments: docs.rows[0].n,
      totalTerms: terms.rows[0].n,
    });
  } catch (e) {
    console.error("[analytics]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Trending queries from the past 7 days.
router.get("/trending", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT query_text AS query, COUNT(*)::int AS count " +
      "FROM query_log WHERE searched_at > NOW() - INTERVAL '7 days' " +
      "GROUP BY query_text ORDER BY count DESC, MAX(searched_at) DESC LIMIT 6"
    );
    res.json({ trending: rows });
  } catch (e) {
    console.warn("[analytics/trending]", e.message);
    res.json({ trending: [] });
  }
});

module.exports = router;
