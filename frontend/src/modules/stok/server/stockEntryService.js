import "server-only";
import { todayInClinic } from "@/lib/dates";
import { buildStockEntryArgs } from "../stockRules";
import { getProduct } from "./catalogRepository";
import { createStockReceipt, findExistingSerials } from "./stockRepository";
import { ValidationError } from "./errors";

// "Stok ekle": checks the window's input and writes product, receipt and units in one database call.
// The rules themselves live in stockRules.js so the window shows the same messages before saving;
// this service is the authority because Server Actions can be called without the window.

async function existingProduct(id) {
  const productId = Number(id);
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new ValidationError("Model seçin.");
  const product = await getProduct(productId);
  if (!product?.active) throw new ValidationError("Bu model bulunamadı ya da pasif.");
  return product;
}

export async function createStockEntry(input) {
  const existing = input?.product?.id ? await existingProduct(input.product.id) : null;
  const built = buildStockEntryArgs(input, { existing, today: todayInClinic() });
  if (built.error) throw new ValidationError(built.error);

  // The unique index would refuse these too, but only this check can say which number is taken.
  const serials = built.args.units.map((unit) => unit.serial_no).filter(Boolean);
  const taken = await findExistingSerials(serials);
  if (taken.length) {
    const list = taken.slice(0, 3).join(", ") + (taken.length > 3 ? ` ve ${taken.length - 3} tane daha` : "");
    throw new ValidationError(`Bu seri numarası başka bir kayıtta var: ${list}.`);
  }

  const result = await createStockReceipt(built.args);
  return {
    productId: result.product_id,
    category: existing?.category ?? built.args.product.category,
    unitCount: result.unit_ids?.length ?? built.args.units.length,
  };
}
