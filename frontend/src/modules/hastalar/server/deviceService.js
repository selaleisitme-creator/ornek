import "server-only";
import { todayInClinic } from "@/lib/dates";
import * as patientsRepo from "./patientsRepository";
import * as repo from "./deviceRepository";
import { ValidationError } from "./errors";
import { buildFollowupUpdate, buildLegacyArgs, buildReplaceArgs, currentDevices, serialFromScan } from "../deviceRules";

// "Cihaz ve takip bilgileri" (docs/faz-2-cihaz-takip-plani.md). Every change is checked against the patient's own
// devices as the database has them now, so an item id sent from the browser can never reach another patient's sale.
// Callers must `await io()` first: "today" reads the clock.

async function findPatient(id) {
  const patientId = Number(id);
  if (!Number.isSafeInteger(patientId) || patientId < 1) throw new ValidationError("Geçersiz hasta kaydı.");
  const patient = await patientsRepo.getPatient(patientId);
  if (!patient) throw new ValidationError("Hasta kaydı bulunamadı; sayfayı yenileyin.");
  return patient;
}

// The hearing aids the patient has now (currentDevices), read fresh from the database.
export async function loadCurrentDevices(patientId) {
  const sales = await patientsRepo.listSales(patientId);
  const itemIds = sales.flatMap((sale) => sale.sale_items ?? []).map((item) => item.id);
  const replacements = await patientsRepo.listReplacements(itemIds);
  return currentDevices(sales, replacements);
}

// Adaptation start (on the patient) and, per device, its side and warranty end (on the sale item).
export async function updateFollowup(patientId, input) {
  const patient = await findPatient(patientId);
  const current = await loadCurrentDevices(patient.id);
  const built = buildFollowupUpdate(input, { current, today: todayInClinic() });
  if (built.error) throw new ValidationError(built.error);

  if (built.adaptationStart !== (patient.adaptation_start_manual ?? null)) {
    await patientsRepo.updatePatient(patient.id, { adaptation_start_manual: built.adaptationStart });
  }
  for (const item of built.items) {
    const updated = await repo.updateSaleItem(item.saleItemId, item.values);
    if (!updated) throw new ValidationError("Cihaz bilgisi kaydedilemedi; sayfayı yenileyin.");
  }
  return { changed: built.items.length };
}

// A typed or scanned serial → the unit on the shelf, or what is wrong with it. found: false means it is not in the
// system yet, so the window asks for its model (a unit the manufacturer sent).
export async function findReplacementUnit(serialText) {
  const serial = serialFromScan(serialText);
  if (!serial) throw new ValidationError("Seri numarasını okutun ya da yazın.");
  const unit = await repo.findUnitBySerial(serial);
  if (!unit) return { found: false, serial };
  if (unit.status !== "in_stock") {
    throw new ValidationError(`${serial} stokta değil (satılmış, serviste ya da çıkarılmış); başka bir cihaz seçin.`);
  }
  if (unit.products?.category !== "device") throw new ValidationError(`${serial} bir işitme cihazı değil.`);
  return {
    found: true,
    serial,
    unit: {
      id: unit.id,
      earSide: unit.ear_side,
      name: [unit.products?.brands?.name, unit.products?.name].filter(Boolean).join(" "),
    },
  };
}

// Brands and hearing aid models for the two forms. Inactive models only matter for a legacy device.
export async function loadDeviceCatalog() {
  const [brands, models] = await Promise.all([repo.listBrands(), repo.listDeviceModels()]);
  return {
    brands: brands.map((brand) => ({ id: brand.id, name: brand.name })),
    models: models.map((model) => ({
      id: model.id,
      brandId: model.brand_id,
      name: model.type ? `${model.name} (${model.type})` : model.name,
      active: model.active,
    })),
  };
}

export async function replaceDevice(patientId, input) {
  const patient = await findPatient(patientId);
  const current = await loadCurrentDevices(patient.id);
  const device = current.find((row) => row.saleItemId === Number(input?.saleItemId)) ?? null;
  const built = buildReplaceArgs({ ...input, serialNo: serialFromScan(input?.serialNo) }, { device, today: todayInClinic() });
  if (built.error) throw new ValidationError(built.error);
  return { replacementId: await repo.replaceDevice(built.args) };
}

export async function addLegacyDevice(patientId, input) {
  const patient = await findPatient(patientId);
  if (patient.record_type === "candidate") throw new ValidationError("Aday kayda cihaz eklenemez; önce hastaya dönüştürün.");
  const built = buildLegacyArgs({ ...input, serialNo: serialFromScan(input?.serialNo) }, { today: todayInClinic() });
  if (built.error) throw new ValidationError(built.error);
  return { saleId: await repo.addLegacyDevice(patient.id, built.args) };
}
