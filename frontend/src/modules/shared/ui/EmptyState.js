// What a list shows when it has nothing yet, with an optional next step ("＋ Yeni hasta").
export default function EmptyState({ title, description, action }) {
  return (
    <section className="ui-empty">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </section>
  );
}
