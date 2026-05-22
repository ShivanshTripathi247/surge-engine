const express = require("express");
const router = express.Router();

const pool = require("../db");
const spellcheck = require("../services/spellcheck");
const queryExpansion = require("../services/queryExpansion");
const bm25 = require("../services/bm25");
const vector = require("../services/vector");
const hybrid = require("../services/hybrid");
const snippet = require("../services/snippet");

// Log a single query result into query_log.
async function logQuery(text, resultCount, topScore, latencyMs) {
  try {
    await pool.query(
      "INSERT INTO query_log(query_text, result_count, top_score, latency_ms) VALUES ($1,$2,$3,$4)",
      [text, resultCount, topScore, latencyMs]
    );
  } catch (e) { console.warn("[search] query_log insert failed:", e.message); }
}

// Main search pipeline.
router.post("/", async (req, res) => {
  const started = Date.now();
  const query = (req.body && req.body.query || "").toString().trim();
  if (!query) return res.status(400).json({ error: "query is required" });

  let spell = { original: query, corrected: query, wasChanged: false };
  try { spell = spellcheck.correct(query); } catch (e) { console.warn("[spell]", e.message); }

  let expansion = { intent: "informational", expandedTerms: [], synonyms: [] };
  try { expansion = await queryExpansion.expand(spell.corrected); }
  catch (e) { console.warn("[expand]", e.message); expansion.expandedTerms = spell.corrected.toLowerCase().match(/[a-z0-9]+/g) || []; }

  let bmMap = new Map();
  try { bmMap = await bm25.score(expansion.expandedTerms); }
  catch (e) { console.warn("[bm25]", e.message); }

  let vecResults = [];
  try { vecResults = await vector.search(spell.corrected); }
  catch (e) { console.warn("[vector]", e.message); vecResults = []; }

  let ranked = [];
  try { ranked = await hybrid.rank(bmMap, vecResults); }
  catch (e) { console.error("[hybrid]", e.message); }

  const queryTerms = (spell.corrected.toLowerCase().match(/[a-z0-9]+/g) || []);
  for (const r of ranked) {
    r.snippet = snippet.make(r.content || "", queryTerms);
    delete r.content;
  }

  const latencyMs = Date.now() - started;
  const topScore = ranked.length ? ranked[0].scores.final : 0;
  logQuery(query, ranked.length, topScore, latencyMs);

  res.json({
    spellcheck: { corrected: spell.corrected, wasChanged: spell.wasChanged },
    queryExpansion: { intent: expansion.intent, expandedTerms: expansion.expandedTerms },
    answer: null,
    results: ranked,
    meta: { totalResults: ranked.length, latencyMs },
  });
});

module.exports = router;
