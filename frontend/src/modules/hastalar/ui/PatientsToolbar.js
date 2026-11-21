"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PATIENT_TABS, patientsHref } from "../patientRules";
import PatientDialog from "./PatientDialog";

const SEARCH_DELAY_MS = 350;

// The design's toolbar card: search box, the four filter buttons with their counts, "+ Yeni hasta" and the
// table/card switch. Typing searches as you go (after a short pause); the search lives in ?ara= so the
// server does the lookup and a refresh keeps it.
export default function PatientsToolbar({ query, counts, referralSources }) {
  const router = useRouter();
  const [text, setText] = useState(query.ara ?? "");
  const [creating, setCreating] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  function search(value, delay) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      router.replace(patientsHref(query, { ara: value.trim() || null }), { scroll: false });
    }, delay);
  }

  return (
    <div className="patients-toolbar">
      <form
        className="patients-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          search(text, 0);
        }}
      >
        <label className="ui-visually-hidden" htmlFor="patients-search">
          Hasta ara
        </label>
        <input
          id="patients-search"
          className="ui-input"
          type="search"
          autoComplete="off"
          placeholder="Ad, telefon, hasta no veya cihaz ara…"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            search(event.target.value, SEARCH_DELAY_MS);
          }}
        />
      </form>

      <nav className="patients-tabs" aria-label="Hasta filtreleri">
        {PATIENT_TABS.map((tab) => {
          const active = tab.value === query.sekme;
          return (
            <Link
              key={tab.value}
              href={patientsHref(query, { sekme: tab.value })}
              scroll={false}
              className={`patients-tab${active ? " on" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {tab.label}
              {tab.value !== "tum" && <span className="patients-tab-count">{counts[tab.value] ?? 0}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="patients-toolbar-end">
        <button type="button" className="ui-button ui-button-primary" onClick={() => setCreating(true)}>
          ＋ Yeni hasta
        </button>
        <div className="patients-views" role="group" aria-label="Görünüm">
          <ViewLink query={query} view="tablo" label="Tablo görünümü">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M3 14h18M10 9v11" />
          </ViewLink>
          <ViewLink query={query} view="kart" label="Kart görünümü">
            <rect x="3" y="3" width="7.5" height="7.5" rx="1.2" />
            <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.2" />
            <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.2" />
            <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.2" />
          </ViewLink>
        </div>
      </div>

      {/* A new key per opening starts the form empty. */}
      <PatientDialog
        key={creating ? "open" : "closed"}
        open={creating}
        referralSources={referralSources}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}

function ViewLink({ query, view, label, children }) {
  const active = query.gorunum === view;
  return (
    <Link
      href={patientsHref(query, { gorunum: view })}
      scroll={false}
      className={`patients-view${active ? " on" : ""}`}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </Link>
  );
}
