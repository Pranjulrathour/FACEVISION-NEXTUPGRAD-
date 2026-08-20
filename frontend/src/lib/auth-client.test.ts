import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSession,
  consumePendingWelcomeMessage,
  getStoredSession,
  setPendingWelcomeMessage,
  storeSession,
} from "./auth-client";

/**
 * Vitest's default environment is Node, not jsdom -- there is no real
 * `window`/`localStorage` global here (consistent with the rest of this
 * codebase: every module that touches browser APIs guards with
 * `typeof window === "undefined"`). This module's actual browser-path
 * logic still needs coverage, so stub a minimal in-memory localStorage
 * and a `window` global for the duration of these tests rather than
 * only exercising the early-return no-op path.
 */
function makeFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", makeFakeLocalStorage());
});

describe("auth-client session storage", () => {
  it("returns null when nothing is stored", () => {
    expect(getStoredSession()).toBeNull();
  });

  it("round-trips a stored session", () => {
    const session = { token: "abc.def.ghi", user: { id: "u1", email: "a@b.com", displayName: "A" } };
    storeSession(session);
    expect(getStoredSession()).toEqual(session);
  });

  it("clearSession removes the stored session", () => {
    storeSession({ token: "t", user: { id: "u1", email: "a@b.com", displayName: null } });
    clearSession();
    expect(getStoredSession()).toBeNull();
  });

  it("returns null instead of throwing on malformed stored JSON", () => {
    localStorage.setItem("facevision:auth", "{not valid json");
    expect(getStoredSession()).toBeNull();
  });

  it("returns null for a stored value missing required fields", () => {
    localStorage.setItem("facevision:auth", JSON.stringify({ token: "t" }));
    expect(getStoredSession()).toBeNull();
  });
});

describe("auth-client outside a browser environment", () => {
  it("no-ops instead of throwing when window is undefined", () => {
    vi.stubGlobal("window", undefined);
    expect(getStoredSession()).toBeNull();
    expect(() => storeSession({ token: "t", user: { id: "u1", email: "a@b.com", displayName: null } })).not.toThrow();
    expect(() => clearSession()).not.toThrow();
  });
});
