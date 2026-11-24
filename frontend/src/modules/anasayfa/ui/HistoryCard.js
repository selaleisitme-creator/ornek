"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Modal from "@/modules/shared/ui/Modal";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { loadArrivedVisits, loadSoldItems } from "../server/actions";

// A chart card that opens its records when clicked: "Aylık satış" → Satılan ürünler, "Hasta yoğunluğu" →
// Gelen hastalar. The chart itself is drawn on the server and passed in as children; the list loads only
// when the window opens, so the page stays light.
const KINDS = {
  sales: {
    load: loadSoldItems,
    eyebrow: "Satılan ürünler",
    title: "Satılan ürünler",
    hint: "Yeniden eskiye, son 300 kayıt. Ürün ya da seri numarasıyla arayın.",
    unit: "ürün kaydı",
    placeholder: "Ürün veya seri numarası ara",
    text: (row) => `${row.title} ${row.serialNo ?? ""}`,
  },
  visits: {
    load: loadArrivedVisits,
    eyebrow: "Gelen hastalar",
    title: "Gelen hastalar",
    hint: "\"Geldi\" işaretlenen randevular, yeniden eskiye. İsme tıklayınca hasta kartı açılır.",
    unit: "ziyaret",
    placeholder: "Hasta adı ara",
    text: (row) => `${row.name} ${row.kind}`,
  },
};

export default function HistoryCard({ kind, title, linkLabel, className = "", children }) {
  const config = KINDS[kind];
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  async function show() {
    setOpen(true);
    setSearch("");
    setError(null);
    const result = await config.load();
    if (result?.ok) setRows(result.data ?? []);
    else setError(result?.error ?? "Liste yüklenemedi.");
  }

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLocaleLowerCase("tr-TR");
    if (!needle) return rows;
    return rows.filter((row) => config.text(row).toLocaleLowerCase("tr-TR").includes(needle));
  }, [rows, search, config]);

  return (
    <>
      <article className={`home-panel home-history-card ${className}`}>
        <div className="home-panel-head">
          <h2>{title}</h2>
          {/* The whole card is the click target, like the design; this button carries the name and keyboard focus. */}
          <button type="button" className="home-history-open" onClick={show}>
            {linkLabel}
          </button>
        </div>
        {children}
      </article>

      <Modal open={open} onClose={() => setOpen(false)} eyebrow={config.eyebrow} title={config.title} size="lg">
        <div className="home-history">
          <p className="home-history-hint">{config.hint}</p>
          {error ? (
            <p className="ui-error" role="alert">{error}</p>
          ) : !rows ? (
            <p className="home-history-loading" role="status">Liste yükleniyor…</p>
          ) : (
            <>
              <div className="home-history-total">
                <b>{rows.length}</b>
                <span>{config.unit}</span>
              </div>
              <div className="home-history-search">
                <input
                  type="search"
                  className="ui-input"
                  placeholder={config.placeholder}
                  aria-label={config.placeholder}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search && <small role="status">{filtered.length} sonuç</small>}
              </div>
              {filtered.length ? (
                <ul className="home-history-list">
                  {filtered.map((row) => (kind === "sales" ? <SaleRow key={row.id} row={row} /> : <VisitRow key={row.id} row={row} />))}
                </ul>
              ) : (
                <p className="home-history-empty">{rows.length ? "Aramayla eşleşen kayıt yok." : "Henüz kayıt yok."}</p>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

function SaleRow({ row }) {
  return (
    <li className="home-history-row">
      <span className="home-history-date">{formatDate(row.date)}</span>
      <div className="home-history-main">
        {row.href ? (
          <Link href={row.href} className="home-history-link">
            {row.title}
          </Link>
        ) : (
          <b>{row.title}</b>
        )}
        {row.serialNo && <small>Seri no · {row.serialNo}</small>}
      </div>
      <span className={`home-history-tag${row.refunded ? " refunded" : ""}`}>
        {row.refunded ? "İade edildi" : formatMoney(row.amount)}
      </span>
    </li>
  );
}

function VisitRow({ row }) {
  const [day, time] = formatDateTime(row.startsAt).split(" ");
  return (
    <li className="home-history-row">
      <span className="home-history-date">
        {day}
        <b>{time}</b>
      </span>
      <div className="home-history-main">
        <Link href={`/hastalar?ac=${row.patientId}`} className="home-history-link">
          {row.name}
        </Link>
        {row.kind && <small>{row.kind}</small>}
      </div>
      <span className="home-history-tag arrived">Geldi</span>
    </li>
  );
}
