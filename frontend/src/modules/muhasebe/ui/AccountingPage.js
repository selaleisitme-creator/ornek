import LedgerTable from "./LedgerTable";
import { Suspense } from "react";
import Link from "next/link";
import Form from "next/form";
import { redirect } from "next/navigation";
import { getStaffProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import AccountingForms from "./AccountingForms";
import "./accounting.css";

const columns = [
  ["income_expense", "Gelir / Gider"], ["full_name", "Adı soyadı"], ["phone", "Telefon"],
  ["device", "Cihaz marka model"], ["serial_no", "Seri no"], ["mold_type", "Kalıp cinsi"],
  ["operation", "İşlem"], ["expense_type", "Gider türü"], ["amount", "Tutar"],
  ["payment_label", "Ödeme"], ["entry_date", "Tarih"], ["running_total", "Kasa toplamı"],
  ["description", "Açıklama"],
];
const pageSize = 50;

export default function AccountingPage({ searchParams }) {
  return <Suspense fallback={<p role="status">Muhasebe yükleniyor…</p>}><AccountingContent searchParams={searchParams} /></Suspense>;
}

async function AccountingContent({ searchParams }) {
  if (!(await getStaffProfile())?.canViewAccounting) redirect("/anasayfa");

  const query = await searchParams;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
  const db = await createClient();
  const { data: firstEntry, error: firstEntryError } = await db.from("ledger_entries")
    .select("entry_date").order("entry_date", { nullsFirst: false }).limit(1).maybeSingle();
  if (firstEntryError) return <p role="alert">Dönem bilgisi yüklenemedi. Sayfayı yenileyin.</p>;

  const currentMonth = today.slice(0, 7);
  const currentYear = Number(today.slice(0, 4));
  const firstYear = Number(firstEntry?.entry_date?.slice(0, 4) ?? currentYear);
  const minYear = Math.min(firstYear, currentYear);
  const period = typeof query?.year === "string" && typeof query?.periodMonth === "string"
    ? query.year + "-" + query.periodMonth
    : query?.month;
  const month = typeof period === "string" && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(period) && Number(period.slice(0, 4)) >= minYear
    ? period : currentMonth;
  const rawPage = Number(query?.page);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1;
  const offset = (page - 1) * pageSize;
  const monthDate = month + "-01";


  const filters = [["all", "Tümü"], ["income", "Gelir"], ["expense", "Gider"]];
  const filter = filters.some(([key]) => key === query?.filter) ? query.filter : "all";
  const search = typeof query?.q === "string" ? query.q.trim().slice(0, 100) : "";
  function href(nextFilter, nextPage = 1) {
    return "/muhasebe?" + new URLSearchParams({ month, filter: nextFilter, q: search, page: String(nextPage) });
  }
  let rows = db.from("ledger_entries").select("source,source_id," + columns.map(([field]) => field).join(","),
      { count: "exact" }).eq("month", monthDate).order("entry_date", { ascending: false })
      .order("source").order("source_id");
  if (filter !== "all") rows = rows.eq("income_expense", filter === "income" ? "GELİR" : "GİDER");
  if (search) {
    const pattern = `"%${search.replace(/["\\%_*]/g, (char) => "\\\\" + char)}%"`;
    rows = rows.or(`description.ilike.${pattern},payment_label.ilike.${pattern}`);
  }
  const responses = await Promise.all([
    rows.range(offset, offset + pageSize - 1),
    db.from("ledger_monthly").select("total_income,total_expense,net_cash").eq("month", monthDate).maybeSingle(),
    db.from("ledger_payment_totals").select("payment_label,total_income,total_expense").eq("month", monthDate),
    db.from("payment_methods").select("code,name").order("sort_order"),
    db.from("expense_categories").select("id,name").eq("active", true).order("name"),
    db.from("expense_templates").select("id,name,amount,payment_method,expense_category_id,note").eq("active", true).order("name"),
  ]);
  if (responses.some(({ error }) => error)) {
    return <section className="accounting"><h1>Muhasebe</h1><p role="alert">Muhasebe verileri yüklenemedi. Sayfayı yenileyin.</p></section>;
  }
  const [ledger, { data: summary }, { data: payments }, { data: methods },
    { data: categories }, { data: templates }] = responses;

  return <section className="accounting wrap">
    <header className="top"><div><span className="eyebrow">ŞELALE İŞİTME · KASA TAKİBİ</span><h1>Muhasebe</h1><p className="sub">Satış gelirlerini izleyin, dış gelir ve gider kayıtlarını ekleyin.</p></div>
      <Form action="/muhasebe" scroll={false} className="accounting-period">
        <div>
          <div>Dönem</div>
          <div style={{ display: "flex", gap: 6 }}>
            <select className="search" key={"month-" + month} name="periodMonth" aria-label="Ay" defaultValue={month.slice(5)} style={{ width: "auto" }}>
              {["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"].map((label, index) => (
                <option key={label} value={String(index + 1).padStart(2, "0")}>{label}</option>
              ))}
            </select>
            <select className="search" key={"year-" + month} name="year" aria-label="Yıl" defaultValue={month.slice(0, 4)} style={{ width: "auto" }}>
              {Array.from({ length: Math.max(currentYear, Number(month.slice(0, 4))) - minYear + 1 }, (_, index) => minYear + index)
                .reverse().map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
        </div>
        <button type="submit" className="btn primary">Göster</button>
        {month !== currentMonth && <Link className="btn" href={"/muhasebe?" + new URLSearchParams({ month: currentMonth, filter, q: search })} scroll={false}>Bu aya dön</Link>}
      </Form>
    </header>
    <div className="cards">
      {[["Toplam gelir", summary?.total_income, "income"], ["Toplam gider", summary?.total_expense, "expense"], ["Kâr (gelir – gider)", summary?.net_cash, "balance"]]
        .map(([label, amount, tone]) => <article className={`card ${tone}`} key={label}><small>{label}</small><strong>{formatMoney(amount ?? 0)}</strong></article>)}
      <article className="card balance payment-preview">
      <small>Ödeme yöntemleri</small>
      {payments.length ? <table><thead><tr><th scope="col">Yöntem</th><th scope="col">Gelir</th><th scope="col">Gider</th></tr></thead>
        <tbody>{payments.map((row) => <tr key={row.payment_label}>
          <th className="payment-method" scope="row">{row.payment_label}</th><td>{formatMoney(row.total_income)}</td>
          <td>{formatMoney(row.total_expense)}</td>
        </tr>)}</tbody></table> : <p>Bu dönemde ödeme hareketi yok.</p>}
    </article>
    </div>
    <section className="tools">
      <AccountingForms key={month} {...{ month, today, methods, categories, templates }} />
      <div className="filters" aria-label="Kasa defteri filtresi">{filters.map(([key, label]) => <Link key={key} className={`filter${filter === key ? " active" : ""}`} aria-current={filter === key ? "true" : undefined} href={href(key)} scroll={false}>{label}</Link>)}</div>
    </section>
    <article className="ledger">
      <div className="ledger-head"><div><h2>Kasa defteri</h2><p>Satışlar otomatik gelir olarak eklenir. Kayıt tarihi otomatik tutulur.</p></div><Form action="/muhasebe" scroll={false}>
        <input type="hidden" name="month" value={month} /><input type="hidden" name="filter" value={filter} />
        <input key={search} className="search" type="search" name="q" defaultValue={search} placeholder="Açıklama veya ödeme ara" aria-label="Açıklama veya ödeme ara" />
        <button className="accounting-search-submit" aria-label="Ara">Ara</button>
      </Form></div>
      {ledger.data.length ? <LedgerTable columns={columns} rows={ledger.data} /> : <p>Bu sayfada gösterilecek kayıt yok.</p>}
      <nav aria-label="Kasa defteri sayfaları">
        {page > 1 && <Link href={href(filter, page - 1)} scroll={false}>Önceki</Link>}
        <span>{ledger.count ?? 0} kayıt</span>
        {offset + pageSize < ledger.count && <Link href={href(filter, page + 1)} scroll={false}>Sonraki</Link>}
      </nav>
    </article>
  </section>;
}
