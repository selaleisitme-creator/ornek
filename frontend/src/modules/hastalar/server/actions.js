"use server";

import { refresh } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { requireStepUp } from "@/lib/stepUp";
import { toActionResult } from "@/modules/shared/server/actionResult";
import * as patientsService from "./patientsService";
import * as deviceService from "./deviceService";

// Thin gate for the Hastalar page. Every staff member may use these, interns included (plan 1.5.1); the
// national ID rules are checked again in the database (save_national_id, reveal_national_id).

export async function createPatient(input) {
  return toActionResult(async () => {
    await requireStaff();
    const patient = await patientsService.createPatient(input);
    refresh();
    return patient;
  });
}

export async function updatePatient(id, input) {
  return toActionResult(async () => {
    const staff = await requireStaff();
    await patientsService.updatePatient(id, input, staff);
    refresh();
  });
}

export async function addPatientNote(id, input) {
  return toActionResult(async () => {
    await requireStaff();
    await patientsService.addNote(id, input);
    refresh();
  });
}

export async function promoteCandidate(id) {
  return toActionResult(async () => {
    await requireStaff();
    await patientsService.promoteCandidate(id);
    refresh();
  });
}

export async function removePatient(id) {
  return toActionResult(async () => {
    await requireStaff();
    await patientsService.removePatient(id);
    refresh();
  });
}

export async function logWhatsAppContact(id, options) {
  return toActionResult(async () => {
    await requireStaff();
    await patientsService.logWhatsAppContact(id, options);
    refresh();
  });
}

export async function revealNationalId(id) {
  return toActionResult(async () => {
    const staff = await requireStaff();
    return patientsService.revealNationalId(id, staff);
  });
}

// ---------------------------------------------------------------------------
// "Cihaz ve takip bilgileri" window (docs/faz-2-cihaz-takip-plani.md). A device replacement and a legacy device
// change the stock and cannot be undone on screen, so they ask for the 6-digit code again, like removing stock.
// ---------------------------------------------------------------------------

async function asStaffWithCode(work) {
  return toActionResult(async () => {
    const staff = await requireStaff();
    await requireStepUp(staff.userId);
    const result = await work();
    refresh();
    return result;
  });
}

export async function updateDeviceFollowup(id, input) {
  return toActionResult(async () => {
    await requireStaff();
    const result = await deviceService.updateFollowup(id, input);
    refresh();
    return result;
  });
}

export async function loadDeviceCatalog() {
  return toActionResult(async () => {
    await requireStaff();
    return deviceService.loadDeviceCatalog();
  });
}

export async function findReplacementUnit(serial) {
  return toActionResult(async () => {
    await requireStaff();
    return deviceService.findReplacementUnit(serial);
  });
}

export async function replaceDevice(id, input) {
  return asStaffWithCode(() => deviceService.replaceDevice(id, input));
}

export async function addLegacyDevice(id, input) {
  return asStaffWithCode(() => deviceService.addLegacyDevice(id, input));
}
