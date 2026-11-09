"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import OtpInput from "@/components/OtpInput";
import Modal from "./Modal";
import { confirmStepUp } from "../server/stepUpActions";

// Asks for the Authenticator code again before a critical action (refund, stock removal, accounting).
// When an action answers { stepUpRequired: true }, the screen opens this and retries after onConfirmed.
export default function StepUpDialog({ open, reason, onConfirmed, onCancel }) {
  const [state, submit, pending] = useActionState(confirmStepUp, null);
  const [code, setCode] = useState("");
  const form = useRef(null);
  const handled = useRef(null);

  // Each successful verification is reported once. Without the ref, a parent that passes a new
  // onConfirmed function on every render would run the protected action again and again.
  useEffect(() => {
    if (state?.ok && state !== handled.current) {
      handled.current = state;
      setCode("");
      onConfirmed?.();
    }
  }, [state, onConfirmed]);

  return (
    <Modal open={open} onClose={onCancel} title="Kodunuzu girin" eyebrow="Ek doğrulama" size="sm">
      <form ref={form} action={submit} className="ui-stack">
        <p className="ui-text">
          {reason ?? "Bu işlem için Authenticator uygulamasındaki 6 haneli kod gerekiyor."} Kod 15 dakika boyunca
          tekrar sorulmaz.
        </p>
        <input type="hidden" name="code" value={code} />
        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={() => setTimeout(() => form.current?.requestSubmit(), 0)}
          invalid={state && !state.ok}
          disabled={pending}
        />
        {state && !state.ok && <p className="ui-error" role="alert">{state.error}</p>}
        <button type="submit" className="ui-button ui-button-primary" disabled={pending || code.length !== 6}>
          {pending ? "Doğrulanıyor…" : "Doğrula"}
        </button>
      </form>
    </Modal>
  );
}
