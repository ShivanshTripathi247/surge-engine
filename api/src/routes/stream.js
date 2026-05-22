// SSE pipeline endpoint. Emits per-stage events so the SPA can render
// incrementally. Old POST /api/search + /api/summarize are kept for
// backwards-compat (curl tests, healthchecks).
const express = require("express");
const router = express.Router();
const pool = require("../db");

const spellcheck = require("../services/spellcheck");
const queryExpansion = require("../services/queryExpansion");
const bm25 = require("../services/bm25");
const vector = require("../services/vector");
const hybrid = require("../services/hybrid");
const snippet = require("../services/snippet");
const summary = require("../services/summary");

const EXPANSION_TIMEOUT_MS = 800;

// Race a promise against a timeout; return fallback if it loses.
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    promise.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
           .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
  });
}

// Fire-and-forget query log write.
async function logQuery(text, resultCount, topScore, latencyMs) {
  try {
    await pool.query(
      "INSERT INTO query_log(query_text, result_count, top_score, latency_ms) VALUES ($1,$2,$3,$4)",
      [text, resultCount, topScore, latencyMs]
    );
  } catch (e) { console.warn("[stream] query_log:", e.message); }
}

// SSE pipeline handler.
router.post("/", async (req, res) => {
  const query = (req.body?.query || "").toString().trim();
  if (!query) return res.status(400).json({ error: "query required" });

  // SSE headers. X-Accel-Buffering tells nginx not to buffer the stream.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
  });
  res.flushHeaders?.();

  // `res.on("close")` fires when the client disconnects. (Don't use
  // req.on("close") — Express body-parser triggers that after parsing.)
  let aborted = false;
  res.on("close", () => { aborted = true; });

  // Emit one SSE event; no-op once aborted.
  const emit = (event, data) => {
    if (aborted) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const emitError = (stage, message) => emit("error", { stage, message });

  const started = Date.now();

  // 1) spellcheck (sync, fast)
  let spell = { original: query, corrected: query, wasChanged: false };
  try { spell = spellcheck.correct(query); }
  catch (e) { emitError("spellcheck", e.message); }
  emit("spellcheck", { corrected: spell.corrected, wasChanged: spell.wasChanged });
  if (aborted) return res.end();

  // 2) expansion with 800ms race against Gemini
  let expansion = { intent: "informational", expandedTerms: [] };
  try {
    expansion = await withTimeout(
      queryExpansion.expand(spell.corrected),
      EXPANSION_TIMEOUT_MS,
      {
        intent: queryExpansion.classifyIntent(spell.corrected),
        expandedTerms: (spell.corrected.toLowerCase().match(/[a-z0-9]+/g) || []),
        synonyms: [],
      }
    );
  } catch (e) { emitError("expansion", e.message); }
  emit("expansion", { intent: expansion.intent, expandedTerms: expansion.expandedTerms });
  if (aborted) return res.end();

  // 3) retrieve + rank in parallel
  let ranked = [];
  try {
    const [bmMap, vecResults] = await Promise.all([
      bm25.score(expansion.expandedTerms).catch((e) => { emitError("bm25", e.message); return new Map(); }),
      vector.search(spell.corrected).catch((e) => { emitError("vector", e.message); return []; }),
    ]);
    ranked = await hybrid.rank(bmMap, vecResults);
  } catch (e) { emitError("hybrid", e.message); }

  const queryTerms = (spell.corrected.toLowerCase().match(/[a-z0-9]+/g) || []);
  for (const r of ranked) {
    r.snippet = snippet.make(r.content || "", queryTerms);
    delete r.content;
  }

  const latencyMs = Date.now() - started;
  const topScore = ranked.length ? ranked[0].scores.final : 0;
  logQuery(query, ranked.length, topScore, latencyMs);
  emit("results", { results: ranked, meta: { totalResults: ranked.length, latencyMs } });
  if (aborted) return res.end();

  // 4) summary (LLM hop, can be slow). Skip if aborted.
  let answer = null, reason = null;
  if (!aborted) {
    try {
      const out = await summary.generate(spell.corrected, ranked, expansion.intent);
      answer = out?.answer || null;
      reason = out?.reason || null;
    } catch (e) { emitError("summary", e.message); reason = "error"; }
  }
  emit("summary", { answer, reason });

  emit("done", {});
  res.end();
});

module.exports = router;
