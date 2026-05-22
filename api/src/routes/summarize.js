const express = require("express");
const router = express.Router();
const summary = require("../services/summary");
const queryExpansion = require("../services/queryExpansion");

// Standalone summary endpoint: called by the SPA after results render.
router.post("/", async (req, res) => {
  const query = (req.body?.query || "").toString().trim();
  const results = Array.isArray(req.body?.results) ? req.body.results : [];
  const intent = req.body?.intent || queryExpansion.classifyIntent(query);
  if (!query) return res.status(400).json({ error: "query required" });
  try {
    const out = await summary.generate(query, results, intent);
    res.json({ answer: out?.answer || null, reason: out?.reason || null });
  } catch (e) {
    console.warn("[summarize]", e.message);
    res.json({ answer: null, reason: "error" });
  }
});

module.exports = router;
