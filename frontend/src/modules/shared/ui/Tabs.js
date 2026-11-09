"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Tabs and filter chips that live in the address bar (?sekme=piller), so a refresh or a shared link opens
// the same view. Other query values are kept. The first item is the default and leaves the parameter out.
// Uses useSearchParams, so the page must render it inside <Suspense> (the panel layout already does).
export default function Tabs({ param = "sekme", items, label, variant = "tabs" }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? items[0]?.value;

  function hrefFor(value) {
    const next = new URLSearchParams(searchParams);
    if (value === items[0]?.value) next.delete(param);
    else next.set(param, value);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <nav className={`ui-${variant}`} aria-label={label}>
      {items.map((item) => {
        const active = item.value === current;
        return (
          <Link
            key={item.value}
            href={hrefFor(item.value)}
            className={`ui-tab${active ? " on" : ""}`}
            aria-current={active ? "page" : undefined}
            scroll={false}
          >
            {item.label}
            {item.count !== undefined && <span className="ui-tab-count">{item.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
