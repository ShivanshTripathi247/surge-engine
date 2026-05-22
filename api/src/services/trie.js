// In-memory prefix Trie over document titles. Suggestions rank shorter-first.
const pool = require("../db");
const redis = require("../redis");
const REDIS_KEY = "autocomplete_titles";

class TrieNode {
  constructor() {
    this.children = new Map();
    this.isEndOfWord = false;
    this.length = 0;      // length of the stored title (lower = better)
    this.word = "";       // the full title
  }
}

class Trie {
  constructor() { this.root = new TrieNode(); this.size = 0; }

  // Insert a full title (case-folded for matching).
  insert(title) {
    if (!title) return;
    const key = title.toLowerCase();
    let node = this.root;
    for (const ch of key) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
      node = node.children.get(ch);
    }
    if (!node.isEndOfWord) this.size++;
    node.isEndOfWord = true;
    node.word = title;
    node.length = title.length;
  }

  // DFS collect every title in the subtree rooted at `node`.
  collect(node, results) {
    if (node.isEndOfWord) results.push({ word: node.word, length: node.length });
    for (const child of node.children.values()) this.collect(child, results);
  }

  // Return up to 8 matching titles for a prefix, shorter titles first.
  search(prefix) {
    const key = (prefix || "").toLowerCase();
    let node = this.root;
    for (const ch of key) {
      if (!node.children.has(ch)) return [];
      node = node.children.get(ch);
    }
    const results = [];
    this.collect(node, results);
    results.sort((a, b) => a.length - b.length || a.word.localeCompare(b.word));
    return results.slice(0, 8).map((r) => r.word);
  }
}

const trie = new Trie();

// Try Redis-cached title list before hitting Postgres.
async function loadFromRedis() {
  try {
    const exists = await redis.exists(REDIS_KEY);
    if (!exists) return false;
    const titles = await redis.zrange(REDIS_KEY, 0, -1);
    for (const t of titles) trie.insert(t);
    console.log(`[trie] loaded ${trie.size} titles from Redis`);
    return true;
  } catch (e) { console.warn("[trie] redis load failed:", e.message); return false; }
}

// Load every non-null title from documents; mirror to Redis with length as score.
async function loadFromPostgres() {
  const { rows } = await pool.query(
    "SELECT title FROM documents WHERE title IS NOT NULL AND title <> ''"
  );
  const pipe = redis.pipeline();
  pipe.del(REDIS_KEY);
  for (const r of rows) {
    trie.insert(r.title);
    pipe.zadd(REDIS_KEY, r.title.length, r.title);
  }
  try { await pipe.exec(); } catch (e) { console.warn("[trie] redis mirror failed:", e.message); }
  console.log(`[trie] loaded ${trie.size} titles from Postgres + mirrored to Redis`);
}

// Public bootstrap: prefer Redis, fall back to Postgres.
async function init() {
  const ok = await loadFromRedis();
  if (!ok) await loadFromPostgres();
}

module.exports = { trie, init };
