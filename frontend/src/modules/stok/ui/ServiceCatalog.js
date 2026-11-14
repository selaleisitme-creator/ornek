import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getServiceCatalog } from "../server/serviceCatalogService";
import { ServiceAddButton, ServiceItemActions } from "./StockActionButtons";

// Stok · Servis: service and audiology exam prices, VAT included. Server Component; only the buttons and
// their windows run in the browser.
export default async function ServiceCatalog() {
  const groups = await getServiceCatalog();

  return (
    <div className="stock-services">
      <h2 className="stock-services-title">Servis ve muayene fiyatları · KDV dahil</h2>
      {groups.map((group) => (
        <section key={group.category} className="stock-service-group" aria-labelledby={`service-group-${group.category}`}>
          <header className="stock-service-head">
            <h3 id={`service-group-${group.category}`}>
              {group.label} <span className="stock-muted">· {group.items.length} kalem</span>
            </h3>
            <ServiceAddButton category={group.category} categoryLabel={group.label} />
          </header>
          {group.items.length ? (
            <ul className="stock-service-list">
              {group.items.map((item) => (
                <li key={item.id}>
                  <div className="stock-service-name">
                    <strong>{item.name}</strong>
                    <span className="stock-muted">Son fiyat güncellemesi · {formatDate(item.lastPriceChangeAt)}</span>
                  </div>
                  <span className="stock-price">{formatMoney(item.price)}</span>
                  <ServiceItemActions item={item} categoryLabel={group.label} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="ui-table-empty">Bu grupta kalem yok.</p>
          )}
        </section>
      ))}
    </div>
  );
}
