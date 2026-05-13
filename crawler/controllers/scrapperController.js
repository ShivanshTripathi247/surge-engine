/**
 * scrapperController.js
 *
 * Responsibilities (single concern per function):
 *   fetchPage  — HTTP GET with a polite User-Agent
 *   parsePage  — DOM cleaning, text extraction, title cleaning
 *   findLinks  — extract all valid outgoing Wikipedia /wiki/ links
 *
 * The scrapper no longer touches Redis. Queue management lives entirely
 * in crawler.js so the crawler can decide what to do with the link list
 * (write the links table for PageRank, feed the BFS queue, etc.).
 */

import axios from "axios";
import * as cheerio from "cheerio";

const WIKIPEDIA_BASE = "https://en.wikipedia.org";

// Patterns that produce non-article pages — extend as needed
const EXCLUDED_PREFIXES = [
  "/wiki/File:",
  "/wiki/Category:",
  "/wiki/Special:",
  "/wiki/Help:",
  "/wiki/Wikipedia:",
  "/wiki/Talk:",
  "/wiki/User:",
  "/wiki/Portal:",
  "/wiki/Template:",
];

const USER_AGENT =
  "ShivanshSearchEngineBot/1.0 (https://github.com/shivansh; shivansh@email.com)";

// ---------------------------------------------------------------------------
// fetchPage: isolated HTTP concern so errors are easy to distinguish
// ---------------------------------------------------------------------------
async function fetchPage(url) {
  const res = await axios.get(url, {
    headers: { "User-Agent": USER_AGENT },
    timeout: 10_000,
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// parsePage: DOM → clean text + clean title
// ---------------------------------------------------------------------------
function parsePage(html) {
  const $ = cheerio.load(html);

  // Remove boilerplate that pollutes the text corpus
  $(
    "style, script, noscript, meta, link, " +
    ".reference, .mw-editsection, .navbox, " +
    ".infobox, .reflist, .hatnote, #toc"
  ).remove();

  // BUG FIX: was .replace('\n', ' ') — only replaced the FIRST newline.
  // The regex /[\n\t]+/g replaces ALL newlines and tabs in one pass.
  const text = $("#bodyContent")
    .text()
    .replace(/[\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // BUG FIX: $("title").text() returns "Computer science - Wikipedia".
  // Strip the suffix so the index/UI show clean titles.
  const rawTitle = $("title").text();
  const title = rawTitle.replace(/ [-–] Wikipedia$/, "").trim();

  return { title, text };
}

// ---------------------------------------------------------------------------
// findLinks: returns ALL valid outgoing links found on the page.
// This is the full discovered set — the caller decides which are unvisited.
// We need every link (even visited ones) to build the link graph for PageRank.
// ---------------------------------------------------------------------------
function findLinks(html) {
  const $ = cheerio.load(html);
  const seen = new Set(); // deduplicate within this page before any Redis call
  const links = [];

  $("a[href]").each((_i, el) => {
    // Skip elements with a non-English lang attribute
    const lang = $(el).attr("lang");
    if (lang && lang !== "en") return;

    const href = $(el).attr("href");
    if (!href) return;

    // Must be a relative /wiki/ path (not an external http link, not a #anchor)
    if (!href.startsWith("/wiki/") || href.startsWith("#")) return;

    // Reject utility namespaces
    if (EXCLUDED_PREFIXES.some((p) => href.startsWith(p))) return;

    // Reject disambiguation pages
    if (href.includes("disambiguation")) return;

    const fullUrl = WIKIPEDIA_BASE + href;

    if (!seen.has(fullUrl)) {
      seen.add(fullUrl);
      links.push(fullUrl);
    }
  });

  return links;
}

// ---------------------------------------------------------------------------
// scrapper: public API — returns { title, text, outgoingLinks }
// outgoingLinks is the full set for PageRank graph edges.
// ---------------------------------------------------------------------------
async function scrapper(url) {
  try {
    const html = await fetchPage(url);
    const { title, text } = parsePage(html);
    const outgoingLinks = findLinks(html);

    return { title, text, outgoingLinks };
  } catch (error) {
    // Log with the URL so we know exactly which page failed
    console.error(`[SCRAPPER ERROR] ${url} — ${error.message}`);
    return null;
  }
}

export default scrapper;