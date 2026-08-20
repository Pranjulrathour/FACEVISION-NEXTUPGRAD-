/**
 * Client-side JWT session storage (checklist §15/§16). Holds only the
 * token + the user fields the backend already returns (id/email/display
 * name) -- never a password, never anything biometric. See
 * docs/adr/0003-minifasnet-liveness-and-jwt-auth.md for the backend side
 * of this; this module is purely the browser-side counterpart so
 * api-client.ts can attach `Authorization: Bearer <token>` on requests.
 */
export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

const STORAGE_KEY = "facevision:auth";

export function getStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.token !== "string" || !parsed.user) return null;
    return parsed as AuthSession;
  } catch {
    return null;
  }
}

export function storeSession(session: AuthSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
