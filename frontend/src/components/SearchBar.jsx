import { useEffect, useRef, useState } from "react";
import { suggest } from "../api";

const HISTORY_KEY = "surge_history";
const HISTORY_MAX = 8;

// Read history list from localStorage; tolerate corruption.
function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}

// Push a query to history (newest first, deduped, capped).
function pushHistory(q) {
  const cur = readHistory().filter((x) => x !== q);
  cur.unshift(q);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(cur.slice(0, HISTORY_MAX)));
}

// Remove a single history entry.
function removeHistory(q) {
  const cur = readHistory().filter((x) => x !== q);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(cur));
  return cur;
}

// Shared search bar: debounced suggestions, keyboard nav, recent-history fallback.
export default function SearchBar({ initialValue = "", onSearch, placeholder = "Search…", autoFocus = false }) {
  const [value, setValue] = useState(initialValue);
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState("suggestions"); // "suggestions" | "history"
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [history, setHistory] = useState(readHistory());
  const ref = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => { setValue(initialValue); }, [initialValue]);

  // Debounce suggestion fetches OR show history when input is empty.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (!q) {
      const h = readHistory();
      setHistory(h);
      setMode("history");
      setItems(h);
      setActive(-1);
      return;
    }
    setMode("suggestions");
    debounceRef.current = setTimeout(async () => {
      try {
        const s = await suggest(q.toLowerCase());
        setItems(s); setOpen(s.length > 0); setActive(-1);
      } catch { setItems([]); }
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  // Close dropdown on outside click.
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Submit either the active item or the typed value; record to history.
  function submit(qOverride) {
    const q = (qOverride ?? value).trim();
    if (!q) return;
    pushHistory(q);
    setOpen(false);
    onSearch(q);
  }

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); submit(active >= 0 ? items[active] : undefined); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  // Bold the matching prefix in suggestion text.
  function highlightPrefix(s) {
    const p = value.toLowerCase();
    if (!p || !s.toLowerCase().startsWith(p)) return s;
    return (<><span className="prefix">{s.slice(0, p.length)}</span>{s.slice(p.length)}</>);
  }

  function clearAll() {
    localStorage.setItem(HISTORY_KEY, "[]");
    setHistory([]); setItems([]); setOpen(false);
  }

  function removeOne(q) {
    const next = removeHistory(q);
    setHistory(next); setItems(next);
    if (next.length === 0) setOpen(false);
  }

  const showHistory = mode === "history" && history.length > 0;
  const showSuggest = mode === "suggestions" && items.length > 0;

  return (
    <div className="searchbar" ref={ref}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => { if (showHistory || showSuggest) setOpen(true); }}
        onKeyDown={onKey}
        aria-label="Search"
      />
      {open && (showSuggest || showHistory) && (
        <div className="suggest-list" role="listbox">
          {showHistory && <div className="suggest-section">Recent</div>}
          <ul>
            {items.map((s, i) => (
              <li
                key={s}
                role="option"
                aria-selected={active === i}
                className={active === i ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); submit(s); }}
              >
                <span className="icon">{mode === "history" ? "⏱" : "🔍"}</span>
                <span className="grow">{mode === "history" ? s : highlightPrefix(s)}</span>
                {mode === "history" && (
                  <span
                    className="hx"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeOne(s); }}
                    aria-label={`Remove ${s} from history`}
                  >×</span>
                )}
              </li>
            ))}
          </ul>
          {showHistory && (
            <div className="suggest-foot">
              <a href="#" onMouseDown={(e) => { e.preventDefault(); clearAll(); }}>Clear history</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
