import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// "Step-up": critical actions (refund, stock removal, opening accounting) ask for the Authenticator code
// again, in place of the design's shared admin password. A correct code is remembered for 15 minutes in a
// signed, httpOnly cookie. The cookie is only a second confirmation; RLS remains the real protection.
//
// Signed with HMAC so it cannot be forged or extended in the browser; it also names the user, so a cookie
// left on a shared computer does not count for someone else.

const COOKIE = "panel_step_up";
const TTL_SECONDS = 15 * 60;

export class StepUpRequiredError extends Error {
  constructor() {
    super("Step-up confirmation required");
    this.name = "StepUpRequiredError";
  }
}

function secret() {
  const value = process.env.STEP_UP_SECRET ?? "";
  if (value.length < 32) throw new Error("STEP_UP_SECRET is missing or shorter than 32 characters");
  return value;
}

function sign(payload) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export async function hasRecentStepUp(userId) {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return false;

  const [payload, mac] = value.split(".");
  if (!payload || !mac) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;

  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return uid === userId && exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export async function requireStepUp(userId) {
  if (!(await hasRecentStepUp(userId))) throw new StepUpRequiredError();
}

// Checks the 6-digit code against the user's own Authenticator factor (the same way the login does) and,
// if it is right, remembers it for 15 minutes. Must run in a Server Action: only there can cookies be set.
export async function verifyStepUpCode(userId, code) {
  if (!/^\d{6}$/.test(code ?? "")) return false;

  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return false;
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) return false;

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return false;

  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS })
  ).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  return true;
}
