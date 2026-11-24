"use client";

import Link from "next/link";
import { useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ScanInput from "@/modules/shared/ui/ScanInput";
import { scanToSearchText } from "../stockRules";
import StockEntryButton from "./StockEntryButton";
import StockSections from "./StockSections";
import { PriceUpdateButton, StockRemoveButton } from "./StockActionButtons";
import { WholesaleSaleButton } from "@/modules/satis/ui/SaleButtons";

// The design's toolbar card: search on top (with the two scan shortcuts), then the section switch with
// "Fiyat güncelle" and the table/card switch, then "Stok ekle" and "Stok sil" on the right. A scanner (or
// Enter) writes the search into ?ara=, so the server does the lookup and the result survives a refresh.
export default function StockToolbar({ searchText, clearHref, entryOptions, removal }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const box = useRef(null);
  const cardView = searchParams.get("gorunum") === "kart";

  function search(scan) {
    const text = scanToSearchText(scan);
    if (!text) return;
    const next = new URLSearchParams(searchParams);
    next.set("ara", text);
    // A new search decides itself which model to open (the scanned unit's), not the one open before.
    next.delete("ac");
    router.push(`${pathname}?${next}`, { scroll: false });
  }

  // A USB or Bluetooth scanner types into the focused field, so both shortcuts only put the cursor there.
  // The box itself recognises a GS1 label or a plain serial number.
  function focusSearch() {
    box.current?.querySelector("input")?.focus();
  }

  function viewHref(card) {
    const next = new URLSearchParams(searchParams);
    if (card) next.set("gorunum", "kart");
    else next.delete("gorunum");
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <div className="stock-toolbar">
      <div className="stock-search" ref={box}>
        <div className="stock-scan-helper" aria-label="Okutma">
          <button type="button" onClick={focusSearch}>▦ Barkod okut</button>
          <button type="button" onClick={focusSearch}>№ Seri no okut</button>
          {searchText && (
            <Link className="stock-clear" href={clearHref} scroll={false}>
              Aramayı temizle ×
            </Link>
          )}
        </div>
        <ScanInput label="Ürün, barkod veya seri no ara" placeholder="Ürün, barkod veya seri no (örn. 21…) ara…" onScan={search} />
      </div>

      <div className="stock-toolbar-filters">
        <StockSections />
        <PriceUpdateButton className="stock-price-button" />
        <WholesaleSaleButton className="stock-price-button" />
      </div>

      <div className="stock-view-switch" role="group" aria-label="Görünüm">
        <Link
          href={viewHref(false)}
          scroll={false}
          className={`stock-view-button${cardView ? "" : " on"}`}
          aria-label="Tablo görünümü"
          aria-current={cardView ? undefined : "page"}
          title="Tablo görünümü"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M3 14h18M10 9v11" />
          </svg>
        </Link>
        <Link
          href={viewHref(true)}
          scroll={false}
          className={`stock-view-button${cardView ? " on" : ""}`}
          aria-label="Kart görünümü"
          aria-current={cardView ? "page" : undefined}
          title="Kart görünümü"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="8" height="8" rx="1.5" />
            <rect x="13" y="3" width="8" height="8" rx="1.5" />
            <rect x="3" y="13" width="8" height="8" rx="1.5" />
            <rect x="13" y="13" width="8" height="8" rx="1.5" />
          </svg>
        </Link>
      </div>

      <div className="stock-header-actions">
        <StockEntryButton options={entryOptions} variant="fab" />
        <StockRemoveButton model={removal?.model ?? null} units={removal?.units ?? []} variant="fab" />
      </div>
    </div>
  );
}
