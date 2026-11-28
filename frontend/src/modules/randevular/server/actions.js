"use server";

import { io, refresh } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { toActionResult } from "@/modules/shared/server/actionResult";
import * as appointmentsService from "./appointmentsService";
import * as requestsRepo from "./appointmentsRepository";

export async function listAppointmentsForMonth(month) {
  return toActionResult(async () => {
    await requireStaff();
    return appointmentsService.getAppointmentsForMonth(month);
  });
}

export async function searchAppointmentPatients(query) {
  return toActionResult(async () => {
    await requireStaff();
    return appointmentsService.searchAppointmentPatients(query);
  });
}

export async function listOpenAppointmentRequests() {
  return toActionResult(async () => {
    await requireStaff();
    return requestsRepo.listOpenRequests();
  });
}

export async function saveAppointment(input, appointmentId) {
  return toActionResult(async () => {
    await requireStaff();
    const id = await appointmentsService.saveAppointment(input, appointmentId);
    refresh();
    return id;
  });
}

export async function markAppointmentAttendance(id, status) {
  return toActionResult(async () => {
    await requireStaff();
    const appointment = await appointmentsService.setAttendance(id, status);
    refresh();
    return appointment;
  });
}

export async function cancelAppointment(id) {
  return toActionResult(async () => {
    await requireStaff();
    await io();
    await appointmentsService.cancelAppointment(id);
    refresh();
  });
}

export async function convertAppointmentRequest(id, input) {
  return toActionResult(async () => {
    await requireStaff();
    const appointmentId = await appointmentsService.convertAppointmentRequest(id, input);
    refresh();
    return appointmentId;
  });
}

export async function rejectAppointmentRequest(id) {
  return toActionResult(async () => {
    await requireStaff();
    await appointmentsService.rejectAppointmentRequest(id);
    refresh();
  });
}

export async function checkAppointmentReminders() {
  return toActionResult(async () => {
    await requireStaff();
    await io();
    return appointmentsService.getDueReminder(new Date());
  });
}

export async function markAppointmentReminderSent(appointmentId, offset) {
  return toActionResult(async () => {
    await requireStaff();
    await appointmentsService.recordReminderSent(appointmentId, offset);
    refresh();
  });
}

export async function recordAppointmentContact(id) {
  return toActionResult(async () => {
    await requireStaff();
    await appointmentsService.recordAppointmentContact(id);
    refresh();
  });
}
