"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ScanInput from "@/modules/shared/ui/ScanInput";
import Tabs from "@/modules/shared/ui/Tabs";
import { scanToSearchText } from "../stockRules";

// Search box and view switch. A scanner (or Enter) writes the search into ?ara=, so the server does the
// lookup and the result survives a refresh. Add / remove / price buttons join this bar in later PRs.
export default function StockToolbar({ searchText, clearHref }) {
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
  );
}
