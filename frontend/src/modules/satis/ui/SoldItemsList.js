import Link from "next/link";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import EmptyState from "@/modules/shared/ui/EmptyState";
import StockSections from "@/modules/stok/ui/StockSections";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { listSoldItems } from "../server/soldService";
import { loadCatalog } from "../server/saleService";
import { RefundButton, SoldItemActions } from "./SoldItemActions";
import { PaymentButton, SaleFollowupButton, WholesaleSaleButton } from "./SaleButtons";
import SoldSearch from "./SoldSearch";
import "./sale.css";

const SIDES = { right: "Sağ", left: "Sol", both: "İki kulak" };

// Stok > Satılan ürünler (docs/faz-2-satis-plani.md, section 3). Server component: the list and the search are plain
// links and a GET form, so they work before any script loads; only the two windows are client code.
//   search: ?ara=; openId: ?ac= (a sale item). The open row is framed in blue and shows its details, which is what the
//   home page's "Tüm satış geçmişi" links to (/stok?sekme=satilan&ac=<id>#sold-<id>).
export default async function SoldItemsList({ search, openId }) {
  const [items, catalog] = await Promise.all([listSoldItems({ search }), loadCatalog()]);
  const refundable = items.filter((item) => !item.refunded);
  const methods = catalog.paymentMethods;

  return (
    <>
      {/* Same card as Mevcut stok's toolbar: search on the left, the section switch and the buttons on the right. */}
      <div className="stock-toolbar sold-toolbar">
        <SoldSearch searchText={search} />
        <div className="stock-toolbar-filters">
          <StockSections />
          <WholesaleSaleButton className="stock-price-button" />
          <RefundButton items={refundable} methods={methods} className="stock-price-button" />
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState title={search ? "Aramaya uyan satış yok" : "Henüz satılan ürün yok"} description="Satışlar hasta kartındaki ＋ Hasta işlem ya da buradaki ⇄ Toptan satış ile kaydedilir." />
      ) : (
        <div className="sold-scroll">
          <table className="sold-table">
            <caption className="ui-visually-hidden">Satılan ürünler</caption>
            <thead>
              <tr>
                <th scope="col">Tarih</th>
                <th scope="col">Ürün</th>
                <th scope="col">Seri no</th>
                <th scope="col">Hasta / alıcı</th>
                <th scope="col" className="ui-end">Satış fiyatı</th>
                <th scope="col">Ödeme</th>
                <th scope="col">Durum</th>
                <th scope="col">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const open = item.saleItemId === openId;
                return (
                  <SoldRow key={item.saleItemId} item={item} open={open} methods={methods} search={search} />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function SoldRow({ item, open, methods, search }) {
  const detailsHref = `/stok?sekme=satilan${search ? `&ara=${encodeURIComponent(search)}` : ""}${open ? "" : `&ac=${item.saleItemId}#sold-${item.saleItemId}`}`;
  return (
    <>
      <tr id={`sold-${item.saleItemId}`} className={open ? "sold-open" : undefined}>
        <td className="sold-num">{formatDate(item.saleDate)}</td>
        <td>
          <b>{item.product}</b>
          <small className="sale-muted"> {item.saleNo}{item.wholesale ? " · toptan" : ""}</small>
        </td>
        <td className="stock-code sold-serial">{item.serial ?? "—"}</td>
        <td>{item.patientId ? <Link href={`/hastalar?ac=${item.patientId}`}>{item.buyer}</Link> : (item.buyer ?? "—")}</td>
        <td className="ui-end sold-num">{formatMoney(item.value)}</td>
        <td>{item.paymentText ?? "—"}</td>
        <td>
          {item.refunded ? (
            <StatusBadge tone="danger">İade edildi</StatusBadge>
          ) : item.missing.length ? (
            <StatusBadge tone="warn">Eksik bilgi</StatusBadge>
          ) : (
            <StatusBadge tone="ok">Tamam</StatusBadge>
          )}
        </td>
        <td>
          <span className="sold-actions">
            <Link href={detailsHref} scroll={false} className={`sold-action sold-action-main${open ? " on" : ""}`} aria-expanded={open}>
              {open ? "Kapat" : "Ayrıntı"}
            </Link>
            <SoldItemActions item={item} methods={methods} />
          </span>
        </td>
      </tr>
      {open && (
        <tr className="sold-open sold-details">
          <td colSpan={8}>
            <dl>
              <div><dt>Satış no</dt><dd>{item.saleNo}</dd></div>
              <div><dt>Alış fiyatı</dt><dd>{formatMoney(item.purchasePrice)}</dd></div>
              <div><dt>Kulak</dt><dd>{SIDES[item.earSide] ?? "—"}</dd></div>
              <div><dt>ÜTS no</dt><dd>{item.utsNo || "—"}</dd></div>
              <div><dt>ÜRT tarihi</dt><dd>{formatDate(item.productionDate)}</dd></div>
              <div><dt>WSA kodu</dt><dd>{item.wsaCode || "—"}</dd></div>
              <div><dt>Garanti bitişi</dt><dd>{formatDate(item.warrantyEnd)}</dd></div>
              {item.refund && (
                <div><dt>İade</dt><dd>{formatDate(item.refund.date)} · {formatMoney(item.refund.amount)}{item.refund.returnsDevice ? " · stoğa döndü" : ""}</dd></div>
              )}
              {item.missing.length > 0 && (
                <div><dt>Eksik</dt><dd>{item.missing.join(", ")}</dd></div>
              )}
            </dl>
            {/* A wholesale sale has no patient card, so its invoice, ÜTS and later payments are completed here. */}
            {item.wholesale && !item.refunded && (
              <div className="sold-detail-actions">
                <SaleFollowupButton saleId={item.saleId} patientId={null} />
                <PaymentButton saleId={item.saleId} patientId={null} />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
