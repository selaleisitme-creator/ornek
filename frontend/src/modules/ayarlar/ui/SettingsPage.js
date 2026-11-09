import { getStaffProfile } from "@/lib/auth";
import { getSettings } from "../server/settingsRepository";
import { getAccountInfo } from "../server/accountService";
import AccountCard from "./AccountCard";
import UsersCard from "./UsersCard";
import { listUsers } from "../server/usersService";
import GeneralSettingsForm from "./GeneralSettingsForm";
import SecuritySettingsForm from "./SecuritySettingsForm";
import WebBookingCard from "./WebBookingCard";
import WhatsAppCard from "./WhatsAppCard";
import { getRequestSummary } from "@/modules/randevular/server/appointmentRequestsRepository";
import "./settings.css";

// Ayarlar. Every staff member sees the general settings; admin-only cards are not rendered for others
// (their actions check the role again, and the database once more).
export default async function SettingsPage() {
  const staff = await getStaffProfile();
  const [settings, account, users, booking] = await Promise.all([
    getSettings(),
    getAccountInfo(),
    staff?.isAdmin ? listUsers() : null,
    getRequestSummary(),
  ]);

  return (
    <section className="settings-page">
      <header className="settings-head">
        <p className="ui-eyebrow">Şelale İşitme · Yönetim</p>
        <h1>Ayarlar</h1>
        <p>Klinik tercihleri, hesabınız{staff?.isAdmin ? " ve kullanıcılar" : ""}.</p>
      </header>

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

      {staff?.isAdmin && <UsersCard users={users} currentUserId={staff.userId} />}
    </section>
  );
}
