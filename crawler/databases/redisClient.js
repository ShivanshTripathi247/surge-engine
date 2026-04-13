/** 
 * This file contains the logic to connect
 * to the redis server in the background
*/
import Redis from "ioredis";


const redis = new Redis({
        port: 6379,
        host: 'localhost',
    });

    redis.on("connect", () => {
        console.log("Connected to Redis");
    })

    redis.on("error", (error) => {
        console.error("Error Connecting to Redis: ", error.message);
        process.exit(1);
    })

export default redis;