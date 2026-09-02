import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trending } from "../api";

// Show up to 6 trending searches under the home page search bar.
export default function TrendingChips() {
  const [items, setItems] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    trending().then((arr) => { if (alive) setItems(arr); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="trending">
      <span className="trending-label">Trending <span aria-hidden>↗</span></span>
      {items.map((t) => (
        <button key={t.query} className="trending-chip" onClick={() => navigate(`/search?q=${encodeURIComponent(t.query)}`)}>
          {t.query}
        </button>
      ))}
    </div>
  );
}
