// AI answer card from top-3 results. Returns null on failure or navigational.
const { callLLM } = require("../llm");

// Strip HTML/<mark> tags for the LLM prompt.
function stripTags(s) { return (s || "").replace(/<[^>]+>/g, ""); }

// Parse "answer ... \nSOURCES: ..." into structured shape.
function parseResponse(text) {
  if (!text) return null;
  const idx = text.toUpperCase().indexOf("SOURCES:");
  if (idx < 0) return { answer: text.trim(), sourceSentences: [] };
  const answer = text.slice(0, idx).trim();
  const tail = text.slice(idx + "SOURCES:".length).trim();
  const sentences = tail.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return { answer, sourceSentences: sentences };
}

// Build the prompt and call Claude; null if intent is navigational or call fails.
async function generate(query, results, intent) {
  console.log(`[SUMMARY] key present: ${!!process.env.GEMINI_API_KEY} intent=${intent} top="${results?.[0]?.title || "(none)"}"`);
  if (intent === "navigational") return { answer: null, reason: "skipped_navigational" };
  if (!results || results.length === 0) return { answer: null, reason: "no_results" };
  const top = results.slice(0, 3);
  const excerpts = top
    .map((r, i) => `[${i + 1}] ${r.title}: ${stripTags(r.snippet)}`)
    .join("\n");
  const prompt =
    `Based only on these excerpts, answer the question '${query}' in one short paragraph of 3-5 sentences.\n` +
    `Be informative and specific; do not editorialize.\n` +
    `Then on a new line write SOURCES: followed by the source sentence(s) you used.\n\n` +
    `Excerpts:\n${excerpts}`;
  const { text, reason } = await callLLM(prompt, { maxTokens: 900 });
  if (!text) return { answer: null, reason: reason || "error" };
  const parsed = parseResponse(text);
  if (!parsed) return { answer: null, reason: "parse_failed" };
  return { answer: { text: parsed.answer, sourceSentences: parsed.sourceSentences }, reason: null };
}

module.exports = { generate };
