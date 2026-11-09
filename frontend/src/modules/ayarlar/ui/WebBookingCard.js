import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { formatDateTime } from "@/lib/dates";
import { PUBLIC_BOOKING_URL } from "@/lib/site";

// "Web sitesinden randevu": shows at a glance that the website's form reaches the panel.
// The design asked for an API address here; it is not needed because the site and the panel share one
// database, so the card shows the live state instead.
export default function WebBookingCard({ pendingCount, lastRequestAt }) {
  return (
    <section className="settings-card">
      <header>
        <h2>Web sitesinden randevu</h2>
        <p>Sitedeki form ve panel aynı veritabanını kullanır; talepler anında buraya düşer.</p>
      </header>

      <dl className="settings-facts">
        <dt>Form adresi</dt>
        <dd>
          <a href={PUBLIC_BOOKING_URL} target="_blank" rel="noopener noreferrer">
            selaleisitme.com/randevu ↗
          </a>
        </dd>
        <dt>Bekleyen talep</dt>
        <dd>
          {pendingCount > 0 ? <StatusBadge tone="warn">{pendingCount} talep</StatusBadge> : <StatusBadge tone="ok">Yok</StatusBadge>}
        </dd>
        <dt>Son talep</dt>
        <dd>{lastRequestAt ? formatDateTime(lastRequestAt) : "Henüz talep gelmedi"}</dd>
      </dl>

      <p className="settings-hint" style={{ margin: 0 }}>
        Talepleri onaylama ya da reddetme Randevular sayfasına eklenecek.
      </p>
    </section>
  );
}
