const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DB_CONNECTION_STRING, max: 10 });
module.exports = pool;
