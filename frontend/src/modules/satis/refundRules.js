// Pure rules for "İade al" and the sold-items list (docs/faz-2-satis-plani.md, section 3). The window runs them for
// instant feedback; the server runs them again; the database (create_refund, 016, and the refund trigger, 007) has the
// last word on the amount and on the device going back to the shelf.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function roundKurus(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// input: { amount, method, returnsDevice, reason, refundedOn }; item: { saleItemId, value, saleDate, isDevice, refunded }
export function buildRefundArgs(input, { item, today }) {
  if (!item) return { error: "İade edilecek ürünü seçin." };
  if (item.refunded) return { error: "Bu ürünün iadesi zaten yapılmış." };
  if (item.legacy) return { error: "Panel öncesi satış iade edilemez." };
  const amount = roundKurus(input?.amount);
  if (!(amount > 0)) return { error: "Geçerli bir iade tutarı girin." };
  if (amount > roundKurus(item.value)) return { error: "İade tutarı satış tutarından büyük olamaz." };
  if (!input?.method) return { error: "İade ödeme şeklini seçin." };
  const refundedOn = input?.refundedOn || today;
  if (!DATE_RE.test(refundedOn) || refundedOn > today) return { error: "İade tarihi bugünden sonra olamaz." };
  if (item.saleDate && refundedOn < item.saleDate) return { error: "İade tarihi satış tarihinden önce olamaz." };
  return {
    args: {
      saleItemId: item.saleItemId,
      amount,
      method: input.method,
      reason: String(input?.reason ?? "").trim().slice(0, 500) || null,
      returnsDevice: item.isDevice || item.serial ? input?.returnsDevice !== false : false,
      refundedOn,
    },
  };
}

// What to tell the person after the refund, by how the money goes back (the design's "POS cihazından ... iade edin").
export function refundGuidance(method, amountText) {
  if (method === "card_pos" || method === "installment") return `POS cihazından ${amountText} iade edin.`;
  if (method === "paynet") return `Paynet üzerinden ${amountText} iade edin.`;
  if (method === "transfer") return `${amountText} tutarı hastanın hesabına havale / EFT ile gönderin.`;
  return `${amountText} tutarı hastaya geri verin.`;
}

// Post-sale information the sold-items list still lacks for a hearing aid or receiver: ÜTS number, production date,
// WSA code. Other goods have none to fill in.
export function missingInfo(item) {
  if (!item?.isDevice) return [];
  return [!item.utsNo && "ÜTS no", !item.productionDate && "ÜRT tarihi", !item.wsaCode && "WSA kodu"].filter(Boolean);
}

// "Satış sonrası bilgiler" → the values to write, or the problem. productionDate cannot be after the sale.
export function buildSoldInfo(input, { item }) {
  const productionDate = String(input?.productionDate ?? "").trim() || null;
  if (productionDate && (!DATE_RE.test(productionDate) || (item?.saleDate && productionDate > item.saleDate))) {
    return { error: "ÜRT tarihi satış tarihinden sonra olamaz." };
  }
  return {
    unit: { production_date: productionDate, wsa_code: String(input?.wsaCode ?? "").trim().slice(0, 60) || null },
    utsNo: String(input?.utsNo ?? "").trim().slice(0, 60),
  };
}

// The sold-items search: every word must appear in the product, serial, buyer or sale number.
export function matchesSoldSearch(item, text) {
  const words = String(text ?? "").toLocaleLowerCase("tr-TR").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [item.product, item.serial, item.buyer, item.saleNo].filter(Boolean).join(" ").toLocaleLowerCase("tr-TR");
  return words.every((word) => haystack.includes(word));
}
