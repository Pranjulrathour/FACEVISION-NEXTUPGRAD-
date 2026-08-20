import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api-client";
import { storeSession } from "./auth-client";

function makeFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api.register", () => {
  it("maps a successful response, defaulting claimedGalleryEntries to 0 when omitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          accessToken: "tok",
          user: { id: "u1", email: "a@b.com", displayName: null },
        })
      )
    );
    const result = await api.register("a@b.com", "password123");
    expect(result).toEqual({
      ok: true,
      data: {
        token: "tok",
        user: { id: "u1", email: "a@b.com", displayName: null },
        claimedGalleryEntries: 0,
      },
    });
  });

  it("passes through a non-zero claimedGalleryEntries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          accessToken: "tok",
          user: { id: "u1", email: "a@b.com", displayName: null },
          claimedGalleryEntries: 3,
        })
      )
    );
    const result = await api.register("a@b.com", "password123");
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.claimedGalleryEntries).toBe(3);
  });

  it("surfaces a failure's status and detail instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { detail: "Email already registered" }))
    );
    const result = await api.register("a@b.com", "password123");
    expect(result).toEqual({ ok: false, status: 409, detail: "Email already registered" });
  });
});

describe("api.login", () => {
  it("maps a successful response the same way register does", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          accessToken: "tok2",
          user: { id: "u2", email: "b@c.com", displayName: null },
          claimedGalleryEntries: 1,
        })
      )
    );
    const result = await api.login("b@c.com", "password123");
    expect(result).toEqual({
      ok: true,
      data: {
        token: "tok2",
        user: { id: "u2", email: "b@c.com", displayName: null },
        claimedGalleryEntries: 1,
      },
    });
  });

  it("surfaces a 401 for wrong credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { detail: "Invalid email or password" }))
    );
    const result = await api.login("b@c.com", "wrong");
    expect(result).toEqual({ ok: false, status: 401, detail: "Invalid email or password" });
  });
});

describe("api.getMe", () => {
  it("returns ok:true with the user on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { id: "u1", email: "a@b.com", displayName: "A" }))
    );
    const result = await api.getMe();
    expect(result).toEqual({ ok: true, data: { id: "u1", email: "a@b.com", displayName: "A" } });
  });

  it("returns ok:false with status 401 on an expired/invalid token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { detail: "Not authenticated" }))
    );
    const result = await api.getMe();
    expect(result).toEqual({ ok: false, status: 401, detail: "Not authenticated" });
  });

  it("returns status 0 (not 401) when the network itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await api.getMe();
    expect(result).toEqual({ ok: false, status: 0, detail: "Network unavailable" });
  });

  it("sends the stored session's bearer token as an Authorization header", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", makeFakeLocalStorage());
    storeSession({ token: "my-jwt", user: { id: "u1", email: "a@b.com", displayName: null } });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "u1", email: "a@b.com", displayName: null }));
    vi.stubGlobal("fetch", fetchMock);

    await api.getMe();

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer my-jwt");
  });
});

describe("register() anonymous session id handling", () => {
  // getSessionId() caches its result in a module-level variable for the
  // life of the module -- reset the module registry and re-import fresh
  // for each case here, otherwise whichever case runs first "wins" the
  // cache for the rest of the file (a real bug caught while writing the
  // second case below: it kept observing the first case's generated id).
  async function freshApi() {
    vi.resetModules();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", makeFakeLocalStorage());
    return (await import("./api-client")).api;
  }

  it("generates a session id, persists it, and sends it as anonymousSessionId", async () => {
    const freshedApi = await freshApi();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { accessToken: "t", user: { id: "u1", email: "a@b.com", displayName: null } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await freshedApi.register("a@b.com", "password123");

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(typeof body.anonymousSessionId).toBe("string");
    expect(body.anonymousSessionId.length).toBeGreaterThan(0);
    expect(localStorage.getItem("facevision:sessionId")).toBe(body.anonymousSessionId);
  });

  it("reuses an existing session id across calls instead of regenerating it", async () => {
    const freshedApi = await freshApi();
    localStorage.setItem("facevision:sessionId", "already-there");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { accessToken: "t", user: { id: "u1", email: "a@b.com", displayName: null } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await freshedApi.login("a@b.com", "password123");

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body).anonymousSessionId).toBe("already-there");
  });
});
