import { useEffect, useState } from "react";
import { analytics } from "../api";

// Slide-in analytics dashboard powered by /api/analytics.
export default function AnalyticsPanel({ onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { analytics().then(setData).catch((e) => setErr(e.message)); }, []);

  const stackColors = ["#ef4444", "#f59e0b", "#eab308", "#10b981", "#3b82f6"];

  return (
    <div className="analytics-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="analytics" role="dialog" aria-label="Analytics">
        <button className="btn analytics-close" onClick={onClose}>Close ✕</button>
        <h2>Analytics</h2>
        <div className="sub">Live data from <code>/api/analytics</code></div>

        {err && <div className="err">{err}</div>}
        {!data && !err && <div className="sub">Loading…</div>}

        {data && (
          <>
            <section>
              <h3>Corpus</h3>
              <div className="bignum">
                <div><div className="n">{data.totalDocuments.toLocaleString()}</div><div className="l">documents</div></div>
                <div><div className="n">{data.totalTerms.toLocaleString()}</div><div className="l">unique terms</div></div>
              </div>
            </section>

            <section>
              <h3>Top searches</h3>
              {data.topQueries.length === 0 && <div className="sub">No searches yet</div>}
              {data.topQueries.map((q) => {
                const max = Math.max(...data.topQueries.map((x) => x.hits));
                return (
                  <div className="tbar" key={q.query_text}>
                    <div className="b"><i style={{ width: `${(q.hits / max) * 100}%` }} /><span>{q.query_text}</span></div>
                    <div className="c">{q.hits}</div>
                  </div>
                );
              })}
            </section>

            <section>
              <h3>Zero-result queries</h3>
              <div className="bignum"><div><div className="n">{data.zeroResultCount}</div><div className="l">misses</div></div></div>
            </section>

            <section>
              <h3>Average top score</h3>
              <div className="gauge"><i style={{ width: `${Math.round((data.avgTopScore || 0) * 100)}%` }} /></div>
              <div className="sub" style={{ marginTop: 6 }}>{(data.avgTopScore || 0).toFixed(3)}</div>
            </section>

            <section>
              <h3>Score distribution</h3>
              {(() => {
                const b = data.scoreBuckets || {};
                const keys = Object.keys(b);
                const total = keys.reduce((s, k) => s + b[k], 0) || 1;
                return (
                  <>
                    <div className="stack">
                      {keys.map((k, i) => {
                        const pct = (b[k] / total) * 100;
                        if (pct === 0) return null;
                        return <div key={k} style={{ width: `${pct}%`, background: stackColors[i] }}>{b[k]}</div>;
                      })}
                    </div>
                    <div className="sub" style={{ marginTop: 6 }}>{keys.join(" · ")}</div>
                  </>
                );
              })()}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
