"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ScanInput from "@/modules/shared/ui/ScanInput";
import Tabs from "@/modules/shared/ui/Tabs";
import { scanToSearchText } from "../stockRules";
import StockEntryButton from "./StockEntryButton";
import { StockRemoveButton } from "./StockActionButtons";

// Search box, "Stok ekle" and the view switch. A scanner (or Enter) writes the search into ?ara=, so the
// server does the lookup and the result survives a refresh. "Stok sil" works on the open model (removal is
// { model, units } or null); the price button joins this bar in a later PR.
export default function StockToolbar({ searchText, clearHref, entryOptions, removal }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function search(scan) {
    const text = scanToSearchText(scan);
    if (!text) return;
    const next = new URLSearchParams(searchParams);
    next.set("ara", text);
    // A new search decides itself which model to open (the scanned unit's), not the one open before.
    next.delete("ac");
    router.push(`${pathname}?${next}`, { scroll: false });
  }

  return (
    <div className="stock-toolbar">
      <div className="stock-search">
        <ScanInput label="Ürün, barkod veya seri no ara" placeholder="Okutun ya da yazıp Enter'a basın…" onScan={search} />
        {searchText && (
          <Link className="ui-button ui-button-ghost stock-clear" href={clearHref} scroll={false}>
            Temizle
          </Link>
        )}
      </div>
      <div className="stock-actions">
        <StockEntryButton options={entryOptions} />
        <StockRemoveButton model={removal?.model ?? null} units={removal?.units ?? []} />
        <Tabs
          param="gorunum"
          variant="chips"
          label="Görünüm"
          items={[
            { value: "tablo", label: "Tablo" },
            { value: "kart", label: "Kart" },
          ]}
        />
      </div>
    </div>
  );
}
