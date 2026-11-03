// Supabase returns English error codes; staff should only ever see short Turkish sentences.
const MESSAGES = {
  invalid_credentials: "E-posta veya şifre hatalı.",
  email_not_confirmed: "E-posta adresiniz henüz onaylanmamış.",
  user_banned: "Bu hesap kullanıma kapatılmış.",
  over_request_rate_limit: "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.",
  over_email_send_rate_limit: "Çok fazla e-posta istendi. Birkaç dakika sonra tekrar deneyin.",
  mfa_verification_failed: "Kod hatalı. Uygulamadaki güncel kodu girin.",
  mfa_challenge_expired: "Kodun süresi doldu. Uygulamadaki yeni kodu girin.",
  same_password: "Yeni şifre eski şifrenizle aynı olamaz.",
  weak_password: "Şifre çok zayıf. En az 10 karakter kullanın; harf ve rakam karıştırın.",
  session_not_found: "Oturum süresi doldu. Yeniden giriş yapın.",
};

export function authMessage(error) {
  return MESSAGES[error?.code] ?? "Bir hata oluştu. Lütfen tekrar deneyin.";
}
