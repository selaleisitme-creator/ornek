import Link from "next/link";
import Tabs from "@/modules/shared/ui/Tabs";
import EmptyState from "@/modules/shared/ui/EmptyState";
import { getStockView } from "../server/stockService";
import { getEntryOptions } from "../server/catalogService";
import { STOCK_GROUPS, readStockQuery, searchTerms, stockHref } from "../stockRules";
import StockToolbar from "./StockToolbar";
import StockEntryButton from "./StockEntryButton";
import StockAlerts from "./StockAlerts";
import ProductGroupList from "./ProductGroupList";
import "./stock.css";

// Stok · Mevcut stok, with the "Stok ekle" window. Everything that changes the view lives in the address bar
// (?grup, ?marka, ?ara, ?gorunum, ?ac), so a refresh or a shared link shows the same thing.
export default async function StockPage({ searchParams }) {
  const query = readStockQuery(await searchParams);
  // Entry options load with the page, so the "Stok ekle" window opens without waiting.
  const [view, entryOptions] = await Promise.all([getStockView(query), getEntryOptions()]);
  const searching = Boolean(query.ara);
  // A scanned barcode that matched nothing becomes the new model's GTIN in the entry window.
  const searchedGtin = searching ? (searchTerms(query.ara).gtins[0] ?? null) : null;

  return (
    <section className="stock-page">
      <header className="stock-head">
        <p className="ui-eyebrow">Şelale İşitme · Yönetim</p>
        <h1>Stok</h1>
        <p>Raftaki cihazlar, aksesuarlar ve piller.</p>
      </header>

      <StockToolbar searchText={query.ara} clearHref={stockHref(query, { ara: null, ac: null })} entryOptions={entryOptions} />

      <StockAlerts alerts={view.alerts} />

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
        />
      )}
    </section>
  );
}
