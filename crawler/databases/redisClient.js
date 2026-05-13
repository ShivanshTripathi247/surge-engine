/**
 * redisClient.js — ioredis connection for BFS queue + visited set
 *
 * Note: a second Redis client ("publisher") is created inside crawler.js
 * specifically for Pub/Sub publishing. ioredis requires a dedicated client
 * for pub/sub because a client in subscribe mode can't issue regular commands.
 * The client here remains free for lpush, rpop, sadd, sismember, etc.
 */
import Redis from "ioredis";

const redis = new Redis({
  port: 6379,
  host: "localhost",
  // Reconnect automatically if the connection drops mid-crawl
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on("connect", () => console.log("[REDIS] Connected"));
redis.on("error", (error) => {
  console.error("[REDIS ERROR]", error.message);
  // Don't exit — let retryStrategy handle reconnection
});

export default redis;