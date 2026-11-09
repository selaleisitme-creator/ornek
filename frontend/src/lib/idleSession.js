// Auto sign-out after inactivity, also when the browser was closed in between.
// The open panel writes "<session id>.<limit in minutes>.<last activity, ms>" into a cookie; proxy.js reads
// it on the next request and signs the session out if the limit has passed. Tying it to the session id
// means an old cookie never throws out a fresh login: after signing in again the id is different.
// The cookie is only a timer; it grants nothing, so a person editing it can at most keep their own session.

export const IDLE_COOKIE = "panel_last_seen";
const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

export function formatIdleCookie(sessionId, minutes, at = Date.now()) {
  return `${sessionId}.${minutes}.${at}`;
}

export function isIdleExpired(value, sessionId, now = Date.now()) {
  if (!value || !sessionId) return false;
  const [cookieSession, minutesText, atText] = String(value).split(".");
  if (cookieSession !== sessionId) return false;

  const minutes = Math.min(Math.max(Number(minutesText) || 30, MIN_MINUTES), MAX_MINUTES);
  const at = Number(atText);
  if (!Number.isFinite(at)) return false;
  return now - at > minutes * 60 * 1000;
}
