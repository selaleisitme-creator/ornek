import { Suspense } from "react";
import { getStaffProfile } from "@/lib/auth";
import Skeleton from "@/modules/shared/ui/Skeleton";
import { getSettings } from "../server/settingsRepository";
import { getAccountInfo } from "../server/accountService";
import AccountCard from "./AccountCard";
import UsersCard from "./UsersCard";
import { listUsers } from "../server/usersService";
import GeneralSettingsForm from "./GeneralSettingsForm";
import SecuritySettingsForm from "./SecuritySettingsForm";
import WebBookingCard from "./WebBookingCard";
import WhatsAppCard from "./WhatsAppCard";
import BackupCard from "./BackupCard";
import { getBackupView } from "../server/backupService";
import { getRequestSummary } from "@/modules/randevular/server/appointmentRequestsRepository";
import "./settings.css";

// Ayarlar. Every staff member sees the general settings; admin-only cards are not rendered for others
// (their actions check the role again, and the database once more).
// The heading shows at once; the cards stream in behind <Suspense> once their data is read, so the page
// never waits blank (Next.js "uncached data outside Suspense", same fix as Anasayfa).
export default function SettingsPage() {
  return (
    <section className="settings-page">
      <header className="settings-head">
        <p className="ui-eyebrow">Şelale İşitme · Yönetim</p>
        <h1>Ayarlar</h1>
        <p>Klinik tercihleri, hesabınız ve yedekler.</p>
      </header>
      <Suspense fallback={<SettingsLoading />}>
        <SettingsContent />
      </Suspense>
    </section>
  );
}

async function SettingsContent() {
  const staff = await getStaffProfile();
  const [settings, account, users, booking, backup] = await Promise.all([
    getSettings(),
    getAccountInfo(),
    staff?.isAdmin ? listUsers() : null,
    getRequestSummary(),
    getBackupView(),
  ]);

  return (
    <>
      {/* Two independent columns instead of grid rows: in a grid, Güvenlik had to wait below the tall
          Hesabım card and left an empty gap under Genel. On narrow screens the columns stack. */}
      <div className="settings-grid">
        <div className="settings-column">
          <GeneralSettingsForm settings={settings} />
          {staff?.isAdmin && <SecuritySettingsForm idleLogoutMinutes={settings.idle_logout_minutes} />}
          <WebBookingCard pendingCount={booking.pendingCount} lastRequestAt={booking.lastRequestAt} />
        </div>
        <div className="settings-column">
          <AccountCard email={account.email} role={staff?.role} twoFactorActive={account.twoFactorActive} />
          <WhatsAppCard whatsappNumber={settings.whatsapp_number} />
        </div>
      </div>

      <BackupCard backup={backup} isAdmin={Boolean(staff?.isAdmin)} />

      {staff?.isAdmin && <UsersCard users={users} currentUserId={staff.userId} />}
    </>
  );
}

function SettingsLoading() {
  return (
    <div className="settings-grid" aria-busy="true">
      <div className="settings-card">
        <Skeleton rows={5} label="Ayarlar yükleniyor…" />
      </div>
      <div className="settings-card">
        <Skeleton rows={5} label="Hesap bilgileri yükleniyor…" />
      </div>
    </div>
  );
}
