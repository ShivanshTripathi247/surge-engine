/**
 * This file contains the connection logic to
 * connect the postgres server in the background
 */

import postgres from "postgres";

const sql = postgres({
        host: 'localhost',
        port: 5432,
        database: 'search_engine',
        username: 'search_admin',
        password: 'supersecretpassword',
    });

    
( async() => {
    try {
        await sql`SELECT 1`;
        console.log("Connected to PostgreSQL");
    } catch (error) {
        console.error("Error Connecting to PostgreSQL", error.message);
        process.exit(1);
    }

})()

export default sql;
