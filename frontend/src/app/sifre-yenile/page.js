import AuthShell from "@/components/AuthShell";
import ResetPasswordForm from "./ResetPasswordForm";

export const metadata = { title: "Yeni Şifre | Şelale İşitme" };

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <ResetPasswordForm />
    </AuthShell>
  );
}
