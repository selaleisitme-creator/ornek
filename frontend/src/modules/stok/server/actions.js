"use server";

import { refresh } from "next/cache";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { requireStepUp } from "@/lib/stepUp";
import { toActionResult } from "@/modules/shared/server/actionResult";
import * as catalogService from "./catalogService";
import * as stockEntryService from "./stockEntryService";
import * as stockRemovalService from "./stockRemovalService";
import * as priceService from "./priceService";
import * as serviceCatalogService from "./serviceCatalogService";

// Thin gate for the stock page: check who is asking, hand the work to the service, refresh the page.
// Interns may do everything here too (plan 1.5.1) except correcting a purchase price, which is the admin's.
// Which actions ask for the 6-digit code again follows the Faz 1 plan, section 5: deactivating a model,
// correcting a purchase price, removing stock, and a bulk price change or its undo. Called with plain
// objects, except the photo upload.

export async function addBrand(name) {
  return toActionResult(async () => {
    await requireStaff();
    const brand = await catalogService.addBrand(name);
    refresh();
    return brand;
  });
}

export async function addSupplier(input) {
  return toActionResult(async () => {
    await requireStaff();
    const supplier = await catalogService.addSupplier(input);
    refresh();
    return supplier;
  });
}

// A read, but it runs when the window moves to step 2, so it has to be callable from the browser.
export async function loadEntryModels(input) {
  return toActionResult(async () => {
    await requireStaff();
    return catalogService.listModels(input);
  });
}

export async function createStockEntry(input) {
  return toActionResult(async () => {
    await requireStaff();
    const result = await stockEntryService.createStockEntry(input);
    refresh();
    return result;
  });
}

// Staff, then the Authenticator code (remembered for 15 minutes), then the work. Without a fresh code the
// result is { stepUpRequired: true } and useStepUpAction asks for it and calls again.
async function asStaffWithCode(work) {
  return toActionResult(async () => {
    const staff = await requireStaff();
    await requireStepUp(staff.userId);
    const result = await work();
    refresh();
    return result;
  });
}

export async function updateModel(id, input) {
  return toActionResult(async () => {
    await requireStaff();
    await catalogService.updateModel(id, input);
    refresh();
  });
}

export async function deactivateModel(id) {
  return asStaffWithCode(() => catalogService.deactivateModel(id));
}

// FormData, because a File only travels to a Server Action inside form data. Fields: productId, photo.
export async function addProductPhoto(formData) {
  return toActionResult(async () => {
    await requireStaff();
    if (!(formData instanceof FormData)) throw new TypeError("Expected form data");
    const photo = await catalogService.addPhoto(formData.get("productId"), formData.get("photo"));
    refresh();
    return photo;
  });
}

export async function removeProductPhoto(photoId) {
  return toActionResult(async () => {
    await requireStaff();
    await catalogService.removePhoto(photoId);
    refresh();
  });
}

export async function updateUnit(input) {
  return toActionResult(async () => {
    await requireStaff();
    const result = await catalogService.updateUnit(input);
    refresh();
    return result;
  });
}

// Admin only, and the code again: the cash ledger reads each unit's purchase price, so a change rewrites
// past months. The database trigger refuses non-admins as well and logs every correction.
export async function correctUnitPurchasePrice(input) {
  return toActionResult(async () => {
    const admin = await requireAdmin();
    await requireStepUp(admin.userId);
    const result = await catalogService.correctUnitPurchasePrice(input);
    refresh();
    return result;
  });
}

export async function removeStockUnits(input) {
  return asStaffWithCode(() => stockRemovalService.removeUnits(input));
}

// ---------------------------------------------------------------------------
// Bulk sale prices and the service price list (PR 5)
// ---------------------------------------------------------------------------

// A read for the "Fiyat güncelle" window, loaded when it opens instead of with every page view.
export async function loadPriceModels() {
  return toActionResult(async () => {
    await requireStaff();
    return priceService.getPriceModels();
  });
}

export async function applyBulkPrices(input) {
  return asStaffWithCode(() => priceService.applyBulkPrices(input));
}

export async function undoLastPriceBatch(batchId) {
  return asStaffWithCode(() => priceService.undoLastPriceBatch(batchId));
}

// No code here (plan section 5): one price at a time, and the services trigger keeps every old price.
export async function saveServiceItem(input) {
  return toActionResult(async () => {
    await requireStaff();
    const item = await serviceCatalogService.saveServiceItem(input);
    refresh();
    return item;
  });
}

export async function removeServiceItem(id) {
  return toActionResult(async () => {
    await requireStaff();
    await serviceCatalogService.removeServiceItem(id);
    refresh();
  });
}
