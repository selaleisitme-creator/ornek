import Link from "next/link";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { formatMoney } from "@/lib/money";
import { formatStock, stockLevelInfo } from "../stockRules";

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

// Card view of one brand's models: photo, name, stock, price, status. The link opens the units below.
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
              <strong>{model.name}</strong>
              {model.type && <span className="stock-muted">{model.type}</span>}
              <span>{formatStock(model)}</span>
              <span className="stock-price">{formatMoney(model.salePrice)}</span>
              <StatusBadge tone={level.tone}>{level.label}</StatusBadge>
              <span className="stock-row-actions">
                {editFor?.(model)}
                <Link className="stock-toggle" href={hrefFor(model)} scroll={false}>
                  {open ? "Kayıtları kapat" : "Kayıtları aç"}
                </Link>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
