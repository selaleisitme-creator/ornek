"use client";

import { useMemo, useState } from "react";

const initialAppointments = [
  {
    id: 1,
    full_name: "Ahmet Yılmaz",
    phone: "0555 123 45 67",
    email: "ahmet@example.com",
    appointment_date: "2026-11-20",
    appointment_time: "10:30",
    issue: "İşitme testi",
    status: "new",
  },
  {
    id: 2,
    full_name: "Ayşe Demir",
    phone: "0532 456 78 90",
    email: "ayse@example.com",
    appointment_date: "2026-11-20",
    appointment_time: "14:00",
    issue: "İşitme cihazı danışmanlığı",
    status: "converted",
  },
];

const statusLabels = {
  new: "Yeni",
  converted: "Onaylandı",
  rejected: "Reddedildi",
};

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    appointment_date: "",
    appointment_time: "",
    issue: "",
  });

  const filteredAppointments = useMemo(() => {
    return appointments.filter((appointment) => {
      const matchesSearch =
        appointment.full_name.toLowerCase().includes(search.toLowerCase()) ||
        appointment.phone.includes(search);

      const matchesFilter =
        filter === "all" || appointment.status === filter;

      return matchesSearch && matchesFilter;
    });
  }, [appointments, search, filter]);

  function addAppointment(e) {
    e.preventDefault();

    const newAppointment = {
      ...form,
      id: Date.now(),
      status: "new",
    };

    setAppointments((previous) => [newAppointment, ...previous]);

    setForm({
      full_name: "",
      phone: "",
      email: "",
      appointment_date: "",
      appointment_time: "",
      issue: "",
    });

    setShowForm(false);
  }

  function updateStatus(id, status) {
    setAppointments((previous) =>
      previous.map((appointment) =>
        appointment.id === id
          ? { ...appointment, status }
          : appointment
      )
    );
  }

  const newCount = appointments.filter((a) => a.status === "new").length;
  const approvedCount = appointments.filter(
    (a) => a.status === "converted"
  ).length;
  const rejectedCount = appointments.filter(
    (a) => a.status === "rejected"
  ).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Randevular</h1>
          <p className="mt-1 text-sm text-gray-500">
            Randevu taleplerini yönetin ve takip edin.
          </p>
        </div>

        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          + Yeni Randevu
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Yeni Talepler" value={newCount} />
        <StatCard title="Onaylananlar" value={approvedCount} />
        <StatCard title="Reddedilenler" value={rejectedCount} />
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="İsim veya telefon ile ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[220px] flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
        />

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-3 text-sm"
        >
          <option value="all">Tüm Randevular</option>
          <option value="new">Yeni</option>
          <option value="converted">Onaylandı</option>
          <option value="rejected">Reddedildi</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="p-4">Müşteri</th>
              <th className="p-4">Telefon</th>
              <th className="p-4">Tarih</th>
              <th className="p-4">Saat</th>
              <th className="p-4">Konu</th>
              <th className="p-4">Durum</th>
              <th className="p-4">İşlem</th>
            </tr>
          </thead>

          <tbody>
            {filteredAppointments.map((appointment) => (
              <tr key={appointment.id} className="border-t border-gray-100">
                <td className="p-4 font-medium text-gray-900">
                  {appointment.full_name}
                </td>
                <td className="p-4 text-gray-600">{appointment.phone}</td>
                <td className="p-4 text-gray-600">
                  {appointment.appointment_date}
                </td>
                <td className="p-4 text-gray-600">
                  {appointment.appointment_time}
                </td>
                <td className="p-4 text-gray-600">{appointment.issue}</td>
                <td className="p-4">
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                    {statusLabels[appointment.status]}
                  </span>
                </td>
                <td className="p-4">
                  <select
                    value={appointment.status}
                    onChange={(e) =>
                      updateStatus(appointment.id, e.target.value)
                    }
                    className="rounded-md border border-gray-300 p-2 text-xs"
                  >
                    <option value="new">Yeni</option>
                    <option value="converted">Onayla</option>
                    <option value="rejected">Reddet</option>
                  </select>
                </td>
              </tr>
            ))}

            {filteredAppointments.length === 0 && (
              <tr>
                <td colSpan="7" className="p-8 text-center text-gray-500">
                  Randevu bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={addAppointment}
            className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6"
          >
            <h2 className="text-xl font-bold text-gray-900">
              Yeni Randevu Oluştur
            </h2>

            <input
              required
              placeholder="Ad Soyad"
              value={form.full_name}
              onChange={(e) =>
                setForm({ ...form, full_name: e.target.value })
              }
              className="w-full rounded-lg border p-3"
            />

            <input
              required
              placeholder="Telefon"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-lg border p-3"
            />

            <input
              type="email"
              placeholder="E-posta"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-lg border p-3"
            />

            <input
              required
              type="date"
              value={form.appointment_date}
              onChange={(e) =>
                setForm({ ...form, appointment_date: e.target.value })
              }
              className="w-full rounded-lg border p-3"
            />

            <input
              required
              type="time"
              value={form.appointment_time}
              onChange={(e) =>
                setForm({ ...form, appointment_time: e.target.value })
              }
              className="w-full rounded-lg border p-3"
            />

            <input
              required
              placeholder="Randevu konusu"
              value={form.issue}
              onChange={(e) => setForm({ ...form, issue: e.target.value })}
              className="w-full rounded-lg border p-3"
            />

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border px-4 py-2"
              >
                İptal
              </button>

              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-4 py-2 text-white"
              >
                Kaydet
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
