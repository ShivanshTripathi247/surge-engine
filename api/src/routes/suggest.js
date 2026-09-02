const express = require("express");
const router = express.Router();
const { trie } = require("../services/trie");
const redis = require("../redis");

const REDIS_KEY = "autocomplete_titles";

// Recover original-case titles via a small ZSCAN — Redis stores them lowercased
// for lex ordering, but for the 8-result fallback the user-visible cost is tiny.
async function redisPrefixFallback(prefix) {
  try {
    const lc = prefix.toLowerCase();
    const end = lc + "\xff";
    const items = await redis.zrangebylex(REDIS_KEY, `[${lc}`, `[${end}`, "LIMIT", 0, 8);
    return items;
  } catch (e) {
    console.warn("[suggest] redis fallback failed:", e.message);
    return [];
  }
}

// Primary: in-memory Trie (fast, PR-ordered). Fallback: Redis lex prefix scan.
router.get("/", async (req, res) => {
  const q = (req.query.q || "").toString().toLowerCase().trim();
  if (!q) return res.json({ suggestions: [] });
  const trieHits = trie.search(q);
  if (trieHits.length > 0) return res.json({ suggestions: trieHits });
  const fallback = await redisPrefixFallback(q);
  res.json({ suggestions: fallback });
});

module.exports = router;
