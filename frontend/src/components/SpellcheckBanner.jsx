// "Did you mean" / showing-results-for banner.
export default function SpellcheckBanner({ original, corrected, wasChanged, onOriginalClick }) {
  if (!wasChanged) return null;
  return (
    <div className="spellcheck">
      Showing results for: <strong>{corrected}</strong>
      {" · "}
      Search instead for: <a href="#" onClick={(e) => { e.preventDefault(); onOriginalClick(original); }}>{original}</a>
    </div>
  );
}
