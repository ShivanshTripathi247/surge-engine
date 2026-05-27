import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import SearchBar from "../components/SearchBar.jsx";
import SpellcheckBanner from "../components/SpellcheckBanner.jsx";
import ExpansionChips from "../components/ExpansionChips.jsx";
import AnswerCard from "../components/AnswerCard.jsx";
import ResultCard from "../components/ResultCard.jsx";
import SkeletonCard from "../components/SkeletonCard.jsx";
import AnalyticsPanel from "../components/AnalyticsPanel.jsx";
import MapCard from "../components/MapCard.jsx";
import { geocode } from "../api";

// Parse one SSE message ("event: X\ndata: Y") into { event, data }.
function parseEvent(block) {
  const lines = block.split("\n");
  let event = "message", data = "";
  for (const l of lines) {
    if (l.startsWith("event:")) event = l.slice(6).trim();
    else if (l.startsWith("data:")) data += l.slice(5).trim();
  }
  try { return { event, data: JSON.parse(data) }; }
  catch { return { event, data: null }; }
}

// Stream POST /api/stream, dispatching each SSE event to a callback.
async function streamSearch(query, onEvent, signal) {
  const res = await fetch("/api/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`stream http ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (block.trim()) onEvent(parseEvent(block));
    }
  }
}

// SERP page: header, banners, AI card, optional map, organic results.
export default function Search() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q") || "";

  const [spell, setSpell] = useState(null);
  const [expansion, setExpansion] = useState(null);
  const [results, setResults] = useState(null);
  const [meta, setMeta] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [answerReason, setAnswerReason] = useState(null);
  const [summaryDone, setSummaryDone] = useState(false);
  const [err, setErr] = useState(null);
  const [map, setMap] = useState(null);
  const [showAnalytics, setShowAnalytics] = useState(false);

  useEffect(() => {
    if (!q) return;
    setSpell(null); setExpansion(null); setResults(null); setMeta(null);
    setAnswer(null); setAnswerReason(null); setSummaryDone(false); setErr(null); setMap(null);

    const ctrl = new AbortController();
    let mapFiredFor = null;

    streamSearch(q, ({ event, data }) => {
      if (event === "spellcheck") setSpell(data);
      else if (event === "expansion") {
        setExpansion(data);
        if (data?.intent === "navigational" && mapFiredFor !== q) {
          mapFiredFor = q;
          geocode(q).then((m) => { if (m && m.found) setMap(m); }).catch(() => {});
        }
      }
      else if (event === "results") {
        setResults(data.results || []);
        setMeta(data.meta || null);
      }
      else if (event === "summary") {
        setAnswer(data?.answer || null);
        setAnswerReason(data?.reason || null);
        setSummaryDone(true);
      }
      else if (event === "error") console.warn("[stream]", data?.stage, data?.message);
    }, ctrl.signal).catch((e) => {
      if (e.name !== "AbortError") setErr(e.message);
    });

    return () => ctrl.abort();
  }, [q]);

  const go = (qq) => navigate(`/search?q=${encodeURIComponent(qq)}`);

  // Tokens we highlight inside the AI answer.
  const queryTerms = ((spell?.corrected) || q || "")
    .toLowerCase().match(/[a-z0-9]+/g) || [];

  const answerLoading = results !== null && !summaryDone;

  return (
    <>
      <header className="header">
        <Link to="/" className="header-logo">Surge</Link>
        <div className="header-search"><SearchBar initialValue={q} onSearch={go} /></div>
        <div className="header-actions">
          <button className="btn" onClick={() => setShowAnalytics(true)}>📊 Analytics</button>
        </div>
      </header>

      <main className="serp">
        {meta && (
          <div className="meta">About {meta.totalResults} results ({meta.latencyMs} ms)</div>
        )}

        {spell && (
          <SpellcheckBanner
            original={q}
            corrected={spell.corrected}
            wasChanged={spell.wasChanged}
            onOriginalClick={(orig) => go(orig)}
          />
        )}

        {expansion && (
          <ExpansionChips
            terms={expansion.expandedTerms}
            intent={expansion.intent}
          />
        )}

        {results !== null && (
          <AnswerCard
            answer={answer}
            loading={answerLoading}
            queryTerms={queryTerms}
            reason={answerReason}
          />
        )}

        {map && <MapCard {...map} query={q} />}

        {err && <div className="err">Couldn’t reach the search API: {err}</div>}

        {results === null && (
          <div className="results">
            <SkeletonCard /><SkeletonCard /><SkeletonCard />
          </div>
        )}

        {results !== null && (
          <div className="results">
            {results.length === 0 && <div className="sub">No results.</div>}
            {results.map((r) => <ResultCard key={r.id} r={r} />)}
          </div>
        )}
      </main>

      {showAnalytics && <AnalyticsPanel onClose={() => setShowAnalytics(false)} />}
    </>
  );
}
