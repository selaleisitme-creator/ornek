import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AccessDeniedError } from "@/lib/auth";
import { StepUpRequiredError } from "@/lib/stepUp";
import { toUserMessage } from "@/lib/postgresErrors";

// Every Server Action returns the same shape, so the screens handle results one way:
//   { ok: true, data }                       success
//   { ok: false, error }                     a Turkish message to show
//   { ok: false, stepUpRequired: true }      ask for the 6-digit code, then retry
// Raw errors are logged on the server only; their text can name tables and columns.
export async function toActionResult(work) {
  try {
    return { ok: true, data: (await work()) ?? null };
  } catch (error) {
    unstable_rethrow(error); // redirect() and other Next.js control flow must pass through
    if (error instanceof StepUpRequiredError) return { ok: false, stepUpRequired: true };
    if (error instanceof AccessDeniedError) return { ok: false, error: "Bu işlem için yetkiniz yok." };
    console.error(error);
    return { ok: false, error: toUserMessage(error) };
  }
}
