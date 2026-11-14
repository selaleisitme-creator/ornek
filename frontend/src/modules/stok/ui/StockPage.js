import Link from "next/link";
import Tabs from "@/modules/shared/ui/Tabs";
import EmptyState from "@/modules/shared/ui/EmptyState";
import { getStockView } from "../server/stockService";
import { getEntryOptions } from "../server/catalogService";
import { getLastPriceBatch } from "../server/priceService";
import { formatDateTime } from "@/lib/dates";
import { STOCK_GROUPS, STOCK_SECTIONS, priceBatchLabel, readStockQuery, searchTerms, stockHref } from "../stockRules";
import StockToolbar from "./StockToolbar";
import StockEntryButton from "./StockEntryButton";
import StockAlerts from "./StockAlerts";
import ProductGroupList from "./ProductGroupList";
import PriceUndoBar from "./PriceUndoBar";
import ServiceCatalog from "./ServiceCatalog";
import "./stock.css";

// Stok: "Mevcut stok" (default) and "Servis" (?sekme=servis). Everything that changes the view lives in the
// address bar (?sekme, ?grup, ?marka, ?ara, ?gorunum, ?ac), so a refresh or a shared link shows the same thing.
// Each section loads only its own data.
export default async function StockPage({ searchParams }) {
  const query = readStockQuery(await searchParams);
  return (
    <section className="stock-page">
      <header className="stock-head">
        <p className="ui-eyebrow">Şelale İşitme · Yönetim</p>
        <h1>Stok</h1>
        <p>Raftaki cihazlar, aksesuarlar ve piller; servis fiyatları.</p>
      </header>

      <Tabs param="sekme" label="Bölüm" items={STOCK_SECTIONS} />

      {query.sekme === "servis" ? <ServiceCatalog /> : <CurrentStock query={query} />}
    </section>
  );
}

async function CurrentStock({ query }) {
  // Entry options load with the page, so the "Stok ekle" window opens without waiting.
  const [view, entryOptions, lastBatch] = await Promise.all([getStockView(query), getEntryOptions(), getLastPriceBatch()]);
  const searching = Boolean(query.ara);
  // A scanned barcode that matched nothing becomes the new model's GTIN in the entry window.
  const searchedGtin = searching ? (searchTerms(query.ara).gtins[0] ?? null) : null;
  // The toolbar's "Stok sil" works on the open model's units; with no model open it stays disabled.
  const open = view.openModel;
  const removal = open
    ? {
        model: { brandName: open.brandName, name: open.name, category: open.category, serialPolicy: open.serialPolicy },
        units: view.openUnits,
      }
    : null;

  return (
    <>
      <StockToolbar
        searchText={query.ara}
        clearHref={stockHref(query, { ara: null, ac: null })}
        entryOptions={entryOptions}
        removal={removal}
      />

      <StockAlerts alerts={view.alerts} />

      {lastBatch && (
        <PriceUndoBar
          batchId={lastBatch.batchId}
          label={priceBatchLabel({ changedAtText: formatDateTime(lastBatch.changedAt), count: lastBatch.count, names: lastBatch.names })}
          count={lastBatch.count}
        />
      )}

      {searching ? (
        <p className="stock-search-note" role="status">
          Arama: <strong>{query.ara}</strong> · {view.modelCount} model
        </p>
      ) : (
        <div className="stock-filters">
          <Tabs param="grup" label="Ürün grubu" items={STOCK_GROUPS.map((group) => ({ value: group.key, label: group.label }))} />
          {view.brands.length > 0 && (
            <Tabs
              param="marka"
              variant="chips"
              label="Marka"
              items={[{ value: "tumu", label: "Tümü" }, ...view.brands.map((brand) => ({ value: String(brand.id), label: brand.name }))]}
            />
          )}
        </div>
      )}

      {view.modelCount === 0 ? (
        searching ? (
          <EmptyState
            title="Bu barkod ya da seri no stokta yok."
            description="Satılmış ya da silinmiş birimler burada görünmez."
            action={
              <div className="stock-empty-actions">
                <StockEntryButton options={entryOptions} initialGtin={searchedGtin} />
                <Link className="ui-button ui-button-ghost" href={stockHref(query, { ara: null, ac: null })}>Aramayı temizle</Link>
              </div>
            }
          />
        ) : (
          <EmptyState
            title="Henüz stok kaydı yok."
            description={`${view.group.label} grubunda kayıtlı model yok.`}
            action={<StockEntryButton options={entryOptions} />}
          />
        )
      ) : (
        <ProductGroupList
          brandGroups={view.brandGroups}
          query={query}
          openProductId={view.openProductId}
          openUnits={view.openUnits}
          openDetails={view.openDetails}
        />
      )}
    </>
  );
}
