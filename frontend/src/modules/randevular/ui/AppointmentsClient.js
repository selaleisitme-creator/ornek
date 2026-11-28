"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatPhone, splitPhone } from "@/lib/phone";
import { whatsappLink } from "@/lib/whatsapp";
import { useWhatsAppLink } from "@/modules/shared/ui/useWhatsAppLink";
import PhoneInput from "@/modules/shared/ui/PhoneInput";
import { useToast } from "@/modules/shared/ui/Toast";
import { statusLabel } from "@/modules/hastalar/patientRules";
import {
  cancelAppointment,
  convertAppointmentRequest,
  listAppointmentsForMonth,
  markAppointmentAttendance,
  rejectAppointmentRequest,
  recordAppointmentContact,
  saveAppointment,
  searchAppointmentPatients,
} from "../server/actions";
import "./appointments.css";

const FILTERS = ["Tümü", "Bekliyor", "Geldi", "Gelmedi"];
const STATUS_LABELS = {
  waiting: "Bekliyor",
  attended: "Geldi",
  no_show: "Gelmedi",
  cancelled: "İptal edildi",
};
const STATUS_FILTERS = {
  "Tümü": null,
  "Bekliyor": "waiting",
  "Geldi": "attended",
  "Gelmedi": "no_show",
};
const DURATION_OPTIONS = [15, 30, 45, 60, 90];
const EMPTY_FORM = {
  patientId: "",
  patientName: "",
  phone: "",
  kindId: "",
  date: "",
  time: "09:00",
  duration: "90",
  status: "waiting",
  referralSourceId: "",
  notes: "",
};

function monthOf(date) {
  return String(date).slice(0, 7);
}

function localDateFrom(date, days = 0) {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

function todayInIstanbul() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function formatSelectedDate(value, options = {}) {
  if (!value) return "";
  return new Date(`${value}T12:00:00+03:00`).toLocaleDateString("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: options.weekday ?? "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i");
}

function initials(name) {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toLocaleUpperCase("tr-TR") || "?";
}

function appointmentPhone(phone) {
  const text = String(phone ?? "").trim();
  const digits = text.replace(/\D/g, "");
  let value = text.startsWith("+") ? digits : digits.startsWith("00") ? digits.slice(2) : digits;
  if (!text.startsWith("+") && !digits.startsWith("00")) {
    if (value.length === 11 && value.startsWith("0")) value = `90${value.slice(1)}`;
    else if (value.length === 10) value = `90${value}`;
  }
  return /^[1-9]\d{7,14}$/.test(value) ? value : "";
}

function messageForAppointment(appointment) {
  const date = formatSelectedDate(appointment.date);
  return `Merhaba ${appointment.patientName}, ${date} saat ${appointment.time} için ${appointment.kindName} randevunuz bulunmaktadır. Değişiklik için lütfen bizimle iletişime geçin.`;
}

function AppointmentWhatsApp({ appointment, onOpen, className = "wa-btn" }) {
  const href = useWhatsAppLink(appointment.phone, messageForAppointment(appointment));
  if (!href) {
    return     <button type="button" className={className} disabled title="Telefon numarası yok">WhatsApp’a git</button>;
  }
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
    >
      WhatsApp’a git
    </a>
  );
}

export default function AppointmentsClient({ initialData, today, initialNow }) {
  const toast = useToast();
  const [appointments, setAppointments] = useState(initialData.appointments ?? []);
  const [requests, setRequests] = useState(initialData.requests ?? []);
  const [kinds] = useState(initialData.kinds ?? []);
  const [sources] = useState(initialData.sources ?? []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [calendarMonth, setCalendarMonth] = useState(monthOf(today));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [filter, setFilter] = useState("Tümü");
  const [search, setSearch] = useState("");
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [now, setNow] = useState(initialNow);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [requestToConvert, setRequestToConvert] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientOptions, setPatientOptions] = useState([]);
  const [phoneInputKey, setPhoneInputKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [expandedPatientId, setExpandedPatientId] = useState(null);
  const [patientInfo, setPatientInfo] = useState(null);
  const [pendingContactId, setPendingContactId] = useState(null);
  const [contactingId, setContactingId] = useState(null);
  const [modalPatientId, setModalPatientId] = useState(0);
  const loadedMonths = useRef(new Set([monthOf(today)]));
  const loadingMonths = useRef(new Set());
  const calendarRef = useRef(null);

  const loadMonth = useCallback(async (month) => {
    if (loadedMonths.current.has(month) || loadingMonths.current.has(month)) return;
    loadingMonths.current.add(month);
    setLoadingMonth(true);
    const result = await listAppointmentsForMonth(month);
    loadingMonths.current.delete(month);
    if (!result?.ok) {
      toast(result?.error ?? "Randevular yüklenemedi.", "error");
      setLoadingMonth(false);
      return;
    }
    loadedMonths.current.add(month);
    setAppointments((current) => [
      ...current.filter((appointment) => monthOf(appointment.date) !== month),
      ...(result.data ?? []),
    ]);
    setLoadingMonth(false);
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadMonth(calendarMonth), 0);
    return () => window.clearTimeout(timer);
  }, [calendarMonth, loadMonth]);

  useEffect(() => {
    if (!modalOpen || !form.date) return undefined;
    const timer = window.setTimeout(() => loadMonth(monthOf(form.date)), 0);
    return () => window.clearTimeout(timer);
  }, [modalOpen, form.date, loadMonth]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!calendarOpen) return undefined;
    function closeOutside(event) {
      if (!calendarRef.current?.contains(event.target)) setCalendarOpen(false);
    }
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [calendarOpen]);

  useEffect(() => {
    if (!modalOpen || patientQuery.trim().length < 2) return undefined;
    const timer = window.setTimeout(async () => {
      const result = await searchAppointmentPatients(patientQuery);
      if (!result?.ok) {
        toast(result?.error ?? "Hasta kayıtları aranamadı.", "error");
        return;
      }
      setPatientOptions(result.data ?? []);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [modalOpen, patientQuery, toast]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setModalOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [modalOpen]);

  const appointmentsForDay = useMemo(
    () => appointments.filter((appointment) => appointment.date === selectedDate),
    [appointments, selectedDate]
  );

  const stats = useMemo(() => ({
    today: appointmentsForDay.filter((appointment) => appointment.status !== "cancelled").length,
    waiting: appointmentsForDay.filter((appointment) => appointment.status === "waiting").length,
    attended: appointmentsForDay.filter((appointment) => appointment.status === "attended").length,
    noShow: appointmentsForDay.filter((appointment) => appointment.status === "no_show").length,
  }), [appointmentsForDay]);

  const filtered = useMemo(() => {
    const rawQuery = search.trim();
    const query = fold(rawQuery);
    const phoneQuery = rawQuery.replace(/\D/g, "");
    return appointmentsForDay
      .filter((appointment) => {
        const status = STATUS_FILTERS[filter];
        const matchesStatus = status === null || appointment.status === status;
        const haystack = fold([
          appointment.patientName,
          appointment.phone,
          appointment.kindName,
          appointment.notes,
        ].join(" "));
        const matchesSearch = !query ||
          haystack.includes(query) ||
          (phoneQuery && appointment.phone.replace(/\D/g, "").includes(phoneQuery));
        return matchesStatus && matchesSearch;
      })
      .sort((a, b) => a.time.localeCompare(b.time) || Number(a.id) - Number(b.id));
  }, [appointmentsForDay, filter, search]);

  const markedDays = useMemo(
    () => new Set(appointments.filter((appointment) => appointment.status !== "cancelled").map((appointment) => appointment.date)),
    [appointments]
  );

  const freeSlots = useMemo(() => {
    const duration = Number(form.duration) || 30;
    const occupied = appointments
      .filter((appointment) => (
        appointment.date === form.date &&
        String(appointment.id) !== String(editing?.id ?? "") &&
        ["waiting", "attended"].includes(appointment.status)
      ))
      .map((appointment) => {
        const [hour, minute] = appointment.time.split(":").map(Number);
        return [hour * 60 + minute, hour * 60 + minute + appointment.duration];
      });
    const slots = [];
    for (let minute = 9 * 60; minute <= 17 * 60 + 30; minute += 30) {
      const busy = occupied.some(([start, end]) => minute < end && minute + duration > start);
      slots.push({ label: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, busy });
    }
    return slots;
  }, [appointments, editing, form.date, form.duration]);

  const dayAgenda = filtered.filter((appointment) => (
    appointment.status !== "cancelled" && new Date(appointment.startsAt).getTime() + 60_000 > now
  ));

  function setFormValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openPatientInfo(appointment) {
    setPatientInfo({
      name: appointment.patientName,
      phone: appointment.phone,
      birthDate: appointment.birthDate,
      address: appointment.address,
      recordType: appointment.patientRecordType,
      devices: appointment.devices,
      warrantyEnd: appointment.warrantyEnd,
      status: appointment.patientStatus,
      lastAppointment: appointment.lastAppointment,
      nextAppointment: appointment.nextAppointment,
    });
  }

  function openAppointmentModal(appointment = null, request = null) {
    setEditing(appointment);
    setRequestToConvert(request);
    setSelectedPatient(appointment ? {
      id: appointment.patientId,
      name: appointment.patientName,
      phone: appointment.phone,
      birthDate: appointment.birthDate,
      address: appointment.address,
      recordType: appointment.patientRecordType,
      referralSourceId: appointment.patientReferralSourceId,
      devices: appointment.devices,
      warrantyEnd: appointment.warrantyEnd,
      status: appointment.patientStatus,
      lastAppointment: appointment.lastAppointment,
      nextAppointment: appointment.nextAppointment,
    } : null);
    setPatientQuery(appointment?.patientName ?? request?.full_name ?? "");
    setForm({
      patientId: appointment?.patientId ? String(appointment.patientId) : "",
      patientName: appointment?.patientName ?? request?.full_name ?? "",
      phone: appointment?.phone ?? request?.phone ?? "",
      kindId: String(appointment?.kindId ?? kinds[0]?.id ?? ""),
      date: appointment?.date ?? request?.appointment_date ?? selectedDate,
      time: appointment?.time ?? request?.appointment_time?.slice(0, 5) ?? "09:00",
      duration: String(appointment?.duration ?? 90),
      status: appointment?.status ?? "waiting",
      referralSourceId: String(
        appointment
          ? appointment.patientReferralSourceId ?? appointment.sourceId ?? ""
          : request
            ? sources.find((source) => source.name === "Web sitesi")?.id ??
              sources.find((source) => source.name === "Uygulama")?.id ?? ""
            : sources.find((source) => source.name === "Uygulama")?.id ?? ""
      ),
      notes: appointment?.notes ?? "",
    });
    setPhoneInputKey((key) => key + 1);
    setPatientOptions([]);
    setModalPatientId((key) => key + 1);
    setModalOpen(true);
  }

  function choosePatient(patient) {
    setSelectedPatient(patient);
    setPatientQuery(patient.name);
    setPatientOptions([]);
    setForm((current) => ({
      ...current,
      patientId: String(patient.id),
      patientName: patient.name,
      phone: patient.phone ?? "",
      referralSourceId: patient.referralSourceId ? String(patient.referralSourceId) : "",
    }));
    setPhoneInputKey((key) => key + 1);
  }

  function handlePatientName(value) {
    setPatientQuery(value);
    setPatientOptions([]);
    setForm((current) => ({
      ...current,
      patientName: value,
      patientId: selectedPatient && selectedPatient.name === value ? String(selectedPatient.id) : "",
      referralSourceId: selectedPatient && selectedPatient.name === value
        ? String(selectedPatient.referralSourceId ?? "")
        : selectedPatient
          ? String(sources.find((source) => source.name === "Uygulama")?.id ?? "")
          : current.referralSourceId,
    }));
    if (selectedPatient && selectedPatient.name !== value) setSelectedPatient(null);
  }

  async function reloadMonth(month) {
    loadedMonths.current.delete(month);
    loadingMonths.current.delete(month);
    const result = await listAppointmentsForMonth(month);
    if (!result?.ok) {
      toast(result?.error ?? "Randevular yenilenemedi.", "error");
      return false;
    }
    loadedMonths.current.add(month);
    setAppointments((current) => [
      ...current.filter((appointment) => monthOf(appointment.date) !== month),
      ...(result.data ?? []),
    ]);
    return true;
  }

  async function submitAppointment(event) {
    event.preventDefault();
    if (!form.patientId && !form.phone) {
      toast("Yeni randevu adayı için telefon numarası girin.", "error");
      return;
    }
    if (["waiting", "attended"].includes(form.status)) {
      const [hour, minute] = form.time.split(":").map(Number);
      const start = hour * 60 + minute;
      const end = start + Number(form.duration);
      const clashes = appointments.some((appointment) => {
        if (
          appointment.date !== form.date ||
          String(appointment.id) === String(editing?.id ?? "") ||
          !["waiting", "attended"].includes(appointment.status)
        ) return false;
        const [busyHour, busyMinute] = appointment.time.split(":").map(Number);
        const busyStart = busyHour * 60 + busyMinute;
        const busyEnd = busyStart + appointment.duration;
        return start < busyEnd && end > busyStart;
      });
      if (clashes) {
        toast("Bu saatte başka bir randevu var.", "error");
        return;
      }
    }
    setSaving(true);
    const input = {
      patientId: form.patientId || null,
      patientName: form.patientName,
      phone: form.phone,
      kindId: form.kindId,
      date: form.date,
      time: form.time,
      duration: form.duration,
      status: form.status,
      referralSourceId: form.referralSourceId || null,
      notes: form.notes,
    };
    const result = requestToConvert
      ? await convertAppointmentRequest(requestToConvert.id, input)
      : await saveAppointment(input, editing?.id ?? null);
    setSaving(false);

    if (!result?.ok) {
      toast(result?.error ?? "Randevu kaydedilemedi.", "error");
      return;
    }

    const changedTime = editing && (editing.date !== form.date || editing.time !== form.time);
    const phone = form.phone || selectedPatient?.phone;
    setSelectedDate(form.date);
    setCalendarMonth(monthOf(form.date));
    setModalOpen(false);
    if (requestToConvert) {
      setRequests((current) => current.filter((request) => request.id !== requestToConvert.id));
      toast("Web talebi randevuya dönüştürüldü.");
    } else {
      toast(editing ? "Randevu güncellendi." : "Randevu kaydedildi.");
    }
    const monthsToReload = new Set([monthOf(form.date)]);
    if (editing) monthsToReload.add(monthOf(editing.date));
    await Promise.all([...monthsToReload].map(reloadMonth));

    if (changedTime && phone && window.confirm("Randevu saati değişti. Hastaya WhatsApp bilgilendirme taslağı açılsın mı?")) {
      const appointment = {
        patientName: form.patientName,
        phone,
        date: form.date,
        time: form.time,
        kindName: kinds.find((kind) => String(kind.id) === String(form.kindId))?.name ?? "Randevu",
      };
      const href = whatsappLink(appointmentPhone(phone), messageForAppointment(appointment), {
        web: !window.matchMedia("(pointer: coarse)").matches,
      });
      if (href) window.open(href, "_blank", "noopener,noreferrer");
    }
  }

  async function updateAttendance(appointment, status) {
    const result = await markAppointmentAttendance(appointment.id, status);
    if (!result?.ok) {
      toast(result?.error ?? "Katılım durumu güncellenemedi.", "error");
      return;
    }
    setAppointments((current) => current.map((item) => (
      String(item.id) === String(appointment.id) ? { ...item, status, statusLabel: STATUS_LABELS[status] } : item
    )));
    toast(status === "attended" ? "Hasta geldi olarak kaydedildi." : "Gelmedi olarak kaydedildi.");
  }

  async function cancel(appointment) {
    if (!window.confirm(`${appointment.patientName} adlı hastanın randevusu silinmez; iptal edilecek. Devam edilsin mi?`)) return;
    const result = await cancelAppointment(appointment.id);
    if (!result?.ok) {
      toast(result?.error ?? "Randevu iptal edilemedi.", "error");
      return;
    }
    setAppointments((current) => current.map((item) => (
      String(item.id) === String(appointment.id)
        ? { ...item, status: "cancelled", statusLabel: STATUS_LABELS.cancelled }
        : item
    )));
    setModalOpen(false);
    toast("Randevu iptal edildi.");
  }

  async function rejectRequest(request) {
    if (!window.confirm(`${request.full_name} adlı kişinin web randevu talebi reddedilsin mi?`)) return;
    const result = await rejectAppointmentRequest(request.id);
    if (!result?.ok) {
      toast(result?.error ?? "Talep reddedilemedi.", "error");
      return;
    }
    setRequests((current) => current.filter((item) => item.id !== request.id));
    toast("Web talebi reddedildi.");
  }

  function shiftDay(amount) {
    const next = localDateFrom(selectedDate, amount);
    setSelectedDate(next);
    setCalendarMonth(monthOf(next));
  }

  function goToday() {
    setSelectedDate(today);
    setCalendarMonth(monthOf(today));
  }

  function moveMonth(amount) {
    const [year, month] = calendarMonth.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + amount, 1));
    const next = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    setCalendarMonth(next);
  }

  function selectCalendarDate(date) {
    setSelectedDate(date);
    setCalendarMonth(monthOf(date));
    setCalendarOpen(false);
  }

  async function confirmContact(appointment) {
    setContactingId(appointment.id);
    const result = await recordAppointmentContact(appointment.id);
    setContactingId(null);
    if (!result?.ok) {
      toast(result?.error ?? "İletişim kaydedilemedi.", "error");
      return;
    }
    setPendingContactId(null);
    toast("İletişim hasta kartına kaydedildi.");
  }

  function renderCalendar() {
    const [year, month] = calendarMonth.split("-").map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthLabel = first.toLocaleDateString("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });
    return (
      <div className="calendar-popover" hidden={!calendarOpen}>
        <div className="calendar-head">
          <button type="button" aria-label="Önceki ay" onClick={() => moveMonth(-1)}>‹</button>
          <strong>{monthLabel}</strong>
          <button type="button" aria-label="Sonraki ay" onClick={() => moveMonth(1)}>›</button>
        </div>
        <div className="calendar-weekdays">
          {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-days">
          {Array.from({ length: offset }, (_, index) => <span className="cal-day blank" aria-hidden="true" key={`blank-${index}`} />)}
          {Array.from({ length: days }, (_, index) => {
            const date = `${calendarMonth}-${String(index + 1).padStart(2, "0")}`;
            const marked = markedDays.has(date);
            const classes = ["cal-day"];
            if (marked) classes.push("has-appointments");
            if (date === selectedDate) classes.push("selected");
            if (date === today) classes.push("today");
            return (
              <button
                type="button"
                key={date}
                className={classes.join(" ")}
                aria-label={`${formatSelectedDate(date)}${marked ? " · Randevu var" : ""}`}
                onClick={() => selectCalendarDate(date)}
              >
                {index + 1}{marked && <i aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <div className="calendar-legend"><i /> Randevu bulunan gün</div>
      </div>
    );
  }

  return (
    <main className="appointments-page app">
      <header className="top">
        <div>
          <div className="eyebrow">SELALE İŞİTME · HASTA YÖNETİMİ</div>
          <h1>Randevular</h1>
          <p>Günlük planı düzenleyin, randevuları takip edin ve durumlarını güncelleyin.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => openAppointmentModal()}>
            ＋ Randevu oluştur
          </button>
        </div>
      </header>

      {requests.length > 0 && (
        <section className="request-ribbon" aria-label="Web sitesi randevu talepleri">
          <div className="request-ribbon-head">
            <div><strong>Web sitesi talepleri</strong><span>{requests.length} yeni talep</span></div>
          </div>
          <div className="request-ribbon-items">
            {requests.map((request) => (
              <article className="request-ribbon-item" key={request.id}>
                <div>
                  <strong>{request.full_name}</strong>
                  <span>{formatPhone(request.phone)} · {request.appointment_date} {request.appointment_time?.slice(0, 5)}</span>
                </div>
                <div className="request-ribbon-actions">
                  <button type="button" className="btn primary" onClick={() => openAppointmentModal(null, request)}>Randevuya çevir</button>
                  <button type="button" className="btn" onClick={() => rejectRequest(request)}>Reddet</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {patientInfo && (
        <div className="overlay show" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPatientInfo(null);
        }}>
          <section className="modal patient-info-modal" role="dialog" aria-modal="true" aria-labelledby="patient-info-title">
            <div className="modal-head">
              <div><h2 id="patient-info-title">Hasta bilgileri</h2><p>{patientInfo.name}</p></div>
              <button type="button" className="close" aria-label="Kapat" onClick={() => setPatientInfo(null)}>×</button>
            </div>
            <PatientContext patient={patientInfo} />
            <div className="appointment-inline-grid">
              <div><small>Telefon</small><b>{formatPhone(patientInfo.phone)}</b></div>
              <div><small>Doğum tarihi</small><b>{patientInfo.birthDate ?? "Kayıtlı değil"}</b></div>
              <div><small>Adres</small><b>{patientInfo.address ?? "Kayıtlı değil"}</b></div>
              <div><small>Kayıt türü</small><b>{patientInfo.recordType === "candidate" ? "Randevu adayı" : "Kayıtlı hasta"}</b></div>
            </div>
            <div className="modal-foot"><button type="button" className="btn" onClick={() => setPatientInfo(null)}>Kapat</button></div>
          </section>
        </div>
      )}

      <section className="stats">
        <StatCard icon="◷" label="Bugünkü randevular" number={stats.today} hint="Seçili gün için" />
        <StatCard icon="◌" label="Bekliyor" number={stats.waiting} hint="Katılım durumu bekleniyor" />
        <StatCard icon="✓" label="Geldi" number={stats.attended} hint="Katılım kaydedildi" />
        <StatCard icon="×" label="Gelmedi" number={stats.noShow} hint="Katılım kaydedildi" />
      </section>

      <section className="panel">
        <div className="toolbar appointment-toolbar">
          <div className="filters" role="group" aria-label="Randevu durumuna göre filtrele">
            {FILTERS.map((label) => (
              <button
                type="button"
                className={`chip${filter === label ? " active" : ""}`}
                aria-pressed={filter === label}
                key={label}
                onClick={() => setFilter(label)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="search">
            <span className="ui-visually-hidden">Randevularda ara</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Hasta, telefon veya randevu türü ara..."
              aria-label="Randevularda ara"
            />
          </label>
        </div>

        <div className="datebar" ref={calendarRef}>
          <button className="btn" type="button" aria-label="Önceki gün" onClick={() => shiftDay(-1)}>‹</button>
          <button className="btn" type="button" onClick={goToday}>Bugün</button>
          <button className="btn" type="button" aria-label="Sonraki gün" onClick={() => shiftDay(1)}>›</button>
          <button
            className="btn calendar-toggle"
            type="button"
            aria-label="Takvimi aç"
            aria-expanded={calendarOpen}
            onClick={() => {
              setCalendarMonth(monthOf(selectedDate));
              setCalendarOpen((open) => !open);
            }}
          >
            <CalendarIcon />
          </button>
          <strong>{formatSelectedDate(selectedDate)}</strong>
          <span className="spacer" />
          <span className="small">{filtered.length} randevu gösteriliyor</span>
          {renderCalendar()}
        </div>

        <div className="calendar-grid">
          <div>
            <div className="section-head"><h2>Randevu listesi</h2><span className="small">Saat sırasına göre</span></div>
            {loadingMonth ? (
              <div className="empty">Randevular yükleniyor…</div>
            ) : (
              <div className="table-wrap">
                {filtered.length === 0 ? (
                  <div className="empty">
                    Bu tarih ve filtre için randevu bulunamadı.
                    <br />
                    <button className="btn soft" type="button" onClick={() => openAppointmentModal()}>＋ Randevu ekle</button>
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr><th>Saat</th><th>Hasta</th><th>Tür</th><th>Durum</th><th>Katılım / işlem</th></tr>
                    </thead>
                    <tbody>
                      {filtered.map((appointment) => (
                        <AppointmentRow
                          key={appointment.id}
                          appointment={appointment}
                          expanded={String(expandedPatientId) === String(appointment.id)}
                          onPatientInfo={() => setExpandedPatientId((id) => (
                            String(id) === String(appointment.id) ? null : appointment.id
                          ))}
                          onOpen={() => openAppointmentModal(appointment)}
                          onAttendance={(status) => updateAttendance(appointment, status)}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="section-head"><h2>Günün akışı</h2><span className="small">Ajanda</span></div>
            <div className="agenda">
              {dayAgenda.length === 0 ? <div className="empty">Saati geçmemiş randevu yok.</div> : dayAgenda.map((appointment) => (
                <div className="agenda-item" key={appointment.id}>
                  <div className="agenda-time">{appointment.time}</div>
                  <div className={`rail${appointment.status === "waiting" ? " amber" : ""}`} />
                  <div className="agenda-content">
                    <b><button type="button" className="patient patient-link" onClick={() => openPatientInfo(appointment)}>{appointment.patientName}</button></b>
                    <div className="small">{appointment.kindName} · {STATUS_LABELS[appointment.status]}</div>
                    <AppointmentWhatsApp
                      appointment={appointment}
                      onOpen={() => setPendingContactId(appointment.id)}
                    />
                    {String(pendingContactId) === String(appointment.id) && (
                      <button
                        type="button"
                        className="wa-contact-confirm"
                        disabled={String(contactingId) === String(appointment.id)}
                        onClick={() => confirmContact(appointment)}
                      >
                        {String(contactingId) === String(appointment.id) ? "Kaydediliyor…" : "İletişim sağlandı"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="notice">Hatırlatma zamanı geldiğinde uygulama küçük bir pencere açar. Tıklayınca WhatsApp taslağı açılır; mesajı kontrol edip siz gönderirsiniz.</div>
          </div>
        </div>
      </section>

      {modalOpen && (
        <div className="overlay show" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setModalOpen(false);
        }}>
          <section className="modal appointment-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-head">
              <div><h2 id="modal-title">{editing ? "Randevuyu düzenle" : requestToConvert ? "Talebi randevuya çevir" : "Yeni randevu"}</h2><p>Gerekli alanları doldurup kaydedin.</p></div>
              <button type="button" className="close" aria-label="Kapat" onClick={() => setModalOpen(false)}>×</button>
            </div>
            {requestToConvert && (
              <div className="ctx">
                <div className="why">Web sitesi talebi: {requestToConvert.full_name} · {formatPhone(requestToConvert.phone)}</div>
                <div className="ctx-note">Talep ve randevu tek işlemde kaydedilecek; randevu kaynağı Web sitesi olacak.</div>
              </div>
            )}
            {selectedPatient && !requestToConvert && <PatientContext patient={selectedPatient} />}
            <form key={modalPatientId} id="appointment-form" onSubmit={submitAppointment}>
              <div className="form-grid">
                <div className="field full patient-picker">
                  <label htmlFor="appointment-patient">Hasta adı soyadı *</label>
                  <input
                    id="appointment-patient"
                    value={patientQuery}
                    maxLength={120}
                    required
                    autoComplete="off"
                    placeholder="Ad Soyad"
                    onChange={(event) => handlePatientName(event.target.value)}
                  />
                  {patientOptions.length > 0 && patientQuery !== selectedPatient?.name && (
                    <div className="patient-options" role="listbox" aria-label="Kayıtlı hastalar">
                      {patientOptions.map((patient) => (
                        <button type="button" key={patient.id} onClick={() => choosePatient(patient)}>
                          <span><b>{patient.name}</b><small>{formatPhone(patient.phone)} · {patient.recordType === "candidate" ? "Randevu adayı" : "Kayıtlı hasta"}</small></span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!selectedPatient && patientQuery.trim() && patientOptions.length === 0 && (
                    <small className="field-hint">Kayıtlı eşleşme bulunamadı; kaydedildiğinde randevu adayı oluşturulur.</small>
                  )}
                </div>

                <div className="field">
                  <PhoneInput
                    key={phoneInputKey}
                    id="appointment-phone"
                    label="Telefon *"
                    defaultCountry={splitPhone(form.phone).country}
                    defaultNumber={splitPhone(form.phone).number}
                    required
                    onChange={(phone) => setFormValue("phone", phone ?? "")}
                  />
                </div>
                <div className="field">
                  <label htmlFor="appointment-kind">Randevu türü *</label>
                  <select id="appointment-kind" required value={form.kindId} onChange={(event) => setFormValue("kindId", event.target.value)}>
                    {kinds.map((kind) => <option key={kind.id} value={kind.id}>{kind.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="appointment-date">Tarih *</label>
                  <input id="appointment-date" type="date" required value={form.date} onChange={(event) => setFormValue("date", event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="appointment-time">Saat *</label>
                  <input id="appointment-time" type="time" required value={form.time} onChange={(event) => setFormValue("time", event.target.value)} />
                </div>
                <div className="field full">
                  <label>Boş saatler <span className="small">(seçili tarih ve süre için)</span></label>
                  <div className="slots">
                    {freeSlots.map((slot) => (
                      <button
                        type="button"
                        className={`slot${form.time === slot.label ? " on" : ""}${slot.busy ? " busy" : ""}`}
                        key={slot.label}
                        disabled={slot.busy}
                        title={slot.busy ? "Dolu" : undefined}
                        onClick={() => setFormValue("time", slot.label)}
                      >
                        {slot.label}
                      </button>
                    ))}
                    <span className="small slot-summary">
                      Bu gün {appointments.filter((appointment) => appointment.date === form.date && appointment.status !== "cancelled").length} randevu var · {freeSlots.filter((slot) => !slot.busy).length} boş saat
                    </span>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="appointment-duration">Süre</label>
                  <select id="appointment-duration" value={form.duration} onChange={(event) => setFormValue("duration", event.target.value)}>
                    {DURATION_OPTIONS.map((duration) => <option key={duration} value={duration}>{duration} dakika</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="appointment-status">Durum</label>
                  <select id="appointment-status" disabled={Boolean(requestToConvert)} value={form.status} onChange={(event) => setFormValue("status", event.target.value)}>
                    {Object.entries(STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="appointment-source">Randevu kaynağı</label>
                  <select
                    id="appointment-source"
                    value={form.referralSourceId}
                    disabled={Boolean(form.patientId) || Boolean(requestToConvert)}
                    onChange={(event) => setFormValue("referralSourceId", event.target.value)}
                  >
                    <option value="">Seçilmedi</option>
                    {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                  </select>
                  {form.patientId && <small className="field-hint">Kayıtlı hastanın kaynak bilgisi kullanılır.</small>}
                  {requestToConvert && <small className="field-hint">Talep randevuya çevrildiğinde kaynak Web sitesi olur.</small>}
                </div>
                <div className="field full">
                  <label htmlFor="appointment-notes">Not (isteğe bağlı)</label>
                  <textarea id="appointment-notes" rows="3" maxLength="500" placeholder="Randevuya dair kısa not…" value={form.notes} onChange={(event) => setFormValue("notes", event.target.value)} />
                </div>
              </div>
              <div className="modal-foot">
                {editing && editing.status !== "cancelled" && (
                  <button type="button" className="btn danger cancel-appointment" onClick={() => cancel(editing)}>Randevuyu iptal et</button>
                )}
                <button type="button" className="btn" onClick={() => setModalOpen(false)}>Vazgeç</button>
                <button className="btn primary" type="submit" disabled={saving}>{saving ? "Kaydediliyor…" : "Randevuyu kaydet"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function StatCard({ icon, label, number, hint }) {
  return (
    <article className="stat">
      <span className="icon" aria-hidden="true">{icon}</span>
      <div className="label">{label}</div>
      <div className="num">{number}</div>
      <div className="hint">{hint}</div>
    </article>
  );
}

function AppointmentRow({ appointment, expanded, onPatientInfo, onOpen, onAttendance }) {
  const arrived = appointment.status === "attended";
  const missed = appointment.status === "no_show";
  const cancelled = appointment.status === "cancelled";
  return (
    <>
      <tr data-appointment-id={appointment.id}>
        <td><span className="time">{appointment.time}</span><span className="sub">{appointment.duration} dk</span></td>
        <td className="appt-patient-cell">
          <div className="patient-identity">
            <span className="patient-avatar" aria-hidden="true">{initials(appointment.patientName)}</span>
            <div className="patient-copy">
              <button type="button" className="patient patient-link" onClick={onPatientInfo} title="Hasta bilgilerini görüntüle">{appointment.patientName}</button>
              <span className="sub patient-phone">{formatPhone(appointment.phone)}</span>
            </div>
          </div>
        </td>
        <td>
          {appointment.kindName}
          {appointment.notes && <span className="sub">{appointment.notes}</span>}
          <span className="sub appointment-source">Kaynak: {appointment.sourceName}</span>
        </td>
        <td><StatusBadge status={appointment.status} /></td>
        <td>
          <div className="row-actions">
            <button type="button" className="icon-btn open-appt" title="Randevuyu aç / düzenle" onClick={onOpen}>Aç</button>
            <button type="button" className={`attendance-btn arrived${arrived ? " is-active" : ""}`} aria-pressed={arrived} disabled={cancelled} onClick={() => onAttendance("attended")}>Geldi</button>
            <button type="button" className={`attendance-btn absent${missed ? " is-active" : ""}`} aria-pressed={missed} disabled={cancelled} onClick={() => onAttendance("no_show")}>Gelmedi</button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="appointment-inline-detail">
          <td colSpan="5">
            <div className="appointment-inline-grid">
              <div><small>Telefon</small><b>{formatPhone(appointment.phone) || "Telefon eklenmedi"}</b></div>
              <div><small>Doğum tarihi</small><b>{appointment.birthDate ?? "Kayıtlı değil"}</b></div>
              <div><small>Cihaz / model</small><b>{appointment.devices ?? "Kayıtlı değil"}</b></div>
              <div><small>Adres</small><b>{appointment.address ?? "Kayıtlı değil"}</b></div>
              <div><small>Hasta durumu</small><b>{appointment.patientStatus ? statusLabel(appointment.patientStatus).label : appointment.patientRecordType === "candidate" ? "Randevu adayı" : "Kayıtlı değil"}</b></div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }) {
  const tone = status === "waiting" ? "waiting" : status === "attended" ? "attended" : status === "no_show" ? "missed" : "cancelled";
  return <span className={`badge ${tone}`}>{STATUS_LABELS[status] ?? status}</span>;
}

function PatientContext({ patient }) {
  const patientStatus = patient.status
    ? statusLabel(patient.status).label
    : patient.recordType === "candidate" ? "Randevu adayı" : "—";
  return (
    <div className="ctx">
      <div className="ctx-grid">
        <div><span>Hasta</span><b>{patient.name}</b><small>{formatPhone(patient.phone)}</small></div>
        <div><span>Cihaz</span><b>{patient.devices || "Atanmadı"}</b></div>
        <div><span>Garanti bitişi</span><b>{patient.warrantyEnd ?? "—"}</b></div>
        <div><span>Hasta durumu</span><b>{patientStatus}</b></div>
        <div><span>Son randevu</span><b>{patient.lastAppointment ? new Date(patient.lastAppointment).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "Kayıt yok"}</b></div>
        <div><span>Sıradaki randevu</span><b>{patient.nextAppointment ? new Date(patient.nextAppointment).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "Yok"}</b></div>
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  );
}
