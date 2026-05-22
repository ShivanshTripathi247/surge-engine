// Merge BM25 + cosine + PageRank with min-max normalization and weighted sum.
const pool = require("../db");
const pagerank = require("./pagerank");

const W_BM25 = 0.40;
const W_VEC = 0.40;
const W_PR  = 0.20;

// Min-max normalize a Map<id, score> to [0,1].
function normalize(map) {
  const vals = [...map.values()];
  if (vals.length === 0) return map;
  const min = Math.min(...vals); const max = Math.max(...vals);
  const range = max - min;
  const out = new Map();
  for (const [k, v] of map) out.set(k, range === 0 ? 0 : (v - min) / range);
  return out;
}

// Combine signals and return top-10 doc rows with per-doc score breakdown.
async function rank(bm25Map, vecResults) {
  const vecMap = new Map(); for (const v of vecResults) vecMap.set(v.id, v.similarity);
  const candIds = new Set([...bm25Map.keys(), ...vecMap.keys()]);
  if (candIds.size === 0) return [];

  const { rows } = await pool.query(
    "SELECT id, url, title, content FROM documents WHERE id = ANY($1::int[])",
    [[...candIds]]
  );
  const docs = new Map(rows.map((r) => [r.id, r]));
  const urls = rows.map((r) => r.url);
  const prByUrl = await pagerank.fetchScores(urls);

  const prMap = new Map();
  for (const r of rows) prMap.set(r.id, prByUrl.get(r.url) || 0);

  const nBM = normalize(bm25Map);
  const nVec = normalize(vecMap);
  const nPR = normalize(prMap);

  const out = [];
  for (const id of candIds) {
    const d = docs.get(id); if (!d) continue;
    const bm = nBM.get(id) || 0;
    const vc = nVec.get(id) || 0;
    const pr = nPR.get(id) || 0;
    const final = W_BM25 * bm + W_VEC * vc + W_PR * pr;
    out.push({
      id, url: d.url, title: d.title, content: d.content,
      scores: {
        bm25: +bm.toFixed(4), vector: +vc.toFixed(4),
        pagerank: +pr.toFixed(4), final: +final.toFixed(4),
      },
    });
  }
  out.sort((a, b) => b.scores.final - a.scores.final);
  return out.slice(0, 10);
}

module.exports = { rank };
