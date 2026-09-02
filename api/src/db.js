const { Pool } = require("pg");

// Build a connection config. Prefer discrete DB_HOST/DB_PORT/etc; fall back
// to DB_CONNECTION_STRING for backwards compatibility with the Compose setup.
function buildConfig() {
  if (process.env.DB_CONNECTION_STRING) {
    return { connectionString: process.env.DB_CONNECTION_STRING, max: 20 };
  }
  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "search_engine",
    user: process.env.DB_USER || "search_admin",
    password: process.env.DB_PASSWORD || "",
    max: 20,
  };
}

const pool = new Pool(buildConfig());
module.exports = pool;
