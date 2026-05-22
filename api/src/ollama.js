// Ollama wrapper (local LLM). Returns { text, reason } shaped like callGemini.
// Used as a fallback when Gemini is unavailable.
const MODEL = process.env.OLLAMA_MODEL || "llama3:8b";

// True if OLLAMA_URL is set in the env.
function isConfigured() { return !!process.env.OLLAMA_URL; }

// Detect Ollama-side rate-limit-ish error shapes.
function isRateLimited(err) {
  const s = String(err?.message || err);
  return /\b429\b|rate.?limit/i.test(s);
}

// POST /api/generate (non-streaming) and return generated text.
async function callOllama(prompt, { maxTokens = 800 } = {}) {
  if (!isConfigured()) return { text: null, reason: "no_key" };
  const url = `${process.env.OLLAMA_URL.replace(/\/$/, "")}/api/generate`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: maxTokens },
      }),
    });
    if (!r.ok) {
      console.warn("[ollama] HTTP", r.status);
      return { text: null, reason: r.status === 429 ? "rate_limited" : "error" };
    }
    const j = await r.json();
    const text = (j.response || "").trim();
    return { text: text || null, reason: text ? null : "error" };
  } catch (e) {
    if (isRateLimited(e)) { console.warn("[ollama] rate limited"); return { text: null, reason: "rate_limited" }; }
    console.warn("[ollama] error:", e.message);
    return { text: null, reason: "error" };
  }
}

module.exports = { callOllama, isConfigured };
