import Link from "next/link";
import DataTable from "@/modules/shared/ui/DataTable";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  brandHeading,
  earSideLabel,
  formatEarSides,
  formatStock,
  receiptLabel,
  stockHref,
  stockLevelInfo,
} from "../stockRules";
import ProductCards, { ModelPhoto } from "./ProductCards";

const UNIT_COLUMNS = [
  { key: "serialNo", label: "Seri no", render: (unit) => unit.serialNo ?? `${unit.count} adet` },
  { key: "earSide", label: "Taraf", render: (unit) => earSideLabel(unit.earSide) },
  { key: "productionDate", label: "ÜRT tarihi", render: (unit) => formatDate(unit.productionDate) },
  { key: "wsaCode", label: "WSA kodu" },
  { key: "purchasePrice", label: "Alış fiyatı", align: "end", render: (unit) => formatMoney(unit.purchasePrice) },
  { key: "receivedOn", label: "Giriş tarihi", render: (unit) => formatDate(unit.receivedOn) },
  { key: "receipt", label: "Tedarikçi · fatura no", render: receiptLabel },
];

// The open model's shelf units. Serial-less units from one receipt arrive already merged ("8 adet").
function UnitRows({ model, units }) {
  return (
    <div className="stock-units">
      <DataTable
        columns={UNIT_COLUMNS}
        rows={units}
        caption={`${model.brandName} ${model.name} stoktaki kayıtlar`}
        empty="Bu modelin stokta birimi yok."
      />
    </div>
  );
}

function StockCell({ model }) {
  const sides = model.earSides ? formatEarSides(model.earSides) : "";
  return (
    <span className="stock-cell">
      <span>{formatStock(model)}</span>
      {sides && <span className="stock-muted">{sides}</span>}
    </span>
  );
}

function ModelRow({ model, open, units, toggleHref }) {
  const level = stockLevelInfo(model.stockLevel);
  return (
    <>
      <tr className={open ? "open" : undefined}>
        <td className="stock-col-photo">
          <ModelPhoto model={model} size={44} />
        </td>
        <td data-label="Model">
          <span className="stock-muted stock-brand-name">{model.brandName}</span>
          <strong className="stock-model-name">{model.name}</strong>
        </td>
        <td data-label="Tip">{model.type || "—"}</td>
        <td data-label="Stok">
          <StockCell model={model} />
        </td>
        <td data-label="GTIN" className="stock-code">{model.gtin || "—"}</td>
        <td data-label="Satış fiyatı" className="ui-end">{formatMoney(model.salePrice)}</td>
        <td data-label="Durum">
          <StatusBadge tone={level.tone}>{level.label}</StatusBadge>
        </td>
        <td className="stock-col-action">
          <Link className="stock-toggle" href={toggleHref} scroll={false}>
            {open ? "Kayıtları kapat" : "Kayıtları aç"}
          </Link>
        </td>
      </tr>
      {open && (
        <tr className="stock-units-row">
          <td colSpan={8}>
            <UnitRows model={model} units={units} />
          </td>
        </tr>
      )}
    </>
  );
}

function ModelTable({ group, openProductId, openUnits, hrefFor }) {
  return (
    <div className="stock-table-wrap">
      <table className="stock-models">
        <caption className="ui-visually-hidden">{brandHeading(group)}</caption>
        <thead>
          <tr>
            <th scope="col"><span className="ui-visually-hidden">Fotoğraf</span></th>
            <th scope="col">Model</th>
            <th scope="col">Tip</th>
            <th scope="col">Stok</th>
            <th scope="col">GTIN</th>
            <th scope="col" className="ui-end">Satış fiyatı</th>
            <th scope="col">Durum</th>
            <th scope="col"><span className="ui-visually-hidden">Kayıtlar</span></th>
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
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One section per brand: "Bernafon · 4 model · 13 cihaz", then the models as a table or as cards.
// "Kayıtları aç" is a link that sets ?ac=, so the open model survives a refresh and needs no client code.
export default function ProductGroupList({ brandGroups, query, openProductId, openUnits }) {
  const hrefFor = (model) => stockHref(query, { ac: model.productId === openProductId ? null : model.productId });

  return (
    <div className="stock-brands">
      {brandGroups.map((group) => {
        const openModel = group.models.find((model) => model.productId === openProductId);
        return (
          <section key={group.brandId ?? group.brandName} className="stock-brand">
            <h2>{brandHeading(group)}</h2>
            {query.gorunum === "kart" ? (
              <>
                <ProductCards models={group.models} openProductId={openProductId} hrefFor={hrefFor} />
                {openModel && <UnitRows model={openModel} units={openUnits} />}
              </>
            ) : (
              <ModelTable group={group} openProductId={openProductId} openUnits={openUnits} hrefFor={hrefFor} />
            )}
          </section>
        );
      })}
    </div>
  );
}
