import { Suspense } from "react";
import Link from "next/link";
import Skeleton from "@/modules/shared/ui/Skeleton";
import { io } from "next/cache";
import EmptyState from "@/modules/shared/ui/EmptyState";
import { getStockView } from "../server/stockService";
import { getEntryOptions } from "../server/catalogService";
import { getLastPriceBatch } from "../server/priceService";
import { formatDateTime } from "@/lib/dates";
import { priceBatchLabel, readStockQuery, searchTerms, stockHref } from "../stockRules";
import StockToolbar from "./StockToolbar";
import StockSections from "./StockSections";
import GroupPills from "./GroupPills";
import StockEntryButton from "./StockEntryButton";
import StockAlerts from "./StockAlerts";
import ProductGroupList from "./ProductGroupList";
import PriceUndoBar from "./PriceUndoBar";
import ServiceCatalog from "./ServiceCatalog";
import "./stock.css";

// Stok: "Mevcut stok" (default) and "Servis" (?sekme=servis). Everything that changes the view lives in the
// address bar (?sekme, ?grup, ?marka, ?ara, ?gorunum, ?ac), so a refresh or a shared link shows the same thing.
// Each section loads only its own data.
// The screen-reader heading shows at once; everything that reads the address bar or the database streams in
// behind <Suspense> (Next.js "uncached data outside Suspense"), so the page never waits blank.
export default function StockPage({ searchParams }) {
  return (
    <section className="stock-page">
      {/* The design opens straight with the toolbar card; the heading stays for screen readers. */}
      <h1 className="ui-visually-hidden">Stok</h1>
      <Suspense fallback={<StockLoading />}>
        <StockContent searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function StockContent({ searchParams }) {
  const query = readStockQuery(await searchParams);
  // Dates on this page ("today", price batch times) read the clock; with cacheComponents that must happen at
  // request time, not during prerender (CLAUDE.md: io() before server code that reads time).
  await io();
  return query.sekme === "servis" ? (
    <>
      <div className="stock-toolbar stock-toolbar-plain">
        <StockSections />
      </div>
      <ServiceCatalog />
    </>
  ) : (
    <CurrentStock query={query} />
  );
}

function StockLoading() {
  return (
    <div className="stock-loading" aria-busy="true">
      <Skeleton rows={2} label="Stok araçları yükleniyor…" />
      <Skeleton rows={6} label="Stok listesi yükleniyor…" />
    </div>
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
          label={priceBatchLabel({
            changedAtText: formatDateTime(lastBatch.changedAt),
            count: lastBatch.count,
            names: lastBatch.names,
            field: lastBatch.field,
          })}
          count={lastBatch.count}
        />
      )}

      {searching ? (
        <p className="stock-search-note" role="status">
          Arama: <strong>{query.ara}</strong> · {view.modelCount} model
        </p>
      ) : (
        <GroupPills currentGroup={query.grup} brands={view.brands} />
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
