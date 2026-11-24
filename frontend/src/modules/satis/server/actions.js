"use server";

import { refresh } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { requireStepUp } from "@/lib/stepUp";
import { toActionResult } from "@/modules/shared/server/actionResult";
import * as saleService from "./saleService";
import * as soldService from "./soldService";

// Thin gate for selling. Every staff member may sell and collect payments, interns included (plan 1.5.1); a sale
// asks for no code (the refund, in the next step, will).

export async function loadSaleCatalog() {
  return toActionResult(async () => {
    await requireStaff();
    return saleService.loadCatalog();
  });
}

export async function loadGroupModels(category) {
  return toActionResult(async () => {
    await requireStaff();
    return saleService.loadGroupModels(category);
  });
}

export async function loadModelUnits(productId) {
  return toActionResult(async () => {
    await requireStaff();
    return saleService.loadModelUnits(productId);
  });
}

export async function findSaleItemByCode(text) {
  return toActionResult(async () => {
    await requireStaff();
    return saleService.findByCode(text);
  });
}

export async function createSale(input) {
  return toActionResult(async () => {
    await requireStaff();
    const result = await saleService.createSale(input);
    refresh();
    return result;
  });
}

export async function loadSaleFollowup(saleId, patientId) {
  return toActionResult(async () => {
    await requireStaff();
    return saleService.loadFollowup(saleId, patientId);
  });
}

export async function saveSaleFollowup(saleId, patientId, input) {
  return toActionResult(async () => {
    await requireStaff();
    await saleService.saveFollowup(saleId, patientId, input);
    refresh();
  });
}

export async function addSalePayment(saleId, patientId, input) {
  return toActionResult(async () => {
    await requireStaff();
    await saleService.addPayment(saleId, patientId, input);
    refresh();
  });
}

export async function loadSaleBalance(saleId, patientId) {
  return toActionResult(async () => {
    await requireStaff();
    return saleService.loadBalance(saleId, patientId);
  });
}

// ---------------------------------------------------------------------------
// Stok > Satılan ürünler: post-sale information, and the refund, which asks for the 6-digit code again (plan 1.5).
// ---------------------------------------------------------------------------

export async function saveSoldInfo(saleItemId, input) {
  return toActionResult(async () => {
    await requireStaff();
    await soldService.saveSoldInfo(saleItemId, input);
    refresh();
  });
}

export async function refundSaleItem(saleItemId, input) {
  return toActionResult(async () => {
    const staff = await requireStaff();
    await requireStepUp(staff.userId);
    const result = await soldService.refund(saleItemId, input);
    refresh();
    return result;
  });
}
