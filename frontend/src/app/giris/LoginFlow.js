"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authMessage } from "@/lib/authMessages";
import OtpInput from "@/components/OtpInput";
import PasswordInput from "@/components/PasswordInput";

const MAX_ATTEMPTS = 5;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export default function LoginFlow() {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [step, setStep] = useState("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpInvalid, setOtpInvalid] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [factorId, setFactorId] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [codes, setCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const [resetEmail, setResetEmail] = useState("");

  // Kept only in memory so a backup-code login can sign in again without retyping the password.
  const credentials = useRef(null);

  function go(next, text = "") {
    setStep(next);
    setMessage(text);
    setOtp("");
    setOtpInvalid(false);
  }

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

  // Decides what comes after a correct password: the code screen, first-time setup, or the panel.
  async function continueAfterPassword() {
    const access = await fetch("/api/auth/access", { method: "POST" });
    if (!access.ok) {
      const { error } = await access.json().catch(() => ({}));
      await supabase.auth.signOut({ scope: "local" });
      return go("password", error ?? "Giriş yapılamadı.");
    }

    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level?.currentLevel === "aal2") return finish();

    if (level?.nextLevel === "aal2") {
      const { data } = await supabase.auth.mfa.listFactors();
      setFactorId(data.totp[0].id);
      setAttemptsLeft(MAX_ATTEMPTS);
      return go("code");
    }

    return startSetup();
  }

  async function startSetup(note = "") {
    // A half-finished earlier setup leaves an unverified factor behind; it would block a new one.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const factor of list?.all ?? []) {
      if (factor.factor_type === "totp" && factor.status === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Şelale Panel",
      issuer: "Selale Isitme",
    });
    if (error) return go("password", authMessage(error));

    setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    go("setup", note);
  }

  function finish() {
    credentials.current = null;
    go("done");
    router.replace("/panel");
    router.refresh();
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkInvalid = params.get("link") === "gecersiz";

    // An existing session (page refresh, or coming back from the reset link) skips the password step.
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        run(continueAfterPassword);
      } else {
        go("password", linkInvalid ? "Bağlantının süresi dolmuş ya da daha önce kullanılmış. Yeniden şifre sıfırlama isteyin." : "");
      }
    });
    // Runs once on mount; the helpers only use the stable supabase client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitPassword(event) {
    event.preventDefault();
    if (!EMAIL_PATTERN.test(email.trim()) || !password) {
      return setMessage("E-posta adresinizi ve şifrenizi girin.");
    }
    run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return setMessage(authMessage(error));
      credentials.current = { email: email.trim(), password };
      setPassword("");
      await continueAfterPassword();
    });
  }

  function verifyCode(code = otp) {
    if (code.length < 6) return setMessage("6 haneli kodun tamamını girin.");
    run(async () => {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (!error) return finish();

      const left = attemptsLeft - 1;
      setAttemptsLeft(left);
      setOtp("");
      setOtpInvalid(true);
      if (left > 0) {
        setMessage(`${authMessage(error)} Kalan deneme: ${left}`);
      } else {
        await supabase.auth.signOut({ scope: "local" });
        credentials.current = null;
        go("password", "Çok fazla hatalı deneme. Güvenlik için yeniden giriş yapın.");
      }
    });
  }

  async function createRecoveryCodes() {
    const response = await fetch("/api/auth/recovery-codes", { method: "POST" });
    if (!response.ok) {
      setCodes([]);
      return go("recovery", "Yedek kodlar oluşturulamadı. Tekrar deneyin.");
    }
    const { codes: fresh } = await response.json();
    setCodes(fresh);
    setSaved(false);
    go("recovery");
  }

  function verifySetup(code = otp) {
    if (code.length < 6) return setMessage("Uygulamadaki 6 haneli kodu girin.");
    run(async () => {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.id, code });
      if (error) {
        setOtp("");
        setOtpInvalid(true);
        return setMessage("Kod eşleşmedi. QR kodu doğru okuttuğunuzdan emin olun ve güncel kodu girin.");
      }
      await createRecoveryCodes();
    });
  }

  function submitBackup(event) {
    event.preventDefault();
    run(async () => {
      const response = await fetch("/api/auth/recovery-codes/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: backupCode }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return setMessage(result.error ?? "Kod doğrulanamadı.");

      setBackupCode("");
      // Removing the old authenticator ends every session, so sign in again before the new setup.
      if (credentials.current) {
        const { error } = await supabase.auth.signInWithPassword(credentials.current);
        if (!error) return startSetup("Yedek kod kabul edildi. Yeni telefonunuz için kurulumu tamamlayın.");
      }
      await supabase.auth.signOut({ scope: "local" });
      go("password", "Yedek kod kabul edildi. Şifrenizle tekrar giriş yapın; ardından yeni telefonunuzu kuracaksınız.");
    });
  }

  function backToPassword(event) {
    event.preventDefault();
    run(async () => {
      await supabase.auth.signOut({ scope: "local" });
      credentials.current = null;
      go("password");
    });
  }

  function submitForgot(event) {
    event.preventDefault();
    if (!EMAIL_PATTERN.test(resetEmail.trim())) return setMessage("Geçerli bir e-posta adresi girin.");
    run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      if (error?.code?.startsWith("over_")) return setMessage(authMessage(error));
      // Same answer whether or not the address exists, so the form cannot be used to discover accounts.
      setMessage("Adres kayıtlıysa birkaç dakika içinde bir sıfırlama bağlantısı gelecek. Gelen kutunuzu ve spam klasörünü kontrol edin.");
    });
  }

  function copyCodes() {
    navigator.clipboard?.writeText(codes.join("\n")).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function link(target) {
    return (event) => {
      event.preventDefault();
      go(target);
    };
  }

  const alert = <p className="message" role="alert" aria-live="polite">{message}</p>;

  if (step === "loading") {
    return <p className="intro" aria-live="polite">Yükleniyor…</p>;
  }

  if (step === "password") {
    return (
      <form onSubmit={submitPassword} noValidate>
        <p className="auth-eyebrow">Yönetim paneli</p>
        <h1>Hoş geldiniz</h1>
        <p className="intro">Devam etmek için hesabınızın e-posta adresini ve şifresini girin.</p>
        <div className="field">
          <label htmlFor="email">E-posta</label>
          <input id="email" type="email" autoComplete="username" placeholder="ornek@selaleisitme.com"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="pw">Şifre</label>
          <PasswordInput id="pw" value={password} onChange={setPassword} />
        </div>
        <div className="options auth-options">
          <a href="#" onClick={(e) => { e.preventDefault(); setResetEmail(email); go("forgot"); }}>Şifremi unuttum</a>
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? "Kontrol ediliyor…" : "Devam et"}</button>
        {alert}
      </form>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); verifyCode(); }} noValidate>
        <p className="auth-eyebrow">Adım 2 / 2 · İki adımlı doğrulama</p>
        <h1>Doğrulama kodu</h1>
        <p className="intro">Telefonunuzdaki <b>Authenticator</b> uygulamasını açın ve <b>Selale Isitme</b> satırındaki 6 haneli kodu girin.</p>
        <OtpInput value={otp} onChange={(v) => { setOtp(v); setOtpInvalid(false); }} onComplete={verifyCode} invalid={otpInvalid} disabled={busy} />
        <p className="auth-hint">Kod her 30 saniyede yenilenir. Süresi dolmak üzereyse bir sonrakini bekleyin.</p>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? "Doğrulanıyor…" : "Doğrula ve giriş yap"}</button>
        {alert}
        <div className="auth-links">
          <a href="#" onClick={link("backup")}>Telefonuma ulaşamıyorum</a>
          <a href="#" onClick={backToPassword}>← Geri</a>
        </div>
      </form>
    );
  }

  if (step === "backup") {
    return (
      <form onSubmit={submitBackup} noValidate>
        <p className="auth-eyebrow">İki adımlı doğrulama</p>
        <h1>Yedek kodla giriş</h1>
        <p className="intro">Kurulumda kaydettiğiniz yedek kodlardan birini girin. Her yedek kod yalnızca bir kez kullanılabilir.</p>
        <div className="field">
          <label htmlFor="backupCode">Yedek kod</label>
          <input id="backupCode" type="text" autoComplete="off" placeholder="XXXX-XXXX" maxLength={9} className="mono-input"
            value={backupCode} onChange={(e) => setBackupCode(e.target.value)} />
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? "Kontrol ediliyor…" : "Yedek kodla giriş yap"}</button>
        {alert}
        <p className="auth-hint">Yedek kodlarınız da yoksa başka bir yöneticiden iki adımlı doğrulamanızı sıfırlamasını isteyin.</p>
        <div className="auth-links"><a href="#" onClick={link("code")}>← Uygulama koduna dön</a></div>
      </form>
    );
  }

  if (step === "setup") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); verifySetup(); }} noValidate>
        <p className="auth-eyebrow">İlk giriş · Hesabınızı koruyun</p>
        <h1>İki adımlı doğrulamayı kurun</h1>
        <ol className="setup-steps">
          <li>Telefonunuza <b>Google Authenticator</b> ya da <b>Microsoft Authenticator</b> uygulamasını kurun.</li>
          <li>Uygulamada <b>+</b> → <b>QR kodu tara</b> seçin ve aşağıdaki kodu okutun.</li>
          <li>Uygulamada beliren 6 haneli kodu girin.</li>
        </ol>
        <div className="qr-row">
          {/* Supabase returns the QR as an SVG data URI; next/image adds nothing for that. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="qr" src={enrollment.qr} alt="Kurulum QR kodu" />
          <div className="qr-manual">
            <span>Okutamıyor musunuz? Bu anahtarı uygulamaya elle girin:</span>
            <code>{enrollment.secret.match(/.{1,4}/g).join(" ")}</code>
          </div>
        </div>
        <OtpInput value={otp} onChange={(v) => { setOtp(v); setOtpInvalid(false); }} onComplete={verifySetup} invalid={otpInvalid} disabled={busy} />
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? "Doğrulanıyor…" : "Kodu doğrula"}</button>
        {alert}
      </form>
    );
  }

  if (step === "recovery") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (saved) finish(); }} noValidate>
        <p className="auth-eyebrow">Son adım</p>
        <h1>Yedek kodlarınızı kaydedin</h1>
        <p className="intro">Telefonunuz kaybolursa bu kodlarla giriş yapabilirsiniz. Her kod bir kez kullanılır. <b>Bu kodlar bir daha gösterilmeyecek.</b></p>
        {codes.length > 0 ? (
          <>
            <ul className="recovery-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
            <div className="recovery-actions">
              <button className="btn-ghost" type="button" onClick={copyCodes}>{copied ? "Kopyalandı ✓" : "Kopyala"}</button>
              <button className="btn-ghost" type="button" onClick={() => window.print()}>Yazdır</button>
            </div>
            <label className="confirm">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Kodları güvenli bir yere kaydettim
            </label>
            <button className="auth-btn" type="submit" disabled={!saved}>Panele geç</button>
          </>
        ) : (
          <button className="auth-btn" type="button" disabled={busy} onClick={() => run(createRecoveryCodes)}>Tekrar dene</button>
        )}
        {alert}
      </form>
    );
  }

  if (step === "forgot") {
    return (
      <form onSubmit={submitForgot} noValidate>
        <p className="auth-eyebrow">Şifre sıfırlama</p>
        <h1>Şifrenizi mi unuttunuz?</h1>
        <p className="intro">Hesabınızın e-posta adresini yazın. Adres kayıtlıysa şifre sıfırlama bağlantısı gönderilir.</p>
        <div className="field">
          <label htmlFor="resetEmail">E-posta</label>
          <input id="resetEmail" type="email" autoComplete="email" placeholder="ornek@selaleisitme.com"
            value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}</button>
        <p className="message info" role="status" aria-live="polite">{message}</p>
        <div className="auth-links"><a href="#" onClick={link("password")}>← Girişe dön</a></div>
      </form>
    );
  }

  return (
    <div className="auth-done">
      <div className="done-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </div>
      <h1>Giriş başarılı</h1>
      <p className="intro">Panel açılıyor…</p>
    </div>
  );
}
