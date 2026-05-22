// OSM Nominatim wrapper with 24h Redis cache. Polite UA per Nominatim TOS.
const express = require("express");
const router = express.Router();
const redis = require("../redis");

const TTL = 24 * 60 * 60;
const UA = "SurgeSearchEngine/1.0";

// Return cached entry if present (null if cached as "not found").
async function fromCache(q) {
  try {
    const raw = await redis.get(`geocode:${q}`);
    return raw ? JSON.parse(raw) : undefined;
  } catch { return undefined; }
}

// Store a result (or { found:false }) for 24h.
async function toCache(q, payload) {
  try { await redis.setex(`geocode:${q}`, TTL, JSON.stringify(payload)); } catch {}
}

// Call Nominatim and shape its response.
async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!r.ok) throw new Error(`nominatim http ${r.status}`);
  const arr = await r.json();
  if (!Array.isArray(arr) || arr.length === 0) return { found: false };
  const h = arr[0];
  return {
    found: true,
    lat: Number(h.lat),
    lon: Number(h.lon),
    displayName: h.display_name,
    boundingBox: Array.isArray(h.boundingbox) ? h.boundingbox.map(Number) : null,
  };
}

// GET /api/geocode?q=place_name
router.get("/", async (req, res) => {
  const q = (req.query.q || "").toString().trim().toLowerCase();
  if (!q) return res.status(400).json({ error: "q required" });
  const cached = await fromCache(q);
  if (cached !== undefined) return res.json(cached);
  try {
    const payload = await nominatim(q);
    await toCache(q, payload);
    res.json(payload);
  } catch (e) {
    console.warn("[geocode]", e.message);
    res.json({ found: false });
  }
});

module.exports = router;
