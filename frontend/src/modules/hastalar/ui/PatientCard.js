import Link from "next/link";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { earSideLabel, initials } from "../patientRules";
import PatientStatus from "./PatientStatus";
import { NewSaleButton, PaymentButton, SaleFollowupButton } from "@/modules/satis/ui/SaleButtons";
import DeviceEditButton from "./DeviceEditButton";
import {
  EditPatientButton,
  NationalIdValue,
  NoteButton,
  PromoteButton,
  RemovePatientButton,
  WhatsAppButton,
} from "./PatientCardControls";

// The patient card (?ac=<id>): header with the actions, contact details, devices and follow-up, device
// history, sales history and notes. Candidates (from appointments) get a shorter card and "Hastaya dönüştür".
export default function PatientCard({ card, backHref }) {
  // What the buttons need, so the client components do not receive the whole card (sales, notes, history).
  const person = {
    id: card.id,
    name: card.name,
    phone: card.phone,
    birthDate: card.birthDate,
    address: card.address,
    referralSourceId: card.referralSourceId,
    referralSources: card.referralSources,
    whatsappConsent: card.whatsappConsent,
    nationalId: card.nationalId,
    adaptationStartManual: card.adaptationStartManual,
  };

  return (
    <article className="patients-profile">
      <Link className="patients-back" href={backHref} scroll={false}>
        <span aria-hidden="true">←</span> Hasta listesine dön
      </Link>

      <header className="patients-profile-head">
        <span className="patients-avatar patients-avatar-lg" aria-hidden="true">
          {initials(card.name)}
        </span>
        <div className="patients-profile-title">
          <h1>{card.name}</h1>
          <p>
            {card.patientNo} · Kayıt tarihi: {formatDate(card.registeredOn)}
          </p>
          <StatusBadge tone={card.statusText.tone}>{card.statusText.label}</StatusBadge>
        </div>
        <div className="patients-profile-actions">
          <NewSaleButton patient={{ id: card.id, name: card.name }} />
          <WhatsAppButton patient={person} />
          {card.candidate && <PromoteButton patient={person} />}
          <EditPatientButton patient={person} />
          <NoteButton patient={person} />
        </div>
      </header>

      <dl className="patients-info">
        <Info label="Telefon">{card.phoneText}</Info>
        <Info label="Doğum tarihi">{formatDate(card.birthDate)}</Info>
        <Info label="Adres" wide>
          {card.address ?? "—"}
        </Info>
        <Info label="TC kimlik no">
          <NationalIdValue patient={person} />
        </Info>
        <Info label="Bizi nereden duydu?">{card.referralSourceName ?? "—"}</Info>
        <Info label="WhatsApp izni">{card.whatsappConsent ? "Var" : "Yok"}</Info>
        <Info label="Son iletişim">{formatDateTime(card.lastContact)}</Info>
        <Info label="Son randevu">{formatDateTime(card.lastAppointment)}</Info>
        <Info label="Sonraki randevu">{formatDateTime(card.nextAppointment)}</Info>
      </dl>

      {!card.candidate && <DeviceSection card={card} person={person} />}
      {!card.candidate && <SalesSection sales={card.sales} patientId={card.id} />}
      <NotesSection card={card} person={person} />

      <div className="patients-profile-foot">
        <RemovePatientButton patient={person} />
      </div>
    </article>
  );
}

function Info({ label, wide, children }) {
  return (
    <div className={`patients-info-box${wide ? " wide" : ""}`}>
      <dt>{label}</dt>
      <dd>{children || "—"}</dd>
    </div>
  );
}

function SectionHead({ title, description, children }) {
  return (
    <div className="patients-section-head">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}

function DeviceSection({ card, person }) {
  const { devices } = card;
  const adaptation = devices.adaptation;
  let adaptationText = "—";
  if (adaptation) {
    adaptationText =
      adaptation.state === "active"
        ? `${formatDate(adaptation.start)} → ${formatDate(adaptation.end)} · ${adaptation.daysLeft} gün kaldı`
        : adaptation.state === "waiting"
          ? `${formatDate(adaptation.start)} tarihinde başlayacak`
          : `${formatDate(adaptation.end)} tarihinde tamamlandı`;
  }

  return (
    <section className="patients-section" aria-labelledby="patients-devices">
      <SectionHead
        title={<span id="patients-devices">Cihaz ve takip bilgileri</span>}
        description="Cihazlar satış kaydından gelir; adaptasyon cihaz satış tarihinden itibaren 45 gündür."
      >
        <DeviceEditButton
          patient={{ id: person.id, name: person.name, candidate: card.candidate, adaptationStartManual: card.adaptationStartManual }}
          devices={card.currentDevices}
          statusText={card.statusText}
        />
      </SectionHead>

      <div className="patients-current">
        <div>
          <span className="patients-current-kicker">ŞU ANDA KULLANILAN CİHAZ</span>
          <strong>{devices.names ?? "Henüz cihaz satışı yok"}</strong>
        </div>
        <PatientStatus status={card.status} statusText={card.statusText} adaptation={adaptation} />
      </div>

      <dl className="patients-info patients-info-4">
        <Info label="Sağ kulak">{devices.right}</Info>
        <Info label="Sol kulak">{devices.left}</Info>
        <Info label="Garanti bitişi">{formatDate(devices.warrantyEnd)}</Info>
        <Info label="Adaptasyon">
          {adaptationText}
          {card.adaptationStartManual && <small className="patients-muted"> (elle girildi)</small>}
        </Info>
      </dl>

      <h3 className="patients-subhead">Cihaz değişim geçmişi</h3>
      {card.deviceHistory.length ? (
        <ul className="patients-history">
          {card.deviceHistory.map((row) => (
            <li key={row.key}>
              <div>
                <b>{row.name ?? "Cihaz bilgisi eksik"}</b>
                <small>
                  {[
                    row.serial && `Seri: ${row.serial}`,
                    row.previousSerial && `Önceki seri: ${row.previousSerial}`,
                    earSideLabel(row.earSide),
                    formatDate(row.date),
                    row.reason,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
              <StatusBadge tone={row.state === "active" ? "ok" : row.state === "returned" ? "danger" : "neutral"}>
                {row.state === "active" ? "Kullanımda" : row.state === "returned" ? "İade edildi" : "Değiştirildi"}
              </StatusBadge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="patients-empty-small">Henüz cihaz kaydı yok. Cihaz satışları burada tarih ve seri numarasıyla görünür.</p>
      )}
    </section>
  );
}

function SalesSection({ sales, patientId }) {
  return (
    <section className="patients-section" aria-labelledby="patients-sales">
      <SectionHead title={<span id="patients-sales">Hasta geçmişi</span>} description="Bu hastaya kaydedilen ürün ve hizmetler. Önceki satışlar silinmeden kalır.">
        <span className="patients-pill">{sales.length} işlem</span>
      </SectionHead>

      {sales.length ? (
        <ul className="patients-sales">
          {sales.map((sale) => (
            <li key={sale.id} className="patients-sale">
              <div className="patients-sale-line">
                <b>
                  {formatDate(sale.date)} · {sale.saleNo}
                  {sale.legacy && <span className="patients-muted"> · Panel öncesi satış</span>}
                </b>
                <span className="patients-sale-total">{formatMoney(sale.total)}</span>
              </div>
              <ul className="patients-sale-items">
                {sale.items.map((item) => (
                  <li key={item.id}>
                    <span>
                      <b>{item.name}</b>
                      <small>
                        {[
                          item.kind,
                          `${item.quantity} adet`,
                          item.serial && `Seri: ${item.serial}`,
                          earSideLabel(item.earSide),
                          item.refunded && "İade edildi",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    <span className="patients-money">{formatMoney(item.value)}</span>
                  </li>
                ))}
              </ul>
              {sale.payments.length > 0 && (
                <p className="patients-sale-payment">
                  Ödeme: {sale.payments.map((payment) => `${payment.method} ${formatMoney(payment.amount)}`).join(" + ")}
                </p>
              )}
              {!sale.legacy && (
                <div className="sale-history-actions">
                  <SaleFollowupButton saleId={sale.id} patientId={patientId} />
                  <PaymentButton saleId={sale.id} patientId={patientId} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="patients-empty-small">Henüz bu hastaya bağlı satış kaydı yok.</p>
      )}
    </section>
  );
}

function NotesSection({ card, person }) {
  return (
    <section className="patients-section" aria-labelledby="patients-notes">
      <SectionHead title={<span id="patients-notes">Hasta notları</span>} description="Kontrol, bakım ve görüşme notları">
        <NoteButton patient={person} />
      </SectionHead>
      {card.notes.length ? (
        <ul className="patients-notes">
          {card.notes.map((note) => (
            <li key={note.id}>
              <div className="patients-note-head">
                <b>{note.title}</b>
                <span>{formatDate(note.notedOn)}</span>
              </div>
              <p>{note.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="patients-empty-small">Henüz not eklenmedi.</p>
      )}
    </section>
  );
}
