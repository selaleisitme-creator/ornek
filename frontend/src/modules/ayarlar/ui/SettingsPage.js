import { getStaffProfile } from "@/lib/auth";
import { getSettings } from "../server/settingsRepository";
import GeneralSettingsForm from "./GeneralSettingsForm";
import SecuritySettingsForm from "./SecuritySettingsForm";
import "./settings.css";

// Ayarlar. Every staff member sees the general settings; admin-only cards are not rendered for others
// (their actions check the role again, and the database once more).
export default async function SettingsPage() {
  const staff = await getStaffProfile();
  const settings = await getSettings();

  return (
    <section className="settings-page">
      <header className="settings-head">
        <p className="ui-eyebrow">Şelale İşitme · Yönetim</p>
        <h1>Ayarlar</h1>
        <p>Klinik tercihleri, hesabınız{staff?.isAdmin ? " ve kullanıcılar" : ""}.</p>
      </header>

      <div className="settings-grid">
        <GeneralSettingsForm settings={settings} />
        {staff?.isAdmin && <SecuritySettingsForm idleLogoutMinutes={settings.idle_logout_minutes} />}
      </div>
    </section>
  );
}
