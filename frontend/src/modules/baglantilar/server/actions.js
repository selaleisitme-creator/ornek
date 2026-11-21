"use server";

import { refresh } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { toActionResult } from "@/modules/shared/server/actionResult";
import * as linksService from "./linksService";

// Thin gate for the Bağlantılar page. Every staff member may add, edit and remove links, interns included
// (plan 1.5.1); removing asks for confirmation on screen but not for the 6-digit code (decision 2026-11-21).

export async function addLink(input) {
  return toActionResult(async () => {
    await requireStaff();
    const link = await linksService.addLink(input);
    refresh();
    return link;
  });
}

export async function editLink(id, input) {
  return toActionResult(async () => {
    await requireStaff();
    await linksService.editLink(id, input);
    refresh();
  });
}

export async function removeLink(id) {
  return toActionResult(async () => {
    await requireStaff();
    await linksService.removeLink(id);
    refresh();
  });
}
