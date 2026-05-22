// Pick the densest 200-char window of query terms and <mark> the hits.
const WINDOW = 200;

// Escape a string for safe insertion into a RegExp.
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Build a case-insensitive regex matching any of the terms as whole-ish words.
function buildRegex(terms) {
  const cleaned = [...new Set(terms.filter(Boolean).map((t) => t.toLowerCase()))];
  if (cleaned.length === 0) return null;
  return new RegExp("(" + cleaned.map(escapeRe).join("|") + ")", "gi");
}

// Slide a fixed-size window and count term hits to find the best center.
function bestWindow(content, regex) {
  const hits = [];
  let m; while ((m = regex.exec(content)) !== null) hits.push(m.index);
  if (hits.length === 0) return { start: 0, end: Math.min(content.length, WINDOW) };
  let bestStart = 0, bestCount = 0;
  for (const h of hits) {
    const start = Math.max(0, h - Math.floor(WINDOW / 2));
    const end = start + WINDOW;
    let c = 0;
    for (const x of hits) if (x >= start && x < end) c++;
    if (c > bestCount) { bestCount = c; bestStart = start; }
  }
  return { start: bestStart, end: Math.min(content.length, bestStart + WINDOW) };
}

// Round window edges out to whitespace so we never cut a word.
function snapToWord(content, start, end) {
  while (start > 0 && /\S/.test(content[start - 1])) start--;
  while (end < content.length && /\S/.test(content[end])) end++;
  return { start, end };
}

// Extract + highlight a snippet for a doc; returns string with <mark> tags.
function make(content, terms) {
  if (!content) return "";
  const regex = buildRegex(terms);
  if (!regex) return content.slice(0, WINDOW) + (content.length > WINDOW ? "..." : "");
  const win = bestWindow(content, regex);
  const snapped = snapToWord(content, win.start, win.end);
  let frag = content.slice(snapped.start, snapped.end);
  frag = frag.replace(buildRegex(terms), "<mark>$1</mark>");
  const prefix = snapped.start > 0 ? "..." : "";
  const suffix = snapped.end < content.length ? "..." : "";
  return prefix + frag.trim() + suffix;
}

module.exports = { make };
