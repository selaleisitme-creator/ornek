import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { formatDate } from "@/lib/dates";

// The design's status cell: a badge, one line of explanation, and for the 45-day adaptation a progress bar.
// statusText is statusLabel(status) from patientRules; adaptation is adaptationInfo(...) or null.
export default function PatientStatus({ status, statusText, adaptation }) {
  let note = statusText.note ?? null;
  if (status === "adaptation" && adaptation) {
    note =
      adaptation.state === "waiting"
        ? `Başlangıç: ${formatDate(adaptation.start)}`
        : `${adaptation.daysLeft} gün kaldı · Bitiş: ${formatDate(adaptation.end)}`;
  }

  return (
    <div className="patients-status">
      <StatusBadge tone={statusText.tone}>{statusText.label}</StatusBadge>
      {note && <small>{note}</small>}
      {status === "adaptation" && adaptation?.state === "active" && (
        <span
          className="patients-progress"
          role="progressbar"
          aria-label="Adaptasyon ilerlemesi"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={adaptation.progress}
        >
          <span style={{ width: `${adaptation.progress}%` }} />
        </span>
      )}
    </div>
  );
}
