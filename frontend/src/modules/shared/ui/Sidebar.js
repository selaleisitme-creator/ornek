"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "./LogoutButton";
import { usePanelSession } from "./panelSessionStore";

// Icons are the same strokes as the approved design (selale-admin/son.html).
// "primary" items stay in the phone's bottom bar; the rest move into its "Menü" sheet.
const NAV_ITEMS = [
  {
    href: "/anasayfa",
    label: "Anasayfa",
    primary: true,
    icon: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  },
  {
    href: "/stok",
    label: "Stok",
    primary: true,
    icon: <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8" />,
  },
  {
    href: "/hastalar",
    label: "Hastalar",
    primary: true,
    icon: (
      <>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21c0-4 3-7 7-7s7 3 7 7M17 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-6" />
      </>
    ),
  },
  {
    href: "/randevular",
    label: "Randevular",
    primary: true,
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
  },
  {
    href: "/muhasebe",
    label: "Muhasebe 🔒",
    // Hidden from anyone without the accounting permission (interns never have it).
    // The page and the database check it again; this only keeps the menu honest.
    requires: "accounting",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9h10M7 13h4M7 17h10" />
      </>
    ),
  },
  {
    href: "/baglantilar",
    label: "Bağlantılar",
    icon: <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />,
  },
  {
    href: "/ayarlar",
    label: "Ayarlar",
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.08-.02a1.7 1.7 0 0 0-1.8.48l-.06.06h-3.4l-.03-.08a1.7 1.7 0 0 0-1.35-1.1 1.7 1.7 0 0 0-1.5.64l-.05.07-2.95-1.7.02-.08a1.7 1.7 0 0 0-.48-1.8l-.06-.06v-3.4l.08-.03a1.7 1.7 0 0 0 1.1-1.35 1.7 1.7 0 0 0-.64-1.5l-.07-.05 1.7-2.95.08.02a1.7 1.7 0 0 0 1.8-.48l.06-.06h3.4l.03.08a1.7 1.7 0 0 0 1.35 1.1 1.7 1.7 0 0 0 1.5-.64l.05-.07 2.95 1.7-.02.08a1.7 1.7 0 0 0 .48 1.8l.06.06v3.4z" />
      </>
    ),
  },
];

const PRIMARY_ITEMS = NAV_ITEMS.filter((item) => item.primary);

function allowed(item, session) {
  return item.requires !== "accounting" || session.canViewAccounting;
}

// A sub-page such as /hastalar/123 keeps "Hastalar" highlighted.
function isActive(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavIcon({ children }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function NavLink({ item, pathname, onNavigate }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      className={`side-link${active ? " on" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <NavIcon>{item.icon}</NavIcon>
      <span>{item.label}</span>
    </Link>
  );
}

// usePathname works without <Suspense> while every panel route is static. Once a route with an
// unknown param is added (e.g. a patient card at /hastalar/[id]), wrap this component in <Suspense>.
export default function Sidebar() {
  const pathname = usePathname();
  const session = usePanelSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const extraItems = NAV_ITEMS.filter((item) => !item.primary && allowed(item, session));
  const extraActive = extraItems.some((item) => isActive(pathname, item.href));
  const close = () => setMoreOpen(false);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  return (
    <>
      {/* Outside the nav so the bar itself stays above the dimmed page and remains clickable. */}
      {moreOpen && <div className="side-backdrop" aria-hidden="true" onClick={close} />}

      <nav className={`side${moreOpen ? " more-open" : ""}`} aria-label="Ana menü">
        <div className="side-brand">
          <svg className="side-logo" viewBox="0 0 425 155" role="img" aria-label="Şelale İşitme Cihazları">
            <image x="36" y="3" width="70" height="150" href="/logo-flower.webp" preserveAspectRatio="xMidYMid meet" />
            <text x="136" y="83" fontFamily="Georgia, 'Times New Roman', serif" fontSize="59" letterSpacing="3">SELALE</text>
            <text x="140" y="113" fontFamily="'Segoe UI', Arial, sans-serif" fontSize="22" letterSpacing="1.6">işitme cihazları</text>
          </svg>
          {/* The narrow tablet menu has no room for the wordmark, so it shows the flower alone. */}
          <Image className="side-mark" src="/logo-flower.webp" alt="Şelale İşitme" width={121} height={270} loading="eager" />
        </div>

        <div className="side-group side-primary">
          {PRIMARY_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={close} />
          ))}
        </div>

        <button
          type="button"
          className={`side-more${extraActive ? " on" : ""}`}
          aria-expanded={moreOpen}
          aria-controls="side-extra"
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <NavIcon>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </NavIcon>
          <span>Menü</span>
        </button>

        <div className="side-group side-extra" id="side-extra">
          {extraItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={close} />
          ))}
          <LogoutButton />
        </div>
      </nav>
    </>
  );
}
