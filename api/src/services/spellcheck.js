// Dictionary-backed spellcheck with Damerau-Levenshtein (built from scratch).
const pool = require("../db");

// Stopwords stripped by the indexer's tokenizer; never "correct" them.
const STOPWORDS = new Set("a an and are as at be but by for from has have he her his i in is it its of on or our she so that the their them they this to was we were what when where which who why will with you your".split(" "));

const dict = new Map();          // term -> frequency
const byLength = new Map();      // length -> [terms]

// Compute Damerau-Levenshtein distance with adjacent-transposition.
function damerauLevenshtein(a, b) {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > 2) return 3;
  const d = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[al][bl];
}

// Load dictionary from inverted_index with aggregated frequencies.
async function init() {
  const sql = `
    SELECT term,
           (SELECT COALESCE(SUM((v)::int), 0)
              FROM jsonb_each_text(postings) AS j(k, v)) AS freq
    FROM inverted_index`;
  const { rows } = await pool.query(sql);
  for (const r of rows) {
    const f = Number(r.freq) || 0;
    if (f <= 0) continue;
    dict.set(r.term, f);
    const l = r.term.length;
    if (!byLength.has(l)) byLength.set(l, []);
    byLength.get(l).push(r.term);
  }
  console.log(`[spellcheck] dictionary loaded: ${dict.size} terms`);
}

// Find best in-dict correction within edit distance <=2, freq-weighted.
// Even when `word` is in the dictionary, prefer a near-neighbor that is
// >=10x more frequent — Wikipedia content contains the typos verbatim.
const FREQ_DOMINANCE = 10;
function bestCorrection(word) {
  const selfFreq = dict.get(word) || 0;
  let bestNeighbor = null;
  const wl = word.length;
  for (let l = Math.max(1, wl - 2); l <= wl + 2; l++) {
    const bucket = byLength.get(l); if (!bucket) continue;
    for (const cand of bucket) {
      if (cand === word) continue;
      const d = damerauLevenshtein(word, cand);
      if (d > 2) continue;
      const f = dict.get(cand) || 0;
      if (!bestNeighbor ||
          d < bestNeighbor.dist ||
          (d === bestNeighbor.dist && f > bestNeighbor.freq)) {
        bestNeighbor = { term: cand, dist: d, freq: f };
      }
    }
  }
  if (selfFreq > 0) {
    if (bestNeighbor && bestNeighbor.freq >= selfFreq * FREQ_DOMINANCE) return bestNeighbor;
    return { term: word, dist: 0, freq: selfFreq };
  }
  return bestNeighbor;
}

// Correct each token in a query; returns {corrected, wasChanged, original}.
function correct(query) {
  const tokens = query.match(/[A-Za-z0-9]+|\s+|[^A-Za-z0-9\s]+/g) || [];
  let changed = false;
  const out = tokens.map((tok) => {
    if (!/^[A-Za-z]+$/.test(tok)) return tok;
    const lc = tok.toLowerCase();
    if (lc.length < 4) return tok;
    if (STOPWORDS.has(lc)) return tok;
    const b = bestCorrection(lc);
    if (b && b.term !== lc && b.dist > 0 && b.dist <= 2) { changed = true; return b.term; }
    return tok;
  });
  return { original: query, corrected: out.join(""), wasChanged: changed };
}

module.exports = { init, correct, _size: () => dict.size };
