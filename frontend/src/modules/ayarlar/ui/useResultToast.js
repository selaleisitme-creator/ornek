"use client";

import { useEffect } from "react";
import { useToast } from "@/modules/shared/ui/Toast";

// Shows a short message once each time a form's action result arrives.
export function useResultToast(result, successMessage) {
  const toast = useToast();
  useEffect(() => {
    if (!result) return;
    if (result.ok) toast(successMessage);
    else if (result.error) toast(result.error, "error");
  }, [result, successMessage, toast]);
}
