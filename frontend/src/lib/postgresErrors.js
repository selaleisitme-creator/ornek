// Database rules raise English messages (they are written for developers and logs). This turns the ones a
// person can run into while using the panel into Turkish sentences. Anything unknown gets a safe generic
// message; the original is only logged on the server, never shown, so table names do not leak.

const KNOWN = [
  [/is not in stock|must be in stock/i, "Bu cihaz stokta değil. Satılmış, serviste ya da çıkarılmış olabilir."],
  [/not the device currently in use/i, "Bu cihaz hastanın şu an kullandığı cihaz değil."],
  [/cannot be replaced/i, "Bu cihaz iade edildiği için değiştirilemez."],
  [/is not with the patient/i, "Cihaz hastada görünmüyor, stoğa geri alınamaz."],
  [/Refund .* is more than/i, "İade tutarı ürünün satış tutarından fazla olamaz."],
  [/would exceed the patient's share/i, "Bu ödeme hastanın kalan borcundan fazla."],
  [/would exceed the expected SGK amount/i, "Bu ödeme SGK'dan beklenen tutardan fazla."],
  [/legacy sale .* takes no payments/i, "Panelden önceki bir satışa ödeme girilemez."],
  [/needs a serial number/i, "Bu ürün için seri numarası zorunlu."],
  [/tracked without a serial number/i, "Bu ürün seri numarasız takip ediliyor; seri numarası girmeyin."],
  [/changed again later/i, "Bu fiyatlar sonradan yeniden değişmiş. Önce yeni değişikliği geri alın."],
  [/purchase price of a stock unit/i, "Alış fiyatını yalnızca yönetici düzeltebilir."],
  [/roles, access or permissions/i, "Rol ve izinleri yalnızca yönetici değiştirebilir."],
  [/auto sign-out time/i, "Otomatik çıkış süresini yalnızca yönetici değiştirebilir."],
  [/existing national ID/i, "Kayıtlı bir TC numarasını yalnızca TC izni olan değiştirebilir."],
  [/appointments_no_overlap|conflicting key value/i, "Bu saatte başka bir randevu var."],
  [/appointments_duration/i, "Randevu süresi 15 ile 90 dakika arasında olmalı."],
  [/sales_customer_only_without_patient/i, "Hasta seçiliyken ayrıca müşteri adı yazılamaz."],
  [/profiles_intern_limits/i, "Stajyere TC ya da muhasebe izni verilemez."],
];

const BY_CODE = {
  "23505": "Bu kayıt zaten var (aynı numara ya da ad ikinci kez girilemez).",
  "23503": "Bağlı olduğu kayıt bulunamadı ya da bu kayda bağlı başka kayıtlar var.",
  "23514": "Girilen değer kurallara uymuyor. Alanları kontrol edin.",
  "42501": "Bu işlem için yetkiniz yok.",
  PGRST301: "Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.",
};

// Accepts a Supabase error ({ code, message }) or a thrown Error.
export function toUserMessage(error) {
  if (!error) return null;
  const message = error.message ?? String(error);
  for (const [pattern, text] of KNOWN) {
    if (pattern.test(message)) return text;
  }
  return BY_CODE[error.code] ?? "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
}
