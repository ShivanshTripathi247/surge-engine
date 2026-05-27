import axios from "axios";

const client = axios.create({ baseURL: "/api", timeout: 30000 });

// Autocomplete suggestions for a prefix.
export const suggest = (q) => client.get("/suggest", { params: { q } }).then((r) => r.data.suggestions || []);

// Run a full search query (no AI summary — fetched separately).
export const search = (query) => client.post("/search", { query }).then((r) => r.data);

// Fetch AI summary for a query + the top results from /api/search.
export const summarize = (query, results, intent) =>
  client.post("/summarize", {
    query,
    intent,
    results: (results || []).slice(0, 3).map((r) => ({ title: r.title, snippet: r.snippet })),
  }).then((r) => r.data.answer);

// Analytics dashboard data.
export const analytics = () => client.get("/analytics").then((r) => r.data);

// Health check.
export const health = () => client.get("/health").then((r) => r.data);

// Geocode a place name (Nominatim via api).
export const geocode = (q) => client.get("/geocode", { params: { q } }).then((r) => r.data);

// Trending queries from the past 7 days.
export const trending = () => client.get("/analytics/trending").then((r) => r.data.trending || []);
