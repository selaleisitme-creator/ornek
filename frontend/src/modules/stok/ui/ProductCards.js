import Link from "next/link";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { formatMoney } from "@/lib/money";
import { formatStock, modelTypeLabel, serialPreview, stockLevelInfo } from "../stockRules";
import { SideChips } from "./SideChips";

// The model's first photo, or a neutral box with its initial. A plain <img>: next/image would need the
// Supabase host in next.config, and the photos are already shrunk to WebP before upload.
export function ModelPhoto({ model, size }) {
  if (!model.photoUrl) {
    return (
      <span className="stock-photo stock-photo-empty" style={{ width: size, height: size }} aria-hidden="true">
        {model.name.slice(0, 1)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the comment above
    <img className="stock-photo" src={model.photoUrl} alt="" width={size} height={size} loading="lazy" />
  );
}

// "Kayıtları aç ⌄" / "Kayıtları kapat ⌃": a link that sets ?ac=, so the open model survives a refresh and
// needs no client code. Shared by the table rows and the cards.
export function DetailsToggle({ href, open }) {
  return (
    <Link className="stock-toggle" href={href} scroll={false} aria-expanded={open}>
      {open ? "Kayıtları kapat" : "Kayıtları aç"}
      <span className="stock-toggle-arrow" aria-hidden="true">{open ? "⌃" : "⌄"}</span>
    </Link>
  );
}

// Card view of one brand's models: the same facts as a table row (type, side chips, stock, GTIN and first
// serial) plus the photo and the sale price. The link opens the units below the cards.
// editFor(model) gives the card's "Düzenle" button (a client island from the server list).
export default function ProductCards({ models, openProductId, hrefFor, editFor }) {
  return (
    <ul className="stock-cards">
      {models.map((model) => {
        const level = stockLevelInfo(model.stockLevel);
        const open = model.productId === openProductId;
        return (
          <li key={model.productId} className={`stock-card${open ? " open" : ""}`}>
            <ModelPhoto model={model} size={120} />
            <div className="stock-card-body">
              <span className="stock-brand-name">{model.brandName}</span>
              <strong>{model.name}</strong>
              <span className="stock-muted">{modelTypeLabel(model)}</span>
              <SideChips counts={model.earSides} />
              <span className="stock-card-stock">
                <span className={`stock-qty${model.inStock > 0 ? "" : " empty"}`}>{formatStock(model)}</span>
                {model.stockLevel !== "ok" && <StatusBadge tone={level.tone}>{level.label}</StatusBadge>}
              </span>
              <span className="stock-code">{model.gtin || "—"}</span>
              <small className="stock-serial">{serialPreview({ firstSerial: model.firstSerial, unitCount: model.shelfCount })}</small>
              <span className="stock-price">{formatMoney(model.salePrice)}</span>
              <small className="stock-muted">Toptan: {formatMoney(model.wholesalePrice)}</small>
              <span className="stock-row-actions">
                <DetailsToggle href={hrefFor(model)} open={open} />
                {editFor?.(model)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
