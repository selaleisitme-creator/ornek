import Link from "next/link";
import DataTable from "@/modules/shared/ui/DataTable";
import { formatDateTime } from "@/lib/dates";
import { initials, patientsHref } from "../patientRules";
import PatientStatus from "./PatientStatus";

// The patient list as a table (default) or as cards (?gorunum=kart). Candidates show their appointment
// instead of a device. Each row opens the patient card (?ac=<id>), keeping the filters for the way back.
export default function PatientList({ query, list }) {
  const candidates = query.sekme === "aday";
  const countText = list.limited
    ? `İlk ${list.rows.length} kayıt gösteriliyor (toplam ${list.total}). Aramayı daraltın.`
    : `${list.total} kayıt gösteriliyor`;

  if (!list.rows.length) {
    return (
      <p className="patients-empty">
        {query.ara
          ? "Aramanızla eşleşen kayıt bulunamadı."
          : candidates
            ? "Henüz randevu adayı yok. Yeni randevu kaydedildiğinde burada görünür."
            : "Bu filtreye uygun hasta bulunamadı."}
      </p>
    );
  }

  return (
    <>
      <p className="patients-count" role="status">
        {countText}
      </p>
      {query.gorunum === "kart" ? (
        <PatientCards query={query} rows={list.rows} />
      ) : (
        <PatientTable query={query} rows={list.rows} candidates={candidates} />
      )}
    </>
  );
}

function appointmentText(row) {
  if (row.nextAppointment) return `Sonraki: ${formatDateTime(row.nextAppointment)}`;
  if (row.lastAppointment) return `Son: ${formatDateTime(row.lastAppointment)}`;
  return "—";
}

function Person({ row }) {
  return (
    <div className="patients-person">
      <span className="patients-avatar" aria-hidden="true">
        {initials(row.name)}
      </span>
      <div>
        <b>{row.name}</b>
        <small>{row.patientNo}</small>
      </div>
    </div>
  );
}

function PatientTable({ query, rows, candidates }) {
  const columns = [
    { key: "name", label: candidates ? "Randevu adayı" : "Hasta", render: (row) => <Person row={row} /> },
    { key: "phone", label: "Telefon", render: (row) => <span className="patients-phone">{row.phone ?? "—"}</span> },
    candidates
      ? { key: "appointment", label: "Randevu", render: appointmentText }
      : { key: "devices", label: "Kullanılan cihaz", render: (row) => row.devices ?? "Henüz atanmadı" },
    {
      key: "status",
      label: "Durum",
      render: (row) => <PatientStatus status={row.status} statusText={row.statusText} adaptation={row.adaptation} />,
    },
    {
      key: "open",
      label: "",
      align: "end",
      render: (row) => (
        <Link className="ui-button ui-button-ghost patients-open" href={patientsHref(query, { ac: row.id })}>
          {row.candidate ? "Aday kartı →" : "Kartı aç →"}
        </Link>
      ),
    },
  ];
  return <DataTable columns={columns} rows={rows} caption="Hasta listesi" />;
}

function PatientCards({ query, rows }) {
  return (
    <ul className="patients-cards">
      {rows.map((row) => (
        <li key={row.id} className="patients-card">
          <Person row={row} />
          <dl className="patients-card-meta">
            <div>
              <dt>Telefon</dt>
              <dd>{row.phone}</dd>
            </div>
            <div>
              <dt>{row.candidate ? "Randevu" : "Kullanılan cihaz"}</dt>
              <dd>{row.candidate ? appointmentText(row) : (row.devices ?? "Henüz atanmadı")}</dd>
            </div>
            <div>
              <dt>Durum</dt>
              <dd>
                <PatientStatus status={row.status} statusText={row.statusText} adaptation={row.adaptation} />
              </dd>
            </div>
          </dl>
          <Link className="ui-button ui-button-ghost patients-open" href={patientsHref(query, { ac: row.id })}>
            {row.candidate ? "Aday kartını aç →" : "Hasta kartını aç →"}
          </Link>
        </li>
      ))}
    </ul>
  );
}
