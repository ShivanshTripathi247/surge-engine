// Thin Claude API wrapper using fetch (Node 18+). Returns null on any failure.
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// Send a single prompt to Claude messages API and return raw text.
async function callClaude(prompt, { maxTokens = 400, system } = {}) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) return null;
  try {
    const body = {
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    };
    if (system) body.system = system;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("[claude] HTTP", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    return data?.content?.[0]?.text ?? null;
  } catch (e) {
    console.warn("[claude] error:", e.message);
    return null;
  }
}

module.exports = { callClaude };
