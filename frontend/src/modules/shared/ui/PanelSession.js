"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setPanelSession } from "./panelSessionStore";
import { IDLE_COOKIE, formatIdleCookie } from "@/lib/idleSession";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"];
const SHARED_KEY = "panel-last-activity";
const CHECK_EVERY_MS = 30 * 1000;
const COOKIE_EVERY_MS = 30 * 1000;
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // seconds; long enough to outlive any session

// Renders nothing. Hands the user's permissions to the menu and signs out after `idleLogoutMinutes`
// without activity (shared computer at the clinic). The last activity time is shared between tabs through
// localStorage, so working in one tab keeps the others signed in too.
export default function PanelSession({ sessionId, canViewAccounting, isAdmin, idleLogoutMinutes }) {
  const router = useRouter();

  useEffect(() => {
    setPanelSession({ canViewAccounting, isAdmin });
  }, [canViewAccounting, isAdmin]);

  useEffect(() => {
    const limit = idleLogoutMinutes * 60 * 1000;
    let last = Date.now();
    let cookieWrittenAt = 0;

    // Tells the server (proxy.js) when this session was last used, so a browser that is closed and opened
    // again after the limit lands on the login page. Written at most every 30 seconds.
    const writeCookie = () => {
      if (!sessionId || last - cookieWrittenAt < COOKIE_EVERY_MS) return;
      cookieWrittenAt = last;
      const secure = window.location.protocol === "https:" ? "; secure" : "";
      document.cookie = `${IDLE_COOKIE}=${formatIdleCookie(sessionId, idleLogoutMinutes, last)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax${secure}`;
    };

    const remember = () => {
      last = Date.now();
      writeCookie();
      try {
        localStorage.setItem(SHARED_KEY, String(last));
      } catch {
        // Private mode can refuse storage; this tab still keeps its own timer.
      }
    };
    const lastActivity = () => {
      try {
        return Math.max(last, Number(localStorage.getItem(SHARED_KEY)) || 0);
      } catch {
        return last;
      }
    };

    let signingOut = false;
    const check = async () => {
      if (signingOut || Date.now() - lastActivity() < limit) return;
      signingOut = true;
      await createClient().auth.signOut();
      router.replace("/giris");
      router.refresh();
    };

    remember();
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, remember, { passive: true }));
    // A laptop waking from sleep fires no activity first, so check as soon as the page is visible again.
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, CHECK_EVERY_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, remember));
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [idleLogoutMinutes, router, sessionId]);

  return null;
}
