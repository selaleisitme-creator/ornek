import { formatMoney } from "@/lib/money";
import { formatWholeMoney } from "../homeRules";
import WelcomeCard from "./WelcomeCard";
import BarChart from "./BarChart";
import HistoryCard from "./HistoryCard";
import Suggestions from "./Suggestions";
import ReferralSources from "./ReferralSources";
import "./home.css";

// Draws the home page from the shaped view (homeService.getHomeView). Kept apart from the data loading so
// the layout can be checked with sample data, and so the page stays a thin loader.
const VISIT_SERIES = [
  { name: "Yeni hasta geldi", color: "#8FC3F4" },
  { name: "Mevcut hasta tekrar geldi", color: "#244D9C" },
];

export default function HomeView({ view }) {
  const money = view.sales.mode === "money";

  return (
    <section className="home-page">
      <h1 className="ui-visually-hidden">Anasayfa</h1>
      <WelcomeCard />

      <div className="home-charts">
        <HistoryCard kind="sales" title="Aylık satış" linkLabel="Tüm satış geçmişi ↗" className="home-chart-sales">
          <BarChart
            title={money ? "Son altı ayın satış tutarları" : "Son altı ayın satış adetleri"}
            bars={view.sales.bars.map((bar) => ({ key: bar.key, label: bar.label, values: [bar.value] }))}
            series={[{ name: money ? "Satış" : "Satış adedi", color: "#244D9C" }]}
            formatValue={money ? formatWholeMoney : String}
            axisUnit={money ? 1000 : 1}
            axisLabel={money ? "bin TL" : undefined}
          />
          <div className="home-sales-total">
            <span>{money ? "Toplam satış · tüm dönem" : "Satış adedi · tüm dönem"}</span>
            <b>{money ? formatMoney(view.sales.total) : `${view.sales.total} satış`}</b>
          </div>
        </HistoryCard>

        <HistoryCard kind="visits" title="Hasta yoğunluğu" linkLabel="Yeni ve mevcut ziyaretler ↗" className="home-chart-visits">
          <BarChart
            title="Son altı ayda gelen hastalar"
            bars={view.visits.map((bar) => ({ key: bar.key, label: bar.label, values: [bar.fresh, bar.returning] }))}
            series={VISIT_SERIES}
          />
          <div className="home-legend">
            {VISIT_SERIES.map((series) => (
              <span key={series.name}>
                <i style={{ background: series.color }} aria-hidden="true" />
                {series.name}
              </span>
            ))}
          </div>
        </HistoryCard>

        <article className="home-panel home-chart-payments">
          <div className="home-panel-head">
            <h2>Ödeme şekilleri</h2>
            <span className="home-panel-note">ödeme adedi</span>
          </div>
          {view.payments.rows.length ? (
            <ul className="home-bars" aria-label="Ödeme şekilleri">
              {view.payments.rows.map((row) => (
                <li key={row.code}>
                  <div className="home-bars-label">
                    <span>{row.name}</span>
                    <b>
                      {row.count} · %{row.percent}
                    </b>
                  </div>
                  <div className="home-bars-track">
                    <i style={{ width: `${row.percent}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="home-panel-empty">Henüz hasta ödemesi yok. Satışlarda alınan ödemeler yöntemlerine göre burada sayılır.</p>
          )}
        </article>
      </div>

      <Suggestions items={view.suggestions} />
      <ReferralSources table={view.referrals} />
    </section>
  );
}
