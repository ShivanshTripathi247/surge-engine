// In-memory prefix Trie over the top-N article titles ranked by PageRank.
// Mirrors to a Redis sorted set so cold starts don't have to re-query Postgres.
//
// Redis mirror note: ZRANGEBYLEX requires every element to share the same
// score, so the `autocomplete_titles` ZSET uses score=0 with the lowercased
// title as the member. PageRank ordering lives in the in-memory Trie via
// node.priority (higher = preferred). The Redis fallback returns lexicographic
// prefix matches without PR re-ranking — acceptable because the Trie covers
// every prefix we expect, and Redis is only the cold-start backup.
const pool = require("../db");
const redis = require("../redis");

const REDIS_KEY = "autocomplete_titles";
const DEFAULT_LIMIT = 500_000;
const REDIS_BATCH = 10_000;

class TrieNode {
  constructor() {
    this.children = new Map();
    this.isEndOfWord = false;
    this.priority = 0;   // higher = better (we store PageRank)
    this.word = "";      // original-case title
  }
}

class Trie {
  constructor() { this.root = new TrieNode(); this.size = 0; }

  // Insert a title with a priority (PageRank score).
  insert(title, priority) {
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
    node.priority = priority;
  }

  // DFS collect every title in the subtree rooted at `node`.
  collect(node, results, cap) {
    if (results.length > cap * 4) return; // soft early-exit
    if (node.isEndOfWord) results.push({ word: node.word, priority: node.priority });
    for (const child of node.children.values()) this.collect(child, results, cap);
  }

  // Return up to 8 matching titles for a prefix, highest PageRank first.
  search(prefix) {
    const key = (prefix || "").toLowerCase();
    let node = this.root;
    for (const ch of key) {
      if (!node.children.has(ch)) return [];
      node = node.children.get(ch);
    }
    const results = [];
    this.collect(node, results, 8);
    results.sort((a, b) => b.priority - a.priority || a.word.localeCompare(b.word));
    return results.slice(0, 8).map((r) => r.word);
  }
}

const trie = new Trie();

// Try Redis-cached title list before hitting Postgres.
async function loadFromRedis() {
  try {
    const exists = await redis.exists(REDIS_KEY);
    if (!exists) return false;
    // No PR scores in the lex-ordered ZSET; rehydrate the Trie with priority=0
    // (lexicographic fallback is fine when warming from cache).
    const titles = await redis.zrange(REDIS_KEY, 0, -1);
    for (const t of titles) trie.insert(t, 0);
    console.log(`Trie built from Redis cache: ${trie.size.toLocaleString()} titles loaded`);
    return true;
  } catch (e) {
    console.warn("[trie] redis load failed:", e.message);
    return false;
  }
}

// Load top-N titles by PageRank from Postgres and mirror to Redis.
async function loadFromPostgres() {
  const limit = Number(process.env.TRIE_LIMIT || DEFAULT_LIMIT);
  console.log(`[trie] loading top ${limit.toLocaleString()} titles by PageRank...`);
  const { rows } = await pool.query(
    `SELECT d.title, p.score
       FROM documents d
       JOIN pagerank p ON p.url = d.url
       WHERE d.title IS NOT NULL AND d.title <> ''
       ORDER BY p.score DESC
       LIMIT $1`,
    [limit]
  );
  console.log(`[trie] Postgres returned ${rows.length.toLocaleString()} rows`);

  for (const r of rows) trie.insert(r.title, Number(r.score) || 0);
  console.log(`Trie built: ${trie.size.toLocaleString()} titles loaded`);

  // Mirror to Redis as a lex-ordered ZSET (all scores = 0).
  try {
    await redis.del(REDIS_KEY);
    let added = 0;
    for (let i = 0; i < rows.length; i += REDIS_BATCH) {
      const slice = rows.slice(i, i + REDIS_BATCH);
      const args = [];
      for (const r of slice) { args.push(0, r.title.toLowerCase()); }
      await redis.zadd(REDIS_KEY, ...args);
      added += slice.length;
    }
    console.log(`Redis mirror: ${added.toLocaleString()} titles synced`);
  } catch (e) {
    console.warn("[trie] redis mirror failed:", e.message);
  }
}

// Public bootstrap: prefer Redis, fall back to Postgres.
async function init() {
  const ok = await loadFromRedis();
  if (!ok) await loadFromPostgres();
}

module.exports = { trie, init };
