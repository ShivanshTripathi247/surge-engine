import { useNavigate } from "react-router-dom";
import SearchBar from "../components/SearchBar.jsx";
import TrendingChips from "../components/TrendingChips.jsx";

// Landing page: centered logo + search bar + trending chips.
export default function Home() {
  const navigate = useNavigate();
  const go = (q) => navigate(`/search?q=${encodeURIComponent(q)}`);
  return (
    <div className="home">
      <h1 className="home-logo">Surge</h1>
      <div className="home-tagline">
        A search engine built from scratch — crawler, indexer, vectors, and ranking.
      </div>
      <SearchBar onSearch={go} placeholder="Search 10,000 Wikipedia articles…" autoFocus />
      <TrendingChips />
      <div className="home-footer">
        10,000 Wikipedia documents · BM25 + pgvector + PageRank · Gemini AI summaries
      </div>
    </div>
  );
}
