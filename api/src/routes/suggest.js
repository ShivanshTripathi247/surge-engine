const express = require("express");
const router = express.Router();
const { trie } = require("../services/trie");

// Prefix autocomplete from in-memory trie.
router.get("/", (req, res) => {
  const q = (req.query.q || "").toString().toLowerCase().trim();
  if (!q) return res.json({ suggestions: [] });
  res.json({ suggestions: trie.search(q) });
});

module.exports = router;
