/**
 * crawler.js — BFS web crawler
 *
 * New in this version vs the original:
 *
 *  1. LINK GRAPH  — every discovered edge (source → target) is written to the
 *     `links` table using a single batched INSERT per page. This is the raw
 *     material for the PageRank pass in Phase 2.
 *
 *  2. REDIS PUB/SUB — after a document is committed to PostgreSQL, the crawler
 *     publishes its content to the "documents:new" channel. The C++ indexer
 *     subscribes to this channel and processes documents in real time without
 *     needing to poll the database or restart.
 *
 *  3. SCRAPPER DECOUPLING — scrapperController no longer manages the Redis
 *     queue. The crawler owns BFS state entirely, which means it can see the
 *     full `outgoingLinks` list before deciding which ones to enqueue.
 *
 *  4. CONCURRENT PROCESSING — instead of processing URLs strictly one-at-a-time
 *     inside the BFS level loop, we process CONCURRENCY_LIMIT URLs in parallel
 *     (each with its own 2 s politeness delay). This keeps the 2 s politeness
 *     window while reducing wall-clock crawl time by the concurrency factor.
 */

import sql from "./databases/postgreSQLClient.js";
import redis from "./databases/redisClient.js";
import scrapper from "./controllers/scrapperController.js";

// ioredis requires a separate client instance for Pub/Sub publishing.
// The `redis` client above is used for BFS queue/visited-set operations.
import Redis from "ioredis";
const publisher = new Redis({ port: 6379, host: "localhost" });
publisher.on("error", (e) => console.error("[PUBLISHER ERROR]", e.message));

// How many pages to fetch in parallel within each BFS level.
// Keep this low — Wikipedia will throttle aggressive crawlers.
const CONCURRENCY_LIMIT = 3;

// Politeness: milliseconds between requests PER concurrent worker.
const POLITENESS_MS = 2000;

const ROOT = "https://en.wikipedia.org/wiki/Computer_science";
const MAX_DOCS = 10_000;

// ---------------------------------------------------------------------------
// saveDocument: writes doc to PostgreSQL and publishes to Redis channel
// ---------------------------------------------------------------------------
async function saveDocument(url, title, text) {
  try {
    const result = await sql`
      INSERT INTO documents (url, title, content)
      VALUES (${url}, ${title}, ${text})
      ON CONFLICT (url) DO NOTHING
      RETURNING id
    `;

    if (result.length === 0) {
      // Row already existed — skip publishing (indexer already saw it)
      return;
    }

    console.log(`[SAVED] ${title}`);

    // Pub/Sub: publish to the channel the C++ indexer subscribes to.
    // Keep the payload lean — the indexer can fetch full text from the DB
    // using the url as a key if it needs more than this.
    const payload = JSON.stringify({ url, title, text });
    await publisher.publish("documents:new", payload);

  } catch (err) {
    console.error(`[DB ERROR] Failed to save "${title}" (${url}): ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// saveLinkGraph: bulk-insert all outgoing edges for this source page.
// Uses a single INSERT ... ON CONFLICT DO NOTHING so re-crawling is safe.
// These rows are the raw material for PageRank convergence in Phase 2.
// ---------------------------------------------------------------------------
async function saveLinkGraph(sourceUrl, outgoingLinks) {
  if (!outgoingLinks || outgoingLinks.length === 0) return;

  try {
    // Build the values array for a multi-row insert
    const rows = outgoingLinks.map((target) => ({
      source_url: sourceUrl,
      target_url: target,
    }));

    await sql`
      INSERT INTO links ${sql(rows, "source_url", "target_url")}
      ON CONFLICT (source_url, target_url) DO NOTHING
    `;
  } catch (err) {
    console.error(`[LINK GRAPH ERROR] ${sourceUrl}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// enqueueNewLinks: add undiscovered links to the BFS queue and visited set
// ---------------------------------------------------------------------------
async function enqueueNewLinks(outgoingLinks) {
  for (const link of outgoingLinks) {
    const currentSize = await redis.scard("vis");
    if (currentSize >= MAX_DOCS) break;

    const alreadySeen = await redis.sismember("vis", link);
    if (!alreadySeen) {
      // lpush + sadd are atomic enough for a single-instance crawler.
      // If you scale to multiple crawler instances, wrap in a Lua script.
      await redis.lpush("q", link);
      await redis.sadd("vis", link);
    }
  }
}

// ---------------------------------------------------------------------------
// processUrl: the unit of work for one URL — fetch, save, link graph, enqueue
// ---------------------------------------------------------------------------
async function processUrl(url) {
  // Politeness delay — each concurrent worker waits before fetching
  await new Promise((r) => setTimeout(r, POLITENESS_MS));

  const queueLen = await redis.llen("q");
  console.log(`[CRAWL] queue=${queueLen}  url=${url}`);

  const result = await scrapper(url);
  if (!result) return; // scrapper already logged the error

  const { title, text, outgoingLinks } = result;

  // Persist document (fire-and-forget ordering is fine — saves are independent)
  if (title && text) {
    await saveDocument(url, title, text);
  }

  // Always persist the link graph regardless of whether the document saved,
  // because we need the graph edges for PageRank even for duplicate docs.
  await saveLinkGraph(url, outgoingLinks);

  // Enqueue links we haven't visited yet
  await enqueueNewLinks(outgoingLinks);
}

// ---------------------------------------------------------------------------
// Main BFS loop
// ---------------------------------------------------------------------------
try {
  // Seed the queue and visited set with the root node
  const alreadySeeded = await redis.sismember("vis", ROOT);
  if (!alreadySeeded) {
    await redis.sadd("vis", ROOT);
    await redis.lpush("q", ROOT);
    console.log(`[INIT] Seeded root: ${ROOT}`);
  } else {
    console.log(`[INIT] Resuming existing crawl (${await redis.scard("vis")} URLs seen)`);
  }

  while (
    (await redis.llen("q")) > 0 &&
    (await redis.scard("vis")) <= MAX_DOCS
  ) {
    // Drain up to CONCURRENCY_LIMIT URLs from the queue and process them
    // concurrently. Using Promise.allSettled means one failure doesn't
    // abort the other concurrent fetches.
    const batch = [];
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
      const url = await redis.rpop("q");
      if (!url) break;
      batch.push(url);
    }

    if (batch.length === 0) break;

    await Promise.allSettled(batch.map((url) => processUrl(url)));
  }

  console.log(`[DONE] Crawl complete. Total URLs seen: ${await redis.scard("vis")}`);
} catch (err) {
  console.error("[FATAL] Crawler crashed:", err);
} finally {
  publisher.disconnect();
}