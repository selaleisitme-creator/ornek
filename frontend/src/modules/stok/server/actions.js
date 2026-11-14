"use server";

import { refresh } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { toActionResult } from "@/modules/shared/server/actionResult";
import * as catalogService from "./catalogService";
import * as stockEntryService from "./stockEntryService";

// Thin gate for the stock page: check who is asking, hand the work to the service, refresh the page.
// Interns may enter stock too (plan 1.5.1), and none of these asks for the 6-digit code (Faz 1 plan, section 5).
// Called with plain objects from the entry window, not with form data.

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
