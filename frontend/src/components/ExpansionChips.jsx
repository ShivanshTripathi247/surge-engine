// Expanded-terms chip row + intent badge.
export default function ExpansionChips({ terms, intent }) {
  if (!terms || terms.length === 0) return null;
  return (
    <div className="chips">
      <span className="chips-label">Also searched:</span>
      {terms.map((t) => <span key={t} className="chip">{t}</span>)}
      {intent && <span className={`intent ${intent}`}>{intent}</span>}
    </div>
  );
}
