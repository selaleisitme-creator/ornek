import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  brandHeading,
  brandTotalText,
  formatStock,
  modelTypeLabel,
  receiptLabel,
  serialPreview,
  stockHref,
  stockLevelInfo,
} from "../stockRules";
import ProductCards, { DetailsToggle, ModelPhoto } from "./ProductCards";
import { SideChip, SideChips } from "./SideChips";
import { ModelEditButton, StockRemoveButton, UnitEditButton } from "./StockActionButtons";

// What the unit windows need from the model; the whole summary row would be sent to the browser otherwise.
function unitModel(model) {
  return { brandName: model.brandName, name: model.name, category: model.category, serialPolicy: model.serialPolicy };
}

// Shelf units without a serial number, for the warning when the model's serial rule becomes "Zorunlu".
function serialLessCount(units) {
  return units.reduce((sum, unit) => sum + (unit.serialNo ? 0 : unit.count), 0);
}

// "3 adet" as the design's soft pill; red when nothing is left.
function StockPill({ model }) {
  return <span className={`stock-qty${model.inStock > 0 ? "" : " empty"}`}>{formatStock(model)}</span>;
}

// The open model's shelf units in the design's nested card. Sale price and package barcode belong to the
// model, so every row repeats them (as the design does). Serial-less units from one receipt arrive already
// merged ("8 adet"). A plain scrolling table, not DataTable: on phones the panel scrolls sideways instead of
// turning every unit into a card.
function UnitPanel({ model, units }) {
  const forDialog = unitModel(model);
  return (
    <div className="stock-panel">
      <div className="stock-panel-head">
        <div className="stock-panel-title">
          <strong>{model.brandName} {model.name}</strong>
          {/* Counts units, not rows: a merged "8 adet" row of serial-less units is eight records. */}
          <span>{units.reduce((sum, unit) => sum + (unit.count ?? 1), 0)} cihaz / kayıt</span>
        </div>
        <div className="stock-panel-meta">
          <StockPill model={model} />
          <span className="stock-panel-price">
            <small>Satış fiyatı</small>
            <b>{formatMoney(model.salePrice)}</b>
          </span>
          <span className="stock-panel-price">
            <small>Toptan fiyatı</small>
            <b>{formatMoney(model.wholesalePrice)}</b>
          </span>
          <StockRemoveButton model={forDialog} units={units} />
        </div>
      </div>
      {units.length ? (
        <div className="stock-unit-scroll">
          <table className="stock-unit-table">
            <caption className="ui-visually-hidden">{`${model.brandName} ${model.name} stoktaki kayıtlar`}</caption>
            <thead>
              <tr>
                <th scope="col">Seri no</th>
                <th scope="col">Sağ / Sol</th>
                <th scope="col" className="ui-end">Satış fiyatı</th>
                <th scope="col" className="ui-end">Toptan fiyatı</th>
                <th scope="col" className="ui-end">Alış fiyatı</th>
                <th scope="col">Ambalaj barkodu</th>
                <th scope="col">ÜRT tarihi</th>
                <th scope="col">WSA kodu</th>
                <th scope="col">Giriş tarihi</th>
                <th scope="col">Tedarikçi</th>
                <th scope="col">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.id}>
                  <td className="stock-code">{unit.serialNo ?? `${unit.count} adet`}</td>
                  <td><SideChip side={unit.earSide} /></td>
                  <td className="ui-end">{formatMoney(model.salePrice)}</td>
                  <td className="ui-end">{formatMoney(model.wholesalePrice)}</td>
                  <td className="ui-end">{formatMoney(unit.purchasePrice)}</td>
                  <td className="stock-code">{model.packageBarcode || "—"}</td>
                  <td>{formatDate(unit.productionDate)}</td>
                  <td>{unit.wsaCode || "—"}</td>
                  <td>{formatDate(unit.receivedOn)}</td>
                  <td>{receiptLabel(unit)}</td>
                  <td><UnitEditButton unit={unit} model={forDialog} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ui-table-empty">Bu modelin stokta birimi yok.</p>
      )}
    </div>
  );
}

function ModelRow({ model, open, units, toggleHref, edit }) {
  const level = stockLevelInfo(model.stockLevel);
  return (
    <>
      <tr className={open ? "open" : undefined}>
        <td className="stock-col-model">
          <span className="stock-model-cell">
            <ModelPhoto model={model} size={44} />
            <span>
              <span className="stock-brand-name">{model.brandName}</span>
              <strong className="stock-model-name">{model.name}</strong>
            </span>
          </span>
        </td>
        <td data-label="Varyant / Ürün tipi">
          <span className="stock-cell">
            <span>{modelTypeLabel(model)}</span>
            <SideChips counts={model.earSides} />
          </span>
        </td>
        <td data-label="Stok">
          <span className="stock-cell">
            <StockPill model={model} />
            {model.stockLevel !== "ok" && <StatusBadge tone={level.tone}>{level.label}</StatusBadge>}
          </span>
        </td>
        <td data-label="Ürün barkodu / Seri">
          <span className="stock-cell">
            <span className="stock-code">{model.gtin || "—"}</span>
            <small className="stock-serial">{serialPreview({ firstSerial: model.firstSerial, unitCount: model.shelfCount })}</small>
          </span>
        </td>
        <td className="stock-col-action">
          <span className="stock-row-actions">
            <DetailsToggle href={toggleHref} open={open} />
            {edit}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="stock-units-row">
          <td colSpan={5}>
            <UnitPanel model={model} units={units} />
          </td>
        </tr>
      )}
    </>
  );
}

function ModelTable({ group, openProductId, openUnits, hrefFor, editFor }) {
  return (
    <div className="stock-table-wrap">
      <table className="stock-models">
        <caption className="ui-visually-hidden">{brandHeading(group)}</caption>
        <thead>
          <tr>
            <th scope="col">Marka / Model</th>
            <th scope="col">Varyant / Ürün tipi</th>
            <th scope="col">Stok</th>
            <th scope="col">Ürün barkodu / Seri</th>
            <th scope="col">Ayrıntılar</th>
          </tr>
        </thead>
        <tbody>
          {group.models.map((model) => (
            <ModelRow
              key={model.productId}
              model={model}
              open={model.productId === openProductId}
              units={openUnits}
              toggleHref={hrefFor(model)}
              edit={editFor(model)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One section per brand: "Bernafon" with "Toplam: 4 model · 13 cihaz", then the models as a table or cards.
// Only the "Düzenle" and "Stok sil" buttons are client components (StockActionButtons.js).
export default function ProductGroupList({ brandGroups, query, openProductId, openUnits, openDetails }) {
  const hrefFor = (model) => stockHref(query, { ac: model.productId === openProductId ? null : model.productId });
  const editFor = (model) => {
    const open = model.productId === openProductId;
    return (
      <ModelEditButton
        model={{ brandName: model.brandName, name: model.name, inStock: model.inStock }}
        details={open ? openDetails : null}
        openHref={stockHref(query, { ac: model.productId })}
        serialLessCount={open ? serialLessCount(openUnits) : 0}
      />
    );
  };

  return (
    <div className="stock-brands">
      {brandGroups.map((group) => {
        const openModel = group.models.find((model) => model.productId === openProductId);
        return (
          <section key={group.brandId ?? group.brandName} className="stock-brand">
            <h2>
              <span className="stock-brand-title">{group.brandName}</span>{" "}
              <span className="stock-brand-total">{brandTotalText(group)}</span>
            </h2>
            {query.gorunum === "kart" ? (
              <>
                <ProductCards models={group.models} openProductId={openProductId} hrefFor={hrefFor} editFor={editFor} />
                {openModel && <UnitPanel model={openModel} units={openUnits} />}
              </>
            ) : (
              <ModelTable
                group={group}
                openProductId={openProductId}
                openUnits={openUnits}
                hrefFor={hrefFor}
                editFor={editFor}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
