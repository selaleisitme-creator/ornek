import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runScheduledBackup } from "@/modules/ayarlar/server/backupService";

// Vercel Cron calls this every night (vercel.json) with "Authorization: Bearer <CRON_SECRET>". It takes the
// weekly backup when it is due; on the other nights it only reads the settings, which also keeps the free
// Supabase project from being paused for a week without use. Nobody else can trigger it: without the secret
// the answer is 401, and without CRON_SECRET configured the route refuses everything.
export const maxDuration = 300;

function authorized(request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const result = await runScheduledBackup();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Scheduled backup failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
