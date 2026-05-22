// Gemini 2.5 Flash wrapper. Returns null on any failure (incl. 429).
const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL = "gemini-2.5-flash";
let client = null;
let model = null;

// Lazy init so missing key doesn't crash boot.
function getModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!model) { client = new GoogleGenerativeAI(key); model = client.getGenerativeModel({ model: MODEL }); }
  return model;
}

// Detect rate-limit / quota errors from SDK error shape.
function isRateLimited(err) {
  const s = String(err?.message || err);
  return /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(s);
}

// Send a prompt to Gemini. Returns { text, reason } — text is null on failure.
// reason ∈ "no_key" | "rate_limited" | "error" | null
async function callGemini(prompt, { maxTokens = 400 } = {}) {
  const m = getModel();
  if (!m) return { text: null, reason: "no_key" };
  try {
    const res = await m.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const text = res?.response?.text() ?? null;
    return { text, reason: text ? null : "error" };
  } catch (e) {
    if (isRateLimited(e)) { console.warn("[gemini] rate limited — degrading"); return { text: null, reason: "rate_limited" }; }
    console.warn("[gemini] error:", e.message);
    return { text: null, reason: "error" };
  }
}

module.exports = { callGemini };
