import Link from "next/link";
import SuggestionPatient from "./SuggestionPatient";

// "Sistem önerileri": a closed box with a red counter, opened by a click. Each suggestion only points the way
// (a page, a patient, a WhatsApp draft); nothing here changes a record by itself.
const ICONS = {
  phone: "☏",
  invoice: "🧾",
  box: "📦",
  tag: "🏷️",
  globe: "🌐",
  calendar: "🗓️",
  ear: "👂",
  shield: "🛡️",
  disk: "💾",
};

export default function Suggestions({ items }) {
  return (
    <details className="home-suggestions">
      <summary className="home-suggestions-head">
        <div>
          <h2>Sistem önerileri</h2>
          <p>Hasta, stok, randevu ve yedekleme verilerinden koşullara göre hazırlanır. Kayıtları kendiliğinden değiştirmez.</p>
        </div>
        <span className={`home-suggestions-count${items.length ? " has-alert" : ""}`}>
          {items.length ? `${items.length} öneri` : "Öneri yok"}
        </span>
        <span className="home-suggestions-chevron" aria-hidden="true">⌄</span>
      </summary>

      <div className="home-tasks">
        {items.length ? (
          items.map((item) => (
            <article key={item.id} className={`home-task ${item.tone}`}>
              <span className="home-task-icon" aria-hidden="true">{ICONS[item.icon] ?? "•"}</span>
              <div className="home-task-body">
                <span className="home-task-kind">{item.kind}</span>
                <b>{item.title}</b>
                <span className="home-task-detail">{item.detail}</span>
                {item.rule && <span className="home-task-rule">{item.rule}</span>}
                {item.sgkLinks && (
                  <div className="home-sgk-links">
                    {item.sgkLinks.map((link) =>
                      link.url ? (
                        <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer">
                          <span aria-hidden="true">{link.letter}</span>
                          <b>{link.name}</b>
                          <small>{link.hint}</small>
                        </a>
                      ) : (
                        <Link key={link.name} href="/baglantilar">
                          <span aria-hidden="true">{link.letter}</span>
                          <b>{link.name}</b>
                          <small>Adres Bağlantılar&apos;da eklenmemiş</small>
                        </Link>
                      )
                    )}
                  </div>
                )}
                {item.patients?.length > 0 && (
                  <div className="home-task-patients">
                    {item.patients.map((patient) => (
                      <SuggestionPatient key={patient.id} patient={patient} />
                    ))}
                  </div>
                )}
              </div>
              <Link className="home-task-action" href={item.action.href}>
                {item.action.label}
              </Link>
            </article>
          ))
        ) : (
          <p className="home-task-empty">
            <b>Şu an bekleyen bir öneri yok.</b>
            Stok, randevu, hasta takibi ve yedekleme koşulları her sayfa açılışında yeniden kontrol edilir.
          </p>
        )}
      </div>
    </details>
  );
}
