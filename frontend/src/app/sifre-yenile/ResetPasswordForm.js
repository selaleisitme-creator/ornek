"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authMessage } from "@/lib/authMessages";
import OtpInput from "@/components/OtpInput";
import PasswordInput from "@/components/PasswordInput";

const MIN_LENGTH = 10;

// Reached from the reset e-mail. If the account already uses an authenticator, Supabase only
// allows the password change after the code is entered, so the code step comes first.
export default function ResetPasswordForm() {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [step, setStep] = useState("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState(null);
  const [otp, setOtp] = useState("");
  const [otpInvalid, setOtpInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return setStep("invalid");

      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (level?.nextLevel === "aal2" && level.currentLevel !== "aal2") {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        setFactorId(factors.totp[0].id);
        return setStep("code");
      }
      setStep("password");
    })();
  }, [supabase]);

  async function run(task) {
    setBusy(true);
    try {
      await task();
    } catch {
      setMessage("Bağlantı sorunu oluştu. İnternetinizi kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  function verifyCode(code = otp) {
    if (code.length < 6) return setMessage("6 haneli kodun tamamını girin.");
    run(async () => {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) {
        setOtp("");
        setOtpInvalid(true);
        return setMessage(authMessage(error));
      }
      setMessage("");
      setStep("password");
    });
  }

  function submitPassword(event) {
    event.preventDefault();
    if (password.length < MIN_LENGTH) return setMessage(`Şifre en az ${MIN_LENGTH} karakter olmalı.`);
    if (password !== repeat) return setMessage("İki şifre birbiriyle aynı değil.");
    run(async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return setMessage(authMessage(error));
      setStep("done");
      // The login page picks up the session and continues with setup or the panel as needed.
      setTimeout(() => router.replace("/giris"), 1200);
    });
  }

  const alert = <p className="message" role="alert" aria-live="polite">{message}</p>;

  if (step === "loading") return <p className="intro" aria-live="polite">Yükleniyor…</p>;

  if (step === "invalid") {
    return (
      <div>
        <p className="auth-eyebrow">Şifre sıfırlama</p>
        <h1>Bağlantı geçersiz</h1>
        <p className="intro">Bağlantının süresi dolmuş ya da daha önce kullanılmış. Giriş sayfasından yeniden şifre sıfırlama isteyin.</p>
        <a className="auth-btn auth-btn-link" href="/giris">Giriş sayfasına dön</a>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); verifyCode(); }} noValidate>
        <p className="auth-eyebrow">Şifre sıfırlama · Güvenlik kontrolü</p>
        <h1>Doğrulama kodu</h1>
        <p className="intro">Yeni şifre belirlemeden önce telefonunuzdaki <b>Authenticator</b> uygulamasındaki 6 haneli kodu girin.</p>
        <OtpInput value={otp} onChange={(v) => { setOtp(v); setOtpInvalid(false); }} onComplete={verifyCode} invalid={otpInvalid} disabled={busy} />
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? "Doğrulanıyor…" : "Doğrula"}</button>
        {alert}
      </form>
    );
  }

  if (step === "password") {
    return (
      <form onSubmit={submitPassword} noValidate>
        <p className="auth-eyebrow">Şifre sıfırlama</p>
        <h1>Yeni şifre belirleyin</h1>
        <p className="intro">En az {MIN_LENGTH} karakter kullanın. Başka sitelerde kullandığınız bir şifreyi seçmeyin.</p>
        <div className="field">
          <label htmlFor="newPw">Yeni şifre</label>
          <PasswordInput id="newPw" value={password} onChange={setPassword} autoComplete="new-password" />
        </div>
        <div className="field">
          <label htmlFor="repeatPw">Yeni şifre (tekrar)</label>
          <PasswordInput id="repeatPw" value={repeat} onChange={setRepeat} autoComplete="new-password" />
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? "Kaydediliyor…" : "Şifreyi kaydet"}</button>
        {alert}
      </form>
    );
  }

  return (
    <div className="auth-done">
      <div className="done-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </div>
      <h1>Şifreniz güncellendi</h1>
      <p className="intro">Yönlendiriliyorsunuz…</p>
    </div>
  );
}
