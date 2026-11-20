"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const STATUS_META = {
  waiting: {
    label: "Bekliyor",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
  },
  attended: {
    label: "Geldi",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  no_show: {
    label: "Gelmedi",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
  },
  cancelled: {
    label: "İptal",
    badge: "bg-gray-100 text-gray-600 border-gray-200",
  },
};

const REQUEST_STATUS_LABELS = {
  new: "Yeni Talep",
  converted: "Randevuya Dönüştürüldü",
  rejected: "Reddedildi",
};

function toLocalDateStr(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTurkishDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
  });
}

function formatTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AppointmentsPage() {
  const supabase = useMemo(() => createClient(), []);

  // Üst sekme: klinik randevuları ('appointments') veya web talepleri ('requests')
  const [activeSection, setActiveSection] = useState("appointments");

  // Tarih ve filtre state'leri
  const [selectedDate, setSelectedDate] = useState(() =>
    toLocalDateStr(new Date())
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Veritabanı verileri
  const [appointments, setAppointments] = useState([]);
  const [requests, setRequests] = useState([]);
  const [kinds, setKinds] = useState([]);
  const [patients, setPatients] = useState([]);
  const [sources, setSources] = useState([]);

  // Durum bildirimleri
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Yeni Randevu Modal State
  const [showForm, setShowForm] = useState(false);
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [form, setForm] = useState({
    patient_id: "",
    new_full_name: "",
    new_phone: "",
    kind_id: "",
    date: toLocalDateStr(new Date()),
    start_time: "10:00",
    duration: "30",
    referral_source_id: "",
    notes: "",
    request_id: null,
  });

  // Referans verilerini (Randevu türleri, hastalar, kaynaklar) çek
  const loadReferenceData = useCallback(async () => {
    const [kindsRes, patientsRes, sourcesRes] = await Promise.all([
      supabase
        .from("appointment_kinds")
        .select("id, name, sort_order")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("patients")
        .select("id, full_name, phone, patient_no")
        .eq("active", true)
        .order("full_name", { ascending: true }),
      supabase
        .from("referral_sources")
        .select("id, name")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
    ]);

    if (kindsRes.data) {
      setKinds(kindsRes.data);
      if (kindsRes.data.length > 0) {
        setForm((prev) => ({
          ...prev,
          kind_id: prev.kind_id || String(kindsRes.data[0].id),
        }));
      }
    }
    if (patientsRes.data) setPatients(patientsRes.data);
    if (sourcesRes.data) setSources(sourcesRes.data);
  }, [supabase]);

  // Seçili güne ait randevuları çek
  const loadAppointments = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");

    const startOfDay = new Date(`${selectedDate}T00:00:00`).toISOString();
    const endOfDay = new Date(`${selectedDate}T23:59:59.999`).toISOString();

    const { data, error } = await supabase
      .from("appointments")
      .select(
        `
        id,
        starts_at,
        ends_at,
        status,
        cancelled_at,
        notes,
        patient:patients ( id, full_name, phone, patient_no ),
        kind:appointment_kinds ( id, name ),
        source:referral_sources ( id, name )
      `
      )
      .gte("starts_at", startOfDay)
      .lte("starts_at", endOfDay)
      .order("starts_at", { ascending: true });

    if (error) {
      setErrorMsg("Randevular yüklenirken hata oluştu: " + error.message);
    } else {
      setAppointments(data || []);
    }
    setLoading(false);
  }, [selectedDate, supabase]);

  // Web sitesinden gelen randevu taleplerini çek (R23)
  const loadRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from("appointment_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setRequests(data);
    }
  }, [supabase]);

  useEffect(() => {
    loadReferenceData();
    loadRequests();
  }, [loadReferenceData, loadRequests]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  // Gün değiştirme yardımcıları
  function shiftDate(days) {
    const [y, m, d] = selectedDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d + days);
    setSelectedDate(toLocalDateStr(dt));
  }

  // Durum güncelleme (Geldi / Gelmedi / Bekliyor / İptal)
  async function handleStatusChange(id, newStatus) {
    setErrorMsg("");
    setSuccessMsg("");

    const payload = {
      status: newStatus,
      cancelled_at: newStatus === "cancelled" ? new Date().toISOString() : null,
    };

    const { error } = await supabase
      .from("appointments")
      .update(payload)
      .eq("id", id);

    if (error) {
      if (error.code === "23P01") {
        setErrorMsg(
          "Bu saat aralığında bekleyen veya gelinmiş başka bir randevu olduğu için durum değiştirilemedi."
        );
      } else {
        setErrorMsg("Durum güncellenemedi: " + error.message);
      }
      return;
    }

    setSuccessMsg("Randevu durumu güncellendi.");
    loadAppointments();
  }

  // Yeni randevu oluşturma
  async function handleCreateAppointment(e) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      let targetPatientId = form.patient_id ? Number(form.patient_id) : null;

      // Eğer yeni hasta/aday girildiyse önce patients tablosuna ekle
      if (isNewPatient) {
        if (!form.new_full_name.trim() || !form.new_phone.trim()) {
          throw new Error("Yeni hasta için ad soyad ve telefon zorunludur.");
        }

        const tempPatientNo = "ADAY-" + Date.now().toString().slice(-6);
        const { data: createdPatient, error: patientError } = await supabase
          .from("patients")
          .insert({
            patient_no: tempPatientNo,
            full_name: form.new_full_name.trim(),
            phone: form.new_phone.trim(),
            record_type: "randevu adayı",
            registered_on: toLocalDateStr(new Date()),
            referral_source_id: form.referral_source_id
              ? Number(form.referral_source_id)
              : null,
            active: true,
          })
          .select("id")
          .single();

        if (patientError) {
          throw new Error("Hasta kaydı açılamadı: " + patientError.message);
        }
        targetPatientId = createdPatient.id;
      }

      if (!targetPatientId) {
        throw new Error("Lütfen bir hasta seçin veya yeni hasta bilgisi girin.");
      }

      const startObj = new Date(`${form.date}T${form.start_time}:00`);
      const durationMinutes = Number(form.duration);
      const endObj = new Date(startObj.getTime() + durationMinutes * 60000);

      const { error: insertError } = await supabase
        .from("appointments")
        .insert({
          patient_id: targetPatientId,
          kind_id: Number(form.kind_id),
          starts_at: startObj.toISOString(),
          ends_at: endObj.toISOString(),
          status: "waiting",
          referral_source_id: form.referral_source_id
            ? Number(form.referral_source_id)
            : null,
          request_id: form.request_id || null,
          notes: form.notes.trim() || null,
        });

      if (insertError) {
        if (insertError.code === "23P01") {
          throw new Error(
            "Seçilen saat aralığında başka bir aktif randevu bulunuyor. Lütfen farklı bir saat seçin."
          );
        }
        throw new Error(insertError.message);
      }

      // Eğer web talebinden dönüştürüldüyse talebi 'converted' yap
      if (form.request_id) {
        await supabase
          .from("appointment_requests")
          .update({ status: "converted" })
          .eq("id", form.request_id);
        loadRequests();
      }

      setShowForm(false);
      setSelectedDate(form.date);
      setSuccessMsg("Randevu başarıyla oluşturuldu.");
      setForm((prev) => ({
        ...prev,
        new_full_name: "",
        new_phone: "",
        notes: "",
        request_id: null,
      }));
      await Promise.all([loadAppointments(), loadReferenceData()]);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Web talebini randevuya dönüştürmek için modalı doldurup aç
  function openConvertRequestModal(req) {
    setIsNewPatient(true);
    setForm((prev) => ({
      ...prev,
      new_full_name: req.full_name || "",
      new_phone: req.phone || "",
      date: req.preferred_date || selectedDate,
      start_time: req.preferred_time || "10:00",
      notes: req.issue || req.notes || "",
      request_id: req.id,
    }));
    setShowForm(true);
  }

  // Web talebi durumunu güncelle
  async function updateRequestStatus(id, status) {
    const { error } = await supabase
      .from("appointment_requests")
      .update({ status })
      .eq("id", id);

    if (!error) {
      setSuccessMsg("Talep durumu güncellendi.");
      loadRequests();
    } else {
      setErrorMsg("Talep güncellenemedi: " + error.message);
    }
  }

  // İstatistikler (iptal hariç günlük toplam + durum bazlı sayılar)
  const activeDayAppointments = appointments.filter(
    (a) => a.status !== "cancelled"
  );
  const waitingCount = appointments.filter(
    (a) => a.status === "waiting"
  ).length;
  const attendedCount = appointments.filter(
    (a) => a.status === "attended"
  ).length;
  const noShowCount = appointments.filter(
    (a) => a.status === "no_show"
  ).length;
  const newRequestsCount = requests.filter((r) => r.status === "new").length;

  // Arama ve sekme filtrelemesi
  const filteredAppointments = useMemo(() => {
    return appointments.filter((app) => {
      const matchesStatus =
        statusFilter === "all" || app.status === statusFilter;
      const q = search.trim().toLowerCase();
      if (!q) return matchesStatus;

      const patientName = app.patient?.full_name?.toLowerCase() || "";
      const patientPhone = app.patient?.phone?.toLowerCase() || "";
      const kindName = app.kind?.name?.toLowerCase() || "";

      return (
        matchesStatus &&
        (patientName.includes(q) ||
          patientPhone.includes(q) ||
          kindName.includes(q))
      );
    });
  }, [appointments, statusFilter, search]);

  return (
    <div className="space-y-6 p-6">
      {/* Üst Başlık */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
            ŞELALE İŞİTME · HASTA YÖNETİMİ
          </p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">Randevular</h1>
          <p className="mt-1 text-sm text-gray-500">
            Günlük planı düzenleyin, randevuları takip edin ve durumlarını
            güncelleyin.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setActiveSection(
                activeSection === "appointments" ? "requests" : "appointments"
              )
            }
            className="relative rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {activeSection === "appointments"
              ? "Web Talepleri"
              : "Günlük Randevulara Dön"}
            {newRequestsCount > 0 && activeSection === "appointments" && (
              <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
                {newRequestsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setIsNewPatient(false);
              setForm((prev) => ({
                ...prev,
                date: selectedDate,
                request_id: null,
              }));
              setShowForm(true);
            }}
            className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800"
          >
            + Randevu oluştur
          </button>
        </div>
      </div>

      {/* Hata / Başarı Bildirimleri */}
      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      {activeSection === "appointments" ? (
        <>
          {/* 4 Özet Kartı */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Seçili gün randevuları"
              value={activeDayAppointments.length}
              subtitle="Seçili gün için"
            />
            <StatCard
              title="Bekliyor"
              value={waitingCount}
              subtitle="Katılım durumu bekleniyor"
            />
            <StatCard
              title="Geldi"
              value={attendedCount}
              subtitle="Katılım kaydedildi"
            />
            <StatCard
              title="Gelmedi"
              value={noShowCount}
              subtitle="Katılım kaydedildi"
            />
          </div>

          {/* Sekme Filtreleri ve Arama */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
              {[
                { key: "all", label: "Tümü" },
                { key: "waiting", label: "Bekliyor" },
                { key: "attended", label: "Geldi" },
                { key: "no_show", label: "Gelmedi" },
                { key: "cancelled", label: "İptal" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                    statusFilter === tab.key
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Hasta, telefon veya randevu türü ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full min-w-[260px] flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:border-blue-600 sm:max-w-xs"
            />
          </div>

          {/* Gün Geçiş Çubuğu */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => shiftDate(-1)}
                className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                &lt;
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(toLocalDateStr(new Date()))}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              >
                Bugün
              </button>
              <button
                type="button"
                onClick={() => shiftDate(1)}
                className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                &gt;
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) =>
                  e.target.value && setSelectedDate(e.target.value)
                }
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
              />
              <span className="ml-2 text-sm font-semibold text-gray-800">
                {formatTurkishDate(selectedDate)}
              </span>
            </div>
          </div>

          {/* Randevu Listesi Tablosu */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-bold text-gray-900">
                Randevu listesi
              </h2>
              <span className="text-xs font-medium text-blue-700">
                Saat sırasına göre
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-5 py-3.5">Saat</th>
                    <th className="px-5 py-3.5">Hasta</th>
                    <th className="px-5 py-3.5">Tür</th>
                    <th className="px-5 py-3.5">Durum</th>
                    <th className="px-5 py-3.5">Katılım / İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td
                        colSpan="5"
                        className="px-5 py-8 text-center text-gray-500"
                      >
                        Randevular yükleniyor...
                      </td>
                    </tr>
                  ) : filteredAppointments.length === 0 ? (
                    <tr>
                      <td
                        colSpan="5"
                        className="px-5 py-8 text-center text-gray-500"
                      >
                        Seçili güne ait randevu bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    filteredAppointments.map((app) => {
                      const meta =
                        STATUS_META[app.status] || STATUS_META.waiting;
                      return (
                        <tr key={app.id} className="hover:bg-gray-50/70">
                          <td className="whitespace-nowrap px-5 py-4 font-semibold text-gray-900">
                            {formatTime(app.starts_at)} -{" "}
                            {formatTime(app.ends_at)}
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-semibold text-gray-900">
                              {app.patient?.full_name || "Bilinmeyen Hasta"}
                            </div>
                            <div className="text-xs text-gray-500">
                              {app.patient?.phone || "-"}
                              {app.notes ? ` · ${app.notes}` : ""}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-gray-700">
                            {app.kind?.name || "-"}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${meta.badge}`}
                            >
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleStatusChange(app.id, "attended")
                                }
                                className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                              >
                                Geldi
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleStatusChange(app.id, "no_show")
                                }
                                className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                              >
                                Gelmedi
                              </button>
                              <select
                                value={app.status}
                                onChange={(e) =>
                                  handleStatusChange(app.id, e.target.value)
                                }
                                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                              >
                                <option value="waiting">Bekliyor</option>
                                <option value="attended">Geldi</option>
                                <option value="no_show">Gelmedi</option>
                                <option value="cancelled">İptal Et</option>
                              </select>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Web Sitesi Randevu Talepleri Bölümü (R23) */
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-base font-bold text-gray-900">
              Web Sitesi Randevu Talepleri
            </h2>
            <p className="text-xs text-gray-500">
              Sitedeki formdan gelen talepleri inceleyip klinik randevusuna
              dönüştürebilirsiniz.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-5 py-3.5">Ad Soyad</th>
                  <th className="px-5 py-3.5">Telefon</th>
                  <th className="px-5 py-3.5">Not / Konu</th>
                  <th className="px-5 py-3.5">Durum</th>
                  <th className="px-5 py-3.5">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requests.length === 0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      className="px-5 py-8 text-center text-gray-500"
                    >
                      Kayıtlı web randevu talebi bulunmuyor.
                    </td>
                  </tr>
                ) : (
                  requests.map((req) => (
                    <tr key={req.id}>
                      <td className="px-5 py-4 font-semibold text-gray-900">
                        {req.full_name}
                      </td>
                      <td className="px-5 py-4 text-gray-600">{req.phone}</td>
                      <td className="px-5 py-4 text-gray-600">
                        {req.issue || req.notes || "-"}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                          {REQUEST_STATUS_LABELS[req.status] || req.status}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => openConvertRequestModal(req)}
                            className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                          >
                            Randevuya Dönüştür
                          </button>
                          {req.status !== "rejected" && (
                            <button
                              type="button"
                              onClick={() =>
                                updateRequestStatus(req.id, "rejected")
                              }
                              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              Reddet
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* + Randevu Oluştur Modalı */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleCreateAppointment}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                Yeni Randevu Oluştur
              </h2>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                Kapat
              </button>
            </div>

            {/* Kayıtlı Hasta / Yeni Aday Seçimi */}
            <div className="flex gap-2 rounded-lg bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setIsNewPatient(false)}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
                  !isNewPatient
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600"
                }`}
              >
                Kayıtlı Hasta Seç
              </button>
              <button
                type="button"
                onClick={() => setIsNewPatient(true)}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
                  isNewPatient
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600"
                }`}
              >
                Yeni Randevu Adayı Ekle
              </button>
            </div>

            {!isNewPatient ? (
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  Hasta
                </label>
                <select
                  required
                  value={form.patient_id}
                  onChange={(e) =>
                    setForm({ ...form, patient_id: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                >
                  <option value="">Hasta seçiniz...</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.phone})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    Ad Soyad
                  </label>
                  <input
                    required
                    placeholder="Örn: Ahmet Yılmaz"
                    value={form.new_full_name}
                    onChange={(e) =>
                      setForm({ ...form, new_full_name: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    Telefon
                  </label>
                  <input
                    required
                    placeholder="05XX XXX XX XX"
                    value={form.new_phone}
                    onChange={(e) =>
                      setForm({ ...form, new_phone: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  Randevu Türü
                </label>
                <select
                  required
                  value={form.kind_id}
                  onChange={(e) =>
                    setForm({ ...form, kind_id: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                >
                  {kinds.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  Kaynak (İsteğe bağlı)
                </label>
                <select
                  value={form.referral_source_id}
                  onChange={(e) =>
                    setForm({ ...form, referral_source_id: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                >
                  <option value="">Seçilmedi</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  Tarih
                </label>
                <input
                  required
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  Başlangıç Saati
                </label>
                <input
                  required
                  type="time"
                  value={form.start_time}
                  onChange={(e) =>
                    setForm({ ...form, start_time: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-700">
                  Süre
                </label>
                <select
                  value={form.duration}
                  onChange={(e) =>
                    setForm({ ...form, duration: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
                >
                  <option value="15">15 Dakika</option>
                  <option value="30">30 Dakika</option>
                  <option value="45">45 Dakika</option>
                  <option value="60">60 Dakika</option>
                  <option value="90">90 Dakika</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-700">
                Not (İsteğe bağlı)
              </label>
              <input
                placeholder="Randevu ile ilgili kısa not..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded-lg border border-gray-300 p-2.5 text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {saving ? "Kaydediliyor..." : "Randevuyu Kaydet"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, subtitle }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold text-gray-500">{title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
    </div>
  );
}