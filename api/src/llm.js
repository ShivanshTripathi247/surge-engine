// Provider router. Tries Ollama first when configured, falls back to Gemini.
// Both wrappers return { text, reason }.
const { callOllama, isConfigured: ollamaConfigured } = require("./ollama");
const { callGemini } = require("./gemini");

const PREFER = (process.env.LLM_PROVIDER || "auto").toLowerCase();

// Pick a provider chain based on env. Default: ollama → gemini.
function chain() {
  if (PREFER === "gemini") return [callGemini];
  if (PREFER === "ollama") return [callOllama];
  return ollamaConfigured() ? [callOllama, callGemini] : [callGemini];
}

// Call providers in order; return the first non-null text.
async function callLLM(prompt, opts) {
  let lastReason = "no_key";
  for (const fn of chain()) {
    const { text, reason } = await fn(prompt, opts);
    if (text) return { text, reason: null };
    lastReason = reason;
    // Don't retry on no_key — try the next provider.
  }
  return { text: null, reason: lastReason };
}

module.exports = { callLLM };
