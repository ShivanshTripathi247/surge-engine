import ScoreBars from "./ScoreBars.jsx";

// Format a URL as "host › path › Page".
function crumb(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return [u.hostname, ...parts].join(" › ");
  } catch { return url; }
}

// One organic result card with snippet + score breakdown.
export default function ResultCard({ r }) {
  return (
    <article className="result">
      <div className="crumb">{crumb(r.url)}</div>
      <h3 className="result-title"><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></h3>
      <div className="snippet" dangerouslySetInnerHTML={{ __html: r.snippet || "" }} />
      <ScoreBars scores={r.scores} />
    </article>
  );
}
