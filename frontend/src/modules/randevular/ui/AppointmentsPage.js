"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/modules/shared/ui/Toast";
import Modal from "@/modules/shared/ui/Modal";
import {
  createAppointmentRequest,
  listAppointmentRequests,
  setAppointmentRequestStatus,
} from "@/modules/randevular/server/appointmentActions";
import "./appointments.css";

const STATUS = {
  new: { label: "Yeni talep", className: "ui-badge-info" },
  converted: { label: "Onaylandı", className: "ui-badge-ok" },
  rejected: { label: "Reddedildi", className: "ui-badge-danger" },
};

function todayString() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function displayDate(value) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function isPastRequest(request) {
  if (!request.appointment_date) return false;

  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = dateParts.find((part) => part.type === "year")?.value;
  const month = dateParts.find((part) => part.type === "month")?.value;
  const day = dateParts.find((part) => part.type === "day")?.value;
  const today = `${year}-${month}-${day}`;

  if (request.appointment_date < today) return true;
  if (request.appointment_date > today) return false;

  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)/.exec(request.appointment_time || "");
  if (!timeMatch) return false;

  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(timeParts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(timeParts.find((part) => part.type === "minute")?.value || "0");
  const appointmentMinutes = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  return appointmentMinutes < hour * 60 + minute;
}

function requestStatus(request) {
  return ["new", "converted", "rejected"].includes(request?.status)
    ? request.status
    : "new";
}

export default function AppointmentsPage() {
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [activeSection, setActiveSection] = useState("active");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    appointment_date: todayString(),
    appointment_time: "10:00",
    issue: "",
  });

  const loadRequests = useCallback(async () => {
    setLoading(true);
    const result = await listAppointmentRequests();

    if (!result.ok) {
      toast(result.error || "Randevu taleplerini yüklenemedi.", "error");
      setRequests([]);
    } else {
      setRequests(result.data || []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadRequests(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRequests]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("tr-TR");
    return requests.filter((request) => {
      const status = requestStatus(request);
      const matchesSection =
        activeSection === "past"
          ? isPastRequest(request)
          : !isPastRequest(request);
      const matchesFilter = filter === "all" || status === filter;
      const haystack = [
        request.full_name,
        request.phone,
        request.email,
        request.issue,
      ].join(" ").toLocaleLowerCase("tr-TR");
      return matchesSection && matchesFilter && (!query || haystack.includes(query));
    });
  }, [requests, search, filter, activeSection]);

  const sectionRequests = useMemo(
    () => requests.filter((request) => (
      activeSection === "past" ? isPastRequest(request) : !isPastRequest(request)
    )),
    [requests, activeSection]
  );

  const counts = useMemo(() => ({
    all: sectionRequests.length,
    new: sectionRequests.filter((item) => requestStatus(item) === "new").length,
    converted: sectionRequests.filter((item) => requestStatus(item) === "converted").length,
    rejected: sectionRequests.filter((item) => requestStatus(item) === "rejected").length,
  }), [sectionRequests]);

  async function addRequest(event) {
    event.preventDefault();
    setSaving(true);

    const result = await createAppointmentRequest({
      full_name: form.full_name,
      phone: form.phone,
      email: form.email,
      appointment_date: form.appointment_date,
      appointment_time: form.appointment_time,
      issue: form.issue,
    });

    if (!result.ok) {
      toast(result.error || "Randevu oluşturulamadı.", "error");
    } else {
      toast("Randevu talebi oluşturuldu.");
      setForm({
        full_name: "",
        phone: "",
        email: "",
        appointment_date: todayString(),
        appointment_time: "10:00",
        issue: "",
      });
      setShowForm(false);
      loadRequests();
    }
    setSaving(false);
  }

  async function updateStatus(id, status) {
    const result = await setAppointmentRequestStatus(id, status);

    if (!result.ok) {
      toast(result.error || "Durum güncellenemedi.", "error");
      return;
    }

    setRequests((items) => items.map((item) => (
      item.id === id ? { ...item, status } : item
    )));
    toast(status === "converted" ? "Randevu onaylandı." : "Randevu durumu güncellendi.");
  }

  return (
    <section className="appointments-page">
      <header className="appointments-head">
        <div>
          <p className="ui-eyebrow">Şelale İşitme · Hasta yönetimi</p>
          <h1>Randevular</h1>
          <p>Web taleplerini inceleyin, onaylayın veya reddedin.</p>
        </div>
        <button className="ui-button ui-button-primary" type="button" onClick={() => setShowForm(true)}>
          <span aria-hidden="true">+</span> Yeni randevu
        </button>
      </header>

      <div className="appointments-stats">
        <StatCard title="Toplam talep" value={counts.all} kind="all" />
        <StatCard title="Yeni" value={counts.new} kind="new" />
        <StatCard title="Onaylanan" value={counts.converted} kind="converted" />
        <StatCard title="Reddedilen" value={counts.rejected} kind="rejected" />
      </div>

      <div className="appointments-toolbar">
        <div className="ui-chips" aria-label="Randevu dönemi">
          <button
            type="button"
            className={`ui-tab ${activeSection === "active" ? "on" : ""}`}
            onClick={() => setActiveSection("active")}
            aria-pressed={activeSection === "active"}
          >
            Güncel randevular
            <span className="ui-tab-count">{requests.filter((item) => !isPastRequest(item)).length}</span>
          </button>
          <button
            type="button"
            className={`ui-tab ${activeSection === "past" ? "on" : ""}`}
            onClick={() => setActiveSection("past")}
            aria-pressed={activeSection === "past"}
          >
            Geçmiş randevular
            <span className="ui-tab-count">{requests.filter((item) => isPastRequest(item)).length}</span>
          </button>
        </div>

        <div className="ui-chips" aria-label="Randevu filtresi">
          {[
            ["all", "Tümü"],
            ["new", "Yeni"],
            ["converted", "Onaylanan"],
            ["rejected", "Reddedilen"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={`ui-tab ${filter === key ? "on" : ""}`}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
            >
              {label}
              <span className="ui-tab-count">{counts[key]}</span>
            </button>
          ))}
        </div>

        <label className="appointments-search ui-field">
          <span className="ui-visually-hidden">Randevu ara</span>
          <input
            className="ui-input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ad, telefon, konu ara..."
          />
        </label>
      </div>

      {loading ? (
        <div className="ui-skeleton" aria-label="Randevular yükleniyor">
          <div className="ui-skeleton-row" />
          <div className="ui-skeleton-row" />
          <div className="ui-skeleton-row" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="ui-empty">
          <h2>Randevu bulunamadı</h2>
          <p>Arama ve durum filtrelerine uygun talep yok.</p>
          <button className="ui-button ui-button-primary ui-empty-action" type="button" onClick={() => setShowForm(true)}>
            Yeni randevu oluştur
          </button>
        </div>
      ) : (
        <div className="ui-table-wrap">
          <table className="ui-table appointments-table">
            <thead>
              <tr>
                <th>Müşteri</th>
                <th>İletişim</th>
                <th>Tarih</th>
                <th>Saat</th>
                <th>Konu</th>
                <th>Durum</th>
                <th className="ui-end">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((request) => {
                const normalizedStatus = requestStatus(request);
                const status = STATUS[normalizedStatus];
                return (
                  <tr key={request.id}>
                    <td data-label="Müşteri"><strong>{request.full_name}</strong></td>
                    <td data-label="İletişim">
                      <span className="appointments-phone">{request.phone}</span>
                      {request.email && <span className="appointments-email">{request.email}</span>}
                    </td>
                    <td data-label="Tarih">{displayDate(request.appointment_date)}</td>
                    <td data-label="Saat">{request.appointment_time || "—"}</td>
                    <td data-label="Konu">{request.issue || "Belirtilmedi"}</td>
                    <td data-label="Durum"><span className={`ui-badge ${status.className}`}>{status.label}</span></td>
                    <td data-label="İşlem" className="ui-end">
                      <div className="appointments-actions">
                        <button className="ui-button ui-button-primary" type="button" onClick={() => updateStatus(request.id, "converted")}>Onayla</button>
                        <button className="ui-button ui-button-ghost" type="button" onClick={() => updateStatus(request.id, "rejected")}>Reddet</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Randevu oluştur"
        eyebrow="Yeni kayıt"
        size="lg"
        footer={
          <>
            <button className="ui-button ui-button-ghost" type="button" onClick={() => setShowForm(false)}>Vazgeç</button>
            <button className="ui-button ui-button-primary" type="submit" form="appointments-create-form" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </>
        }
      >
        <form id="appointments-create-form" onSubmit={addRequest}>
          <div className="appointments-form-grid">
                <label className="ui-field">
                  <span className="ui-label">Ad soyad</span>
                  <input className="ui-input" required value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} />
                </label>
                <label className="ui-field">
                  <span className="ui-label">Telefon</span>
                  <input className="ui-input" required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
                </label>
                <label className="ui-field">
                  <span className="ui-label">E-posta</span>
                  <input className="ui-input" type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
                </label>
                <label className="ui-field">
                  <span className="ui-label">Tarih</span>
                  <input className="ui-input" type="date" required value={form.appointment_date} onChange={(event) => setForm({ ...form, appointment_date: event.target.value })} />
                </label>
                <label className="ui-field">
                  <span className="ui-label">Saat</span>
                  <input className="ui-input" type="time" required value={form.appointment_time} onChange={(event) => setForm({ ...form, appointment_time: event.target.value })} />
                </label>
                <label className="ui-field appointments-form-wide">
                  <span className="ui-label">Randevu konusu</span>
                  <input className="ui-input" required value={form.issue} onChange={(event) => setForm({ ...form, issue: event.target.value })} />
                </label>
          </div>
        </form>
      </Modal>
    </section>
  );
}

function StatCard({ title, value, kind }) {
  return (
    <div className={`appointments-stat appointments-stat-${kind}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}
