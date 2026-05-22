// Vector search via HTTP embedder + pgvector ANN.
const { spawn } = require("child_process");
const path = require("path");
const pool = require("../db");

let baseUrl = null;
let proc = null;
let ready = false;

// Poll embedder /health until ready or timeout.
async function waitHealthy(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// In dev, spawn the embedder process locally; in Docker, EMBED_URL is preset.
async function startWorker() {
  baseUrl = process.env.EMBED_URL || "http://localhost:5001";
  if (!process.env.EMBED_URL) {
    const cwd = path.resolve(__dirname, "..", "..", process.env.EMBED_WORKER_CWD || "../vectorizer-ai");
    const py = process.env.EMBED_WORKER_PY || "./.venv/bin/python";
    proc = spawn(py, ["embed_server.py"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (d) => process.stdout.write(`[embed] ${d}`));
    proc.stderr.on("data", (d) => process.stderr.write(`[embed] ${d}`));
    proc.on("exit", (c) => { ready = false; console.warn("[embed] exited", c); });
  }
  ready = await waitHealthy(baseUrl);
  if (!ready) throw new Error(`embedder not healthy at ${baseUrl}`);
  console.log(`[embed] healthy at ${baseUrl}`);
}

// POST to embedder; returns float[] or throws.
async function embed(text) {
  const r = await fetch(`${baseUrl}/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`embed http ${r.status}`);
  const j = await r.json();
  if (!j.vector) throw new Error("embed missing vector");
  return j.vector;
}

// Format as pgvector literal.
function toPgVector(arr) { return "[" + arr.join(",") + "]"; }

// Top-50 ANN search; returns array of {id,url,title,similarity}.
async function search(query) {
  const vec = await embed(query);
  const lit = toPgVector(vec);
  const { rows } = await pool.query(
    "SELECT id, url, title, 1 - (vector <=> $1::vector) AS similarity " +
    "FROM documents WHERE vector IS NOT NULL ORDER BY vector <=> $1::vector LIMIT 50",
    [lit]
  );
  return rows.map((r) => ({ id: r.id, url: r.url, title: r.title, similarity: Number(r.similarity) }));
}

module.exports = { startWorker, embed, search, isReady: () => ready };
