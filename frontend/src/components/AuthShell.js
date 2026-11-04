// Two-column frame shared by the login and password-reset pages: brand panel left, form card right.
export default function AuthShell({ children }) {
  return (
    <main className="shell">
      <section className="brand-side" role="img" aria-label="Şelale İşitme Cihazları — Güvenilir işitme çözümleri" />
      <section className="form-side">
        <div className="login auth-card">{children}</div>
      </section>
    </main>
  );
}
