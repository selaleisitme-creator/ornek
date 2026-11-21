"use server";

import { refresh } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { toActionResult } from "@/modules/shared/server/actionResult";
import * as patientsService from "./patientsService";

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

export async function setAdaptationStart(id, date) {
  return toActionResult(async () => {
    await requireStaff();
    await patientsService.setAdaptationStart(id, date);
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
