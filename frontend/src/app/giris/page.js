import AuthShell from "@/components/AuthShell";
import LoginFlow from "./LoginFlow";

export const metadata = { title: "Giriş Yap | Şelale İşitme" };

export default function LoginPage() {
  return (
    <AuthShell>
      <LoginFlow />
    </AuthShell>
  );
}
