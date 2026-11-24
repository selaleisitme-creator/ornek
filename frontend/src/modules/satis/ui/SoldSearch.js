"use client";

import Link from "next/link";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import ScanInput from "@/modules/shared/ui/ScanInput";
import { scanToSearchText } from "@/modules/stok/stockRules";

// Satılan ürünler's search, built like Mevcut stok's: the two scan shortcuts above the box, and a scan (or Enter) writes
// the search into ?ara= so the server does the lookup and the result survives a refresh. A GS1 label is kept as
// "(01)…(21)…", which soldService turns back into its serial number.
export default function SoldSearch({ searchText }) {
  const router = useRouter();
  const box = useRef(null);

  function search(scan) {
    const text = scanToSearchText(scan);
    if (text) router.push(`/stok?sekme=satilan&ara=${encodeURIComponent(text)}`, { scroll: false });
  }

  // A USB or Bluetooth scanner types into the focused field, so both shortcuts only put the cursor there.
  function focusSearch() {
    box.current?.querySelector("input")?.focus();
  }

  return (
    <div className="stock-search" ref={box} role="search">
      <div className="stock-scan-helper" aria-label="Okutma">
        <button type="button" onClick={focusSearch}>▦ Barkod okut</button>
        <button type="button" onClick={focusSearch}>№ Seri no okut</button>
        {searchText && (
          <Link className="stock-clear" href="/stok?sekme=satilan" scroll={false}>
            Aramayı temizle ×
          </Link>
        )}
      </div>
      <ScanInput label="Satılan ürünlerde ara" placeholder="Ürün, seri no, hasta ya da satış no ara…" onScan={search} />
    </div>
  );
}
