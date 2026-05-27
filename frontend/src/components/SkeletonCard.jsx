// Loading placeholder for results.
export default function SkeletonCard() {
  return (
    <div className="result skeleton">
      <div className="line url" />
      <div className="line title" />
      <div className="line text" />
      <div className="line text text2" />
    </div>
  );
}
