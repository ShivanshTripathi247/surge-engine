const Redis = require("ioredis");
const client = new Redis(process.env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2 });
client.on("error", (e) => console.error("[redis]", e.message));
module.exports = client;
