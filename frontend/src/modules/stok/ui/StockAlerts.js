import Link from "next/link";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { stockGroupByCategory, stockHref, stockLevelInfo } from "../stockRules";

// "Stok uyarıları (5) · 3 bitti · 2 azalıyor". Closed by default so it never pushes the list down;
// each row opens that model in its own group.
export default function StockAlerts({ alerts }) {
  if (!alerts.items.length) return null;

  const counts = [alerts.out && `${alerts.out} bitti`, alerts.low && `${alerts.low} azalıyor`].filter(Boolean).join(" · ");

  return (
    <details className="stock-alerts">
      <summary>
        Stok uyarıları ({alerts.items.length}) · {counts}
      </summary>
      <ul>
        {alerts.items.map((item) => {
          const level = stockLevelInfo(item.stockLevel);
          return (
            <li key={item.productId}>
              <Link href={stockHref({}, { grup: stockGroupByCategory(item.category).key, ac: item.productId })}>
                {item.brandName} · {item.name}
              </Link>
              <span className="stock-alert-count">{item.inStock} adet</span>
              <StatusBadge tone={level.tone}>{level.label}</StatusBadge>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
