"use client";

import { useCallback, useState } from "react";
import StepUpDialog from "./StepUpDialog";

// Runs a Server Action; if it answers { stepUpRequired: true }, asks for the Authenticator code and then
// runs the same action again with the same arguments. Screens just `await run(action, ...args)` and get
// the final result ({ ok:false, cancelled:true } if the person closes the code window).
//   const { run, stepUpDialog } = useStepUpAction();
//   ... {stepUpDialog} somewhere in the JSX
export function useStepUpAction() {
  const [waiting, setWaiting] = useState(null); // { action, args, resolve }

  const run = useCallback(async (action, ...args) => {
    const result = await action(...args);
    if (!result?.stepUpRequired) return result;
    return new Promise((resolve) => setWaiting({ action, args, resolve }));
  }, []);

  async function confirmed() {
    const current = waiting;
    setWaiting(null);
    current?.resolve(await current.action(...current.args));
  }

  function cancelled() {
    waiting?.resolve({ ok: false, cancelled: true });
    setWaiting(null);
  }

  const stepUpDialog = <StepUpDialog open={Boolean(waiting)} onConfirmed={confirmed} onCancel={cancelled} />;
  return { run, stepUpDialog };
}
