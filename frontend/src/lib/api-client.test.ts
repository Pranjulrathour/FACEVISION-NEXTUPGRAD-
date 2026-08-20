import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api-client";

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
});
