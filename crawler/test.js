// import axios from "axios";
// import * as cheerio from "cheerio";
// import fs from 'fs'
// import { stringify } from "querystring";
// // import data from './res.json' with { type: 'json' };

import redis from "./databases/redisClient.js";


// // console.log(data.text);


// const res = await axios.get("https://en.wikipedia.org/wiki/Artificial_intelligence", {
//   headers: {
//     "User-Agent": "ShivanshSearchEngineBot/1.0 (https://example.com; shivansh@email.com)"
//   }
// });
// const html = res.data;

// fs.writeFile('ai.html', html, err => {
//   if (err) {
//     console.error(err);
//   } else {
//     // file written successfully
//     console.log("successfully written");
    
//   }
// });




// const $ = cheerio.load(html);

// $('style, script, noscript, meta, link').remove();

// $('.reference, .mw-editsection, .navbox, .infobox').remove();



// const $a = $("a");

// console.log($a[40].attribs.href);
// let links = "";

// const st = new Set();
// const $t = $("title");

// console.log($t.text());

// const obj = $.extract({
//     links: [
//         {
//             selector: 'a',
//             value: (el, key) => {
//                 const lang = $(el).attr("lang");
//                 // console.log(lang);
                
//                 if(lang && lang !== "en") {
//                   return "";
//                 } 
//                 const href = $(el).attr("href"); 

//                 if (!href) return "";

//                 if (href.startsWith('#') || href.includes("/w/") || !href.includes("wiki") || href.includes("File:") || href.includes("Category:") || href.includes("Special:") || href.includes("disambiguation") || href.includes("Help") || href.includes("Wikipedia:") || href.startsWith("http")) {
//                     return "";
//                 }
//                 if(!st.has(href)) {
//                   links += `https://en.wikipedia.org${href}
// `
//                 }
//                 st.add(href);

//                 // here i can aso write function to add it in queue and also test it in the set for cycles later
//                 return `${href}`;
//             },
//         },
//     ],
//     text: [
//         {
//             selector: '#bodyContent',
//             value: (el, key) => {
//                 const text = $(el).text().replace(/\s+/g, ' ').replace('\n', ' ').replace('\t', ' ').trim();
//                 // console.log("jhdajhd",text);
                
//                 return `${text}`;
//             },
//         },
//     ],
// })

// const str = obj.text[0];

// fs.writeFile('ailinks.txt', links, err => {
//   if (err) {
//     console.error(err);
//   } else {
//     // file written successfully
//     console.log("successfully written");
    
//   }
// });
// fs.writeFile('aitext.txt', str, err => {
//   if (err) {
//     console.error(err);
//   } else {
//     // file written successfully
//     console.log("successfully written");
    
//   }
// });

// console.log("Number of unique links: ", st.size);

// // console.log("==========\n",$t, "\n===========");


// // for(let i=34; i<37; i++) {
// //     console.log($a[i],"\n");
// // }



// let b = 30;

// $("a").each((i, el) => {
//   if(b===34) {
//     // console.log("i=========\n",i,"\n=========");
//     // console.log("i=========\n",el.childNodes,"\n=========");    
//     const link = $(el).attr("href");
//     if (link) console.log(link);  }
//   b++;
// });

// console.log("carl sagan: ",await redis.sismember("vis", "https://en.wikipedia.org/wiki/Srinivasa_Ramanujan"));


while (await redis.llen("q") >= 0) {
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log(await redis.llen("q"));

}
 