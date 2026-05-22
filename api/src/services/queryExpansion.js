// Classify intent + LLM-based synonym expansion. Degrades to original terms.
const { callLLM } = require("../llm");

const TECH_WORDS = ["algorithm","implement","how to","code","function","compile","syntax","library","framework"];
const NAV_WORDS = ["wiki","wikipedia","site","homepage","official"];

// Cheap rule-based intent label.
function classifyIntent(query) {
  const q = query.toLowerCase();
  if (NAV_WORDS.some((w) => q.includes(w))) return "navigational";
  if (/\b[A-Z][a-z]+\s+[A-Z][a-z]+/.test(query)) return "navigational";
  if (TECH_WORDS.some((w) => q.includes(w))) return "technical";
  return "informational";
}

// Tokenize on word boundaries, lowercase.
function tokenize(s) { return (s.toLowerCase().match(/[a-z0-9]+/g) || []); }

// Try Claude for synonyms; return [] on any failure.
async function llmSynonyms(query) {
  const prompt =
    `Given the search query: '${query}'\n` +
    `Return a JSON array of 4 synonym phrases that mean the same thing.\n` +
    `Only return the JSON array, nothing else.`;
  const { text } = await callLLM(prompt, { maxTokens: 200 });
  if (!text) return [];
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end < 0) return [];
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch { return []; }
}

// Run intent + expansion; returns {intent, expandedTerms, synonyms}.
async function expand(query) {
  const intent = classifyIntent(query);
  const baseTerms = tokenize(query);
  let synonyms = [];
  try { synonyms = await llmSynonyms(query); } catch { synonyms = []; }
  const synTerms = synonyms.flatMap(tokenize);
  const expandedTerms = [...new Set([...baseTerms, ...synTerms])];
  console.log(JSON.stringify({ originalQuery: query, intent, expandedTerms }));
  return { intent, expandedTerms, synonyms };
}

module.exports = { expand, classifyIntent };
