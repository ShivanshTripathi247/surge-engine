/** 
 * This file will contain the crawling logic for our spider
 * BFS
 * Filling Database
*/

import sql from "./databases/postgreSQLClient.js";
import redis from "./databases/redisClient.js";
import scrapper from "./controllers/scrapperController.js";

// Implementing BFS 
try {
    // adding the root node to set and queue
    await redis.sadd("vis","https://en.wikipedia.org/wiki/Computer_science");
    
    await redis.lpush("q","https://en.wikipedia.org/wiki/Computer_science");
    
    while(await redis.llen("q")!=0 && await redis.scard("vis") <= 10000) {
        const size = await redis.llen("q");

        for(let i=0; i<size; i++) {
            console.log("Iteration: ", await redis.llen("q"));

            // adding politeness delay
            await new Promise(resolve => setTimeout(resolve, 2000));

            const nodeURL = await redis.rpop("q");
            // awaiting for cleaned text and title of the current node website
            const res = await scrapper(nodeURL);
            // postgreSQL database populating logic 
            if (res && res.text && res.title) {
                
                // Inserting data into the database
                try {
                    await sql`
                        INSERT INTO documents (url, title, content) 
                        VALUES (${nodeURL}, ${res.title}, ${res.text})
                        ON CONFLICT (url) DO NOTHING;
                    `;
                    console.log(`[SAVED] ${res.title}`);
                } catch (dbError) {
                    console.error(`[DB ERROR] Failed to save ${nodeURL}:`, dbError.message);
                }
            }

        }
    }
} catch (error) {
    console.error("Error crawling: ", error)
}

