/**
 * This file contains the scrapping logic specific to 
 * wikipedia webpage
 */

import axios from "axios";
import * as cheerio from "cheerio";
import redis from "../databases/redisClient.js";


async function scrapper(link) {
    try {
        // fetching the HTML from the URL link
        const res = await axios.get(link,  {
            headers: {
                "User-Agent": "ShivanshSearchEngineBot/1.0 (https://example.com; shivansh@email.com)"
            }
        });
        const html = res.data;
    
        const $ = cheerio.load(html); // loading html on cheerio
    
        // purging the unnecessary boilerplate and style for proper extraction
    
        $('style, script, noscript, meta, link').remove();
        $('.reference, .mw-editsection, .navbox, .infobox').remove();

        
        // extracting title
        const title = $("title").text();

        // removing regex from the collected text
        const text = $("#bodyContent").text().replace(/\s+/g, ' ').replace('\n', ' ').replace('\t', ' ').trim();

        const foundLinks = [];
        $("a").each((i, element) => {
            // language check
            const lang = $(element).attr("lang");
            if(!lang || lang === "en") {
                const href = $(element).attr("href");

                if(href) {
                    // filtering the links to extract only what we really
                    if (!href.startsWith('#') && !href.includes("/w/") && href.includes("wiki") 
                        && !href.includes("File:") && !href.includes("Category:") 
                        && !href.includes("Special:") && !href.includes("disambiguation") 
                        && !href.includes("Help") && !href.includes("Wikipedia:") && !href.startsWith("http")) {
                        
                        const baseLink = "https://en.wikipedia.org";
                        const nextLink = baseLink + href;
                        
                        foundLinks.push(nextLink);
                    }
                }
            }
        })

        for(const nextLink of foundLinks) {
            // checking and pushing the links in the set and queue
            const isVisited = await redis.sismember("vis", nextLink);
            const totalLinks = await redis.scard("vis");
            if(!isVisited && totalLinks  < 10000) {
                await redis.lpush("q", nextLink);
                await redis.sadd("vis", nextLink);
            }
        }

        return {title: title, text: text};

    } catch (error) {
        console.error(`Error scrapping ${link}: `, error);
    }

}

export default scrapper;