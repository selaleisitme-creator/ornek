import "./page-placeholder.css";

// Stand-in for a module that is not built yet. Each module replaces it with its real page.
export default function PagePlaceholder({ title, description }) {
  return (
    <section className="placeholder">
      <header className="placeholder-head">
        <p className="placeholder-eyebrow">Şelale İşitme · Yönetim paneli</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className="placeholder-box">Bu sayfa sıradaki aşamalarda hazırlanacak.</div>
    </section>
  );
}
