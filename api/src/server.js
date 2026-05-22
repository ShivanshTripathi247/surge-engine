require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const pool = require("./db");
const redis = require("./redis");
const trieSvc = require("./services/trie");
const bm25 = require("./services/bm25");
const vector = require("./services/vector");
const spellcheck = require("./services/spellcheck");

const searchRoute = require("./routes/search");
const suggestRoute = require("./routes/suggest");
const analyticsRoute = require("./routes/analytics");
const summarizeRoute = require("./routes/summarize");
const geocodeRoute = require("./routes/geocode");
const streamRoute = require("./routes/stream");

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "256kb" }));

app.use("/api/search", searchRoute);
app.use("/api/suggest", suggestRoute);
app.use("/api/analytics", analyticsRoute);
app.use("/api/summarize", summarizeRoute);
app.use("/api/geocode", geocodeRoute);
app.use("/api/stream", streamRoute);

// Liveness + dependency check.
app.get("/api/health", async (_req, res) => {
  let dbConnected = false, redisConnected = false;
  try { await pool.query("SELECT 1"); dbConnected = true; } catch {}
  try { redisConnected = (await redis.ping()) === "PONG"; } catch {}
  res.json({
    status: "ok",
    trieTerms: trieSvc.trie.size,
    dbConnected, redisConnected,
    embedderReady: vector.isReady(),
  });
});

// Boot all services then start listening.
async function start() {
  console.log("[boot] initializing services...");
  await Promise.all([
    bm25.init(),
    spellcheck.init(),
    trieSvc.init(),
    vector.startWorker(),
  ]);
  const port = Number(process.env.PORT || 3001);
  app.listen(port, () => console.log(`[boot] API listening on :${port}`));
}

start().catch((e) => { console.error("[boot] fatal:", e); process.exit(1); });
