// Pure rules for selling (docs/faz-2-satis-plani.md): the cart, its totals, payments and the create_sale arguments.
// The wizard runs them for instant feedback; the server runs them again before it writes. Prices include VAT
// (Şelale Hanım, 2026-11-24): VAT is taken out of the price for display, never added on top.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const SALE_GROUPS = [
  { key: "device", label: "İşitme cihazı", category: "device", serial: true },
  { key: "receiver", label: "Receiver", category: "receiver", serial: true },
  { key: "charger", label: "Şarj", category: "charger", serial: true },
  { key: "battery", label: "Pil", category: "battery", serial: false },
  { key: "dome", label: "Dome / kalıp", category: "dome", serial: false },
  { key: "service", label: "Servis", category: null, serial: false },
];

// Hearing aids are sold with VAT 0; other goods and services with 10 or 20 (20 suggested).
export const TAX_RATES = [0, 10, 20];

export function defaultTaxRate(category) {
  return category === "device" ? 0 : 20;
}

export function taxLocked(category) {
  return category === "device";
}

// Groups whose units go to an ear and get a post-sale ÜTS number and warranty.
export function isEarDevice(category) {
  return category === "device" || category === "receiver";
}

export const POST_SALE_SITES = [
  { key: "uts", label: "ÜTS", hint: "Cihaz başına bildirim no" },
  { key: "wsa", label: "WSA", hint: "Garanti başlangıç ve bitiş" },
  { key: "kolaysoft", label: "Kolaysoft", hint: "Fatura no" },
  { key: "medical_center", label: "Medikal Merkez", hint: "Paynet ve diğer işlemler" },
];

// Wholesale: invoice first, then ÜTS (Şelale Hanım, 2026-11-24); no WSA or Medikal Merkez.
export function sitesFor(kind) {
  return kind === "wholesale" ? POST_SALE_SITES.filter((site) => site.key === "kolaysoft" || site.key === "uts").reverse() : POST_SALE_SITES;
}

function roundKurus(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isDate(value) {
  return DATE_RE.test(value ?? "") && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// A cart line: { key, type: "unit" | "product" | "service" | "custom", unitId, productId, serviceId, name, serial,
// category, quantity, maxQuantity, unitPrice, taxRate, earSide, moldType, serviceNote, warrantyMonths }.
export function lineGross(line) {
  return roundKurus(Number(line.unitPrice) * (line.type === "unit" ? 1 : Number(line.quantity) || 0));
}

// Totals exactly as sale_item_values (016) works them out: the discount is shared by line value and rounded to the
// kuruş, the last line takes the rounding difference; the VAT is the part of each line's value at its rate.
export function cartTotals(lines, discount = 0) {
  const gross = roundKurus(lines.reduce((sum, line) => sum + lineGross(line), 0));
  const off = Math.min(roundKurus(discount), gross);
  let shared = 0;
  let vat = 0;
  lines.forEach((line, index) => {
    const lineValue = lineGross(line);
    const share = index === lines.length - 1 ? roundKurus(off - shared) : gross ? roundKurus((off * lineValue) / gross) : 0;
    shared = roundKurus(shared + share);
    const rate = Number(line.taxRate) || 0;
    vat += roundKurus(((lineValue - share) * rate) / (100 + rate));
  });
  return { gross, discount: off, total: roundKurus(gross - off), vat: roundKurus(vat) };
}

// What is still owed by the patient once the SGK share and the payments are taken off.
export function paymentSummary(total, sgkAmount, payments) {
  const sgk = roundKurus(sgkAmount);
  const patientShare = roundKurus(total - sgk);
  const paid = roundKurus((payments ?? []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
  return { sgk, patientShare, paid, remaining: roundKurus(patientShare - paid) };
}

export function warrantyEndFor(saleDate, months) {
  if (!isDate(saleDate) || !(Number(months) > 0)) return "";
  const [year, month, day] = saleDate.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1 + Number(months), day));
  return end.toISOString().slice(0, 10);
}

function lineError(line) {
  const name = line.name ?? "Kalem";
  if (!(Number(line.unitPrice) >= 0) || line.unitPrice === null || line.unitPrice === "") return `${name}: fiyat girin.`;
  if (!TAX_RATES.includes(Number(line.taxRate))) return `${name}: KDV oranını seçin.`;
  if (taxLocked(line.category) && Number(line.taxRate) !== 0) return `${name}: işitme cihazı %0 KDV ile satılır.`;
  if (line.type !== "unit") {
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return `${name}: adet en az 1 olmalı.`;
    if (line.maxQuantity !== undefined && line.maxQuantity !== null && quantity > line.maxQuantity) {
      return `${name}: stokta ${line.maxQuantity} adet var.`;
    }
  }
  if (line.type === "custom" && !String(line.name ?? "").trim()) return "Elle eklenen servisin adını yazın.";
  return null;
}

// The wizard's input → create_sale arguments, or the first problem in Turkish.
//   input: { kind: "retail" | "wholesale", patientId, customerName, customerPhone, saleDate, discount, sgkAmount,
//            invoiceMode, invoiceNo, lines, payments: [{ method, amount, installments }], sites: { uts: true, ... } }
export function buildSaleArgs(input, { today }) {
  const wholesale = input?.kind === "wholesale";
  const lines = input?.lines ?? [];
  if (!lines.length) return { error: "Sepete en az bir ürün ya da hizmet ekleyin." };
  if (lines.length > 200) return { error: "Bir satışta en fazla 200 kalem olabilir." };
  if (wholesale && !String(input.customerName ?? "").trim()) return { error: "Toptan satışta alıcının adını yazın." };
  if (wholesale && lines.some((line) => line.type === "service" || line.type === "custom")) {
    return { error: "Toptan satışta yalnızca ürün satılır." };
  }
  const saleDate = input?.saleDate || today;
  if (!isDate(saleDate)) return { error: "Satış tarihini kontrol edin." };
  if (saleDate > today) return { error: "Satış tarihi bugünden sonra olamaz." };
  for (const line of lines) {
    const problem = lineError(line);
    if (problem) return { error: problem };
  }

  const totals = cartTotals(lines, input?.discount ?? 0);
  if (roundKurus(input?.discount) < 0 || roundKurus(input?.discount) > totals.gross) return { error: "İndirim toplamdan büyük olamaz." };
  const sgk = wholesale ? 0 : roundKurus(input?.sgkAmount);
  if (sgk < 0 || sgk > totals.total) return { error: "SGK tutarı satış toplamından büyük olamaz." };

  const payments = (input?.payments ?? []).filter((payment) => Number(payment.amount) > 0);
  for (const payment of payments) {
    if (!payment.method) return { error: "Her ödeme satırı için ödeme şeklini seçin." };
    if (payment.installments && !(Number.isInteger(Number(payment.installments)) && Number(payment.installments) > 1)) {
      return { error: "Taksit sayısı 2 ya da daha fazla olmalı." };
    }
  }
  const summary = paymentSummary(totals.total, sgk, payments);
  if (summary.remaining < 0) return { error: "Ödemeler hastanın payını aşıyor." };

  const invoiceMode = input?.invoiceMode === "per_item" ? "per_item" : "single";
  const sale = wholesale
    ? { kind: "wholesale", customer_name: String(input.customerName).trim(), customer_phone: input.customerPhone || null }
    : { patient_id: Number(input.patientId) };
  Object.assign(sale, {
    sale_date: saleDate,
    discount: totals.discount,
    sgk_amount: sgk > 0 ? sgk : null,
    invoice_mode: invoiceMode,
    invoice_no: invoiceMode === "single" ? String(input?.invoiceNo ?? "").trim() || null : null,
  });

  const items = lines.map((line) => {
    const common = { unit_price: roundKurus(line.unitPrice), tax_rate: Number(line.taxRate) };
    if (invoiceMode === "per_item" && String(line.invoiceNo ?? "").trim()) common.invoice_no = String(line.invoiceNo).trim();
    if (line.type === "unit") {
      return {
        ...common,
        stock_unit_id: line.unitId,
        ear_side: line.earSide || null,
        mold_type: line.moldType || null,
        uts_report_no: String(line.utsNo ?? "").trim() || null,
        warranty_end: line.warrantyEnd || null,
      };
    }
    if (line.type === "product") return { ...common, product_id: line.productId, quantity: Number(line.quantity), mold_type: line.moldType || null };
    if (line.type === "service") return { ...common, service_id: line.serviceId, quantity: Number(line.quantity), service_note: line.serviceNote || null };
    return { ...common, custom_service: { name: String(line.name).trim(), category: line.serviceCategory || "service" }, quantity: 1 };
  });

  return {
    args: {
      sale,
      items,
      payments: payments.map((payment) => ({
        payment_method: payment.method,
        amount: roundKurus(payment.amount),
        installments: payment.installments ? Number(payment.installments) : null,
      })),
      tasks: Object.entries(input?.sites ?? {}).filter(([, done]) => done).map(([key]) => key),
    },
    totals,
    summary,
  };
}

// "Tahsilat ekle": { payer: "patient" | "sgk", method, amount, installments, paidOn } → sale_payments row, or the problem.
//   due: { patient: remaining patient share, sgk: SGK still expected }
export function buildPaymentRow(input, { due, today }) {
  const payer = input?.payer === "sgk" ? "sgk" : "patient";
  const amount = roundKurus(input?.amount);
  if (!(amount > 0)) return { error: "Tutarı girin." };
  const limit = roundKurus(payer === "sgk" ? due?.sgk : due?.patient);
  if (amount > limit) return { error: payer === "sgk" ? "Tutar beklenen SGK ödemesini aşıyor." : "Tutar hastanın kalan borcunu aşıyor." };
  const method = payer === "sgk" ? input?.method || "transfer" : input?.method;
  if (!method) return { error: "Ödeme şeklini seçin." };
  const installments = input?.installments ? Number(input.installments) : null;
  if (installments !== null && !(Number.isInteger(installments) && installments > 1)) return { error: "Taksit sayısı 2 ya da daha fazla olmalı." };
  const paidOn = input?.paidOn || today;
  if (!isDate(paidOn) || paidOn > today) return { error: "Ödeme tarihi bugünden sonra olamaz." };
  return { row: { payer, payment_method: method, amount, installments, paid_on: paidOn } };
}
