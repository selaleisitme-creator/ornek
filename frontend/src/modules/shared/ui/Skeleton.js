// Grey placeholder rows shown inside <Suspense> while a table loads, so the page does not jump.
export default function Skeleton({ rows = 5, label = "Yükleniyor…" }) {
  return (
    <div className="ui-skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="ui-skeleton-row" />
      ))}
    </div>
  );
}
