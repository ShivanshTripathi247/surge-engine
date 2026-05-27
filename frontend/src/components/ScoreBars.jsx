import { useState } from "react";

// Collapsible per-result score breakdown.
export default function ScoreBars({ scores }) {
  const [open, setOpen] = useState(false);
  const rows = [
    { k: "bm25", l: "BM25" },
    { k: "vector", l: "Vector" },
    { k: "pagerank", l: "PageRank" },
    { k: "final", l: "Final" },
  ];
  return (
    <>
      <button className="score-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "▾ Hide scores" : "▸ Show scores"}
      </button>
      {open && (
        <div className="score-bars" role="group" aria-label="Score breakdown">
          {rows.map(({ k, l }) => {
            const v = scores?.[k] ?? 0;
            return (
              <div key={k} className={`row ${k}`} style={{ display: "contents" }}>
                <div className="label">{l}</div>
                <div className="bar"><i style={{ width: `${Math.round(v * 100)}%` }} /></div>
                <div className="val">{v.toFixed(3)}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
