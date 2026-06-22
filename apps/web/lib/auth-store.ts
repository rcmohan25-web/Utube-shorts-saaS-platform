'use client';

// In-memory access token store. Per §9.1: tokens live in memory only, NEVER
// localStorage/sessionStorage (XSS risk). This means a hard refresh logs the
// user out today — wiring the httpOnly refresh-cookie silent-refresh-on-load
// flow is the next increment on top of this scaffold.
let accessToken: string | null = null;
const listeners = new Set<() => void>();

export function setAccessToken(token: string | null) {
  accessToken = token;
  listeners.forEach((fn) => fn());
}

export function getAccessToken() {
  return accessToken;
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
