"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { STOCK_SECTIONS } from "../stockRules";

// The design's dark segmented switch ("Mevcut stok · Satılan ürünler · Servis"). A section change drops the stock-only
// options (group, brand, search, open model), so "Servis" never carries a half-applied stock filter.
export default function StockSections() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("sekme") ?? STOCK_SECTIONS[0].value;

  return (
    <nav className="stock-sections" aria-label="Bölüm">
      {STOCK_SECTIONS.map((section, index) => {
        const active = section.value === current;
        const href = index === 0 ? pathname : `${pathname}?sekme=${section.value}`;
        return (
          <Fragment key={section.value}>
            <Link href={href} scroll={false} className={active ? "on" : undefined} aria-current={active ? "page" : undefined}>
              {section.label}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
