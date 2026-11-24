// Database rules raise English messages (they are written for developers and logs). This turns the ones a
// person can run into while using the panel into Turkish sentences. Anything unknown gets a safe generic
// message; the original is only logged on the server, never shown, so table names do not leak.

const KNOWN = [
  // remove_stock_units (010); listed before the general "not in stock" sentence below.
  [/not in stock; nothing was removed/i, "Seçilen birimlerden bazıları artık stokta değil; hiçbiri silinmedi. Sayfayı yenileyin."],
  [/no units to remove/i, "Silinecek birimleri seçin."],
  [/Unknown removal reason/i, "Silme nedenini seçin."],
  [/products_pack_needs_size/i, "Paket içindeki pil adedini girin."],
  [/is not in stock|must be in stock/i, "Bu cihaz stokta değil. Satılmış, serviste ya da çıkarılmış olabilir."],
  [/not the device currently in use/i, "Bu cihaz hastanın şu an kullandığı cihaz değil."],
  [/cannot be replaced/i, "Bu cihaz iade edildiği için değiştirilemez."],
  [/is not with the patient/i, "Cihaz hastada görünmüyor, stoğa geri alınamaz."],
  [/Refund .* is more than/i, "İade tutarı ürünün satış tutarından fazla olamaz."],
  [/would exceed the patient's share/i, "Bu ödeme hastanın kalan borcundan fazla."],
  [/would exceed the expected SGK amount/i, "Bu ödeme SGK'dan beklenen tutardan fazla."],
  [/legacy sale .* takes no payments/i, "Panelden önceki bir satışa ödeme girilemez."],
  [/between 1 and 500 units/i, "Bir stok girişinde 1 ile 500 arasında birim olmalı."],
  [/purchase needs a payment method/i, "Alış için ödeme şeklini seçin."],
  [/purchase needs an amount above zero/i, "Alış tutarı sıfırdan büyük olmalı."],
  [/amount cannot be negative/i, "Tutar eksi olamaz."],
  [/Product .* not found or inactive/i, "Bu model bulunamadı ya da pasif."],
  [/stock_units_serial_no_key/i, "Bu seri numarası başka bir kayıtta var."],
  [/products_gtin_key/i, "Bu GTIN başka bir modelde kayıtlı."],
  [/brands_name_key/i, "Bu marka zaten kayıtlı."],
  [/needs a serial number/i,"Bu ürün için seri numarası zorunlu."],
  [/tracked without a serial number/i, "Bu ürün seri numarasız takip ediliyor; seri numarası girmeyin."],
  // update_prices_bulk (010) and undo_price_batch (008).
  [/no products to update/i, "Fiyatı değişecek modelleri seçin."],
  [/Unknown price mode/i, "Fiyat seçeneği geçersiz. Sayfayı yenileyip tekrar deneyin."],
  // update_prices_bulk p_field (012).
  [/Unknown price field/i, "Perakende ya da toptan fiyatı seçin. Sayfayı yenileyip tekrar deneyin."],
  // create_sale, update_sale_followup, create_refund (016).
  [/needs between 1 and 200 items/i, "Bir satışta 1 ile 200 arasında kalem olabilir."],
  [/Unknown invoice mode/i, "Fatura düzenini seçin."],
  [/wholesale sale needs the customer name/i, "Toptan satışta alıcının adını yazın."],
  [/wholesale sale is not made to a patient/i, "Toptan satış hastaya yapılmaz."],
  [/wholesale sale takes no SGK/i, "Toptan satışta SGK tutarı olmaz."],
  [/wholesale sale takes products only/i, "Toptan satışta yalnızca ürün satılır."],
  [/Unknown tax rate/i, "KDV oranı %0, %10 ya da %20 olmalı."],
  [/needs a price of zero or more/i, "Her kalem için fiyat girin."],
  [/not enough stock of product/i, "Stokta yeterli ürün yok; sayfayı yenileyip adedi kontrol edin."],
  [/typed-in service needs a name/i, "Elle eklenen servisin adını yazın."],
  [/needs a unit, a product, or a service/i, "Sepetteki bir kalem tanınmadı; sayfayı yenileyin."],
  [/hearing aid is sold with VAT 0/i, "İşitme cihazı %0 KDV ile satılır."],
  [/discount cannot be more than the total/i, "İndirim toplamdan büyük olamaz."],
  [/SGK amount cannot be more than/i, "SGK tutarı satış toplamından büyük olamaz."],
  [/payment date cannot be in the future/i, "Ödeme tarihi bugünden sonra olamaz."],
  [/is not part of sale/i, "Kalem bu satışa ait değil; sayfayı yenileyin."],
  [/cannot be refunded/i, "Panel öncesi satış iade edilemez."],
  [/refund date cannot be in the future/i, "İade tarihi bugünden sonra olamaz."],
  [/refund cannot be dated before the sale/i, "İade tarihi satış tarihinden önce olamaz."],
  [/is more than the item value/i, "İade tutarı kalemin değerinden büyük olamaz."],
  [/invoices_invoice_no_key/i, "Bu fatura numarası başka bir satışta kullanılmış."],
  // add_legacy_device and replace_device (015).
  [/candidate cannot get a device/i, "Aday kayda cihaz eklenemez; önce hastaya dönüştürün."],
  [/legacy device needs its sale date/i, "Satış tarihini girin."],
  [/sale date cannot be in the future/i, "Satış tarihi bugünden sonra olamaz."],
  [/legacy device needs a serial number/i, "Seri numarasını girin."],
  [/warranty cannot end before/i, "Garanti bitişi garanti başlangıcından önce olamaz."],
  [/must be a hearing aid model/i, "Geçmiş cihaz yalnızca bir işitme cihazı modeli olabilir."],
  [/Unknown replacement reason/i, "Değişim nedenini seçin."],
  [/replacement date cannot be in the future/i, "Değişim tarihi bugünden sonra olamaz."],
  [/cannot be dated before the sale/i, "Değişim tarihi satış tarihinden önce olamaz."],
  [/same group as the old one/i, "Yeni cihaz eskisiyle aynı ürün grubundan olmalı."],
  [/from the manufacturer needs a serial number/i, "Yeni cihazın seri numarasını girin."],
  [/must be in stock to be handed out/i, "Yeni cihaz stokta değil; başka bir cihaz seçin."],
  [/not the device currently in use/i, "Bu cihaz hastanın şu an kullandığı cihaz değil; sayfayı yenileyin."],
  [/was returned; it cannot be replaced/i, "İade edilmiş cihaz değiştirilemez."],
  [/sale_items_warranty_order/i, "Garanti bitişi garanti başlangıcından önce olamaz."],
  [/has no wholesale price/i, "Seçilen modellerden birinin toptan fiyatı yok. Önce \"Yeni fiyat\" ile ya da model düzenleyerek girin."],
  [/price change needs a value/i, "Fiyat değişikliği için bir değer yazın."],
  [/can only be rounded to/i, "Yuvarlama yalnızca kuruş, tam TL, 10 TL ya da 100 TL olabilir."],
  [/Some products were not found/i, "Seçilen modellerden bazıları bulunamadı; sayfayı yenileyin."],
  [/would be zero or less/i, "Bazı modellerin yeni fiyatı sıfır ya da eksi oluyor; hiçbir fiyat değiştirilmedi."],
  [/Price batch .* not found/i, "Bu fiyat güncellemesi bulunamadı; sayfayı yenileyin."],
  [/changed again later/i,"Bu fiyatlar sonradan yeniden değişmiş. Önce yeni değişikliği geri alın."],
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
