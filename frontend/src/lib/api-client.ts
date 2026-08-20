import type {
  DetectionRecord,
  StatsSummary,
  Face,
  FaceMatchResult,
  DetectionMode,
  GalleryEntry,
  RecognitionResult,
} from "./face-types";
import { getStoredSession, type AuthSession, type AuthUser } from "./auth-client";

const API_BASE =
  (typeof process !== "undefined" && (process as any).env?.NEXT_PUBLIC_API_URL) ||
  "http://localhost:8000/api";

// Backend routes are versioned under /api/v1 (§14) — the unversioned
// /api/... paths still work but are deprecated (see main.py's
// deprecate_unversioned_routes middleware). NEXT_PUBLIC_API_URL keeps
// pointing at the bare .../api origin per existing deployment docs; the
// /v1 segment is added here so changing that env var format isn't required.
const API_VERSION_SEGMENT = "/v1";

let SESSION_ID: string | null = null;
function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  if (!SESSION_ID) {
    const existing = localStorage.getItem("facevision:sessionId");
    if (existing) {
      SESSION_ID = existing;
    } else {
      SESSION_ID = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("facevision:sessionId", SESSION_ID);
    }
  }
  return SESSION_ID;
}

function authHeaders(): Record<string, string> {
  const session = getStoredSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

async function request<T>(path: string, options?: RequestInit): Promise<T | null> {
  const url = `${API_BASE}${API_VERSION_SEGMENT}${path}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...authHeaders() },
      ...options,
    });
    if (!res.ok) {
      console.warn(`[FaceVision API] ${url} -> ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[FaceVision API] Network unavailable: ${url}`);
    return null;
  }
}

export type AuthRequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; detail: string };

/** What register()/login() resolve to on success -- the session to store,
 * plus how many pre-login, anonymously-enrolled gallery entries this call
 * just claimed onto the account (0 most of the time). */
export type AuthLoginResult = AuthSession & { claimedGalleryEntries: number };

/** Separate from request() above because auth flows need the actual
 * status/detail to show a useful message ("wrong password" vs "email
 * already registered" vs "network unavailable") -- request() collapses
 * every failure into a bare null, which is fine for silent background
 * syncs but not for a form the user is actively filling in. */
async function authRequest<T>(path: string, options?: RequestInit): Promise<AuthRequestResult<T>> {
  const url = `${API_BASE}${API_VERSION_SEGMENT}${path}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...authHeaders() },
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, detail: body?.detail ?? "Request failed" };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, detail: "Network unavailable" };
  }
}

export const api = {
  async health(): Promise<{ status?: string } | null> {
    return request<{ status?: string }>("/health", { method: "GET" });
  },

  async saveDetection(record: DetectionRecord): Promise<any> {
    const payload = {
      id: record.id,
      mode: record.mode,
      faceCount: record.faceCount,
      averageConfidence: record.averageConfidence,
      faces: record.faces.map((f) => ({
        box: f.box,
        confidence: f.confidence,
        landmarks: f.landmarks,
      })),
      imageName: record.imageName,
      userSessionId: getSessionId(),
      modelVersion: record.modelVersion,
    };
    return request<any>("/detections", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async listHistory(
    limit = 50,
    offset = 0,
    mode?: DetectionMode
  ): Promise<{ items: any[]; total: number } | null> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      userSessionId: getSessionId(),
    });
    if (mode) params.set("mode", mode);
    return request<{ items: any[]; total: number }>(`/history?${params.toString()}`);
  },

  async clearHistory(): Promise<{ deleted?: number } | null> {
    const params = new URLSearchParams({ userSessionId: getSessionId() });
    return request<{ deleted?: number }>(`/history?${params.toString()}`, {
      method: "DELETE",
    });
  },

  async getStats(): Promise<StatsSummary | null> {
    const params = new URLSearchParams({ userSessionId: getSessionId() });
    return request<StatsSummary>(`/stats?${params.toString()}`);
  },

  async compareFaces(
    faceA: Face,
    faceB: Face,
    threshold = 0.78
  ): Promise<FaceMatchResult | null> {
    return request<FaceMatchResult>("/compare", {
      method: "POST",
      body: JSON.stringify({ faceA, faceB, threshold }),
    });
  },

  /** Enroll an embedding under `name` — only the embedding vector is sent,
   * never an image (see docs/privacy-retention-policy.md). */
  async enrollFace(
    name: string,
    embedding: Float32Array | number[],
    modelVersion?: string
  ): Promise<GalleryEntry | null> {
    return request<GalleryEntry>("/gallery/enroll", {
      method: "POST",
      body: JSON.stringify({
        name,
        embedding: Array.from(embedding),
        modelVersion,
        userSessionId: getSessionId(),
      }),
    });
  },

  async listGallery(): Promise<{ items: GalleryEntry[]; total: number } | null> {
    const params = new URLSearchParams({ userSessionId: getSessionId() });
    return request<{ items: GalleryEntry[]; total: number }>(`/gallery?${params.toString()}`);
  },

  async deleteGalleryEntry(entryId: number): Promise<{ deleted?: boolean } | null> {
    const params = new URLSearchParams({ userSessionId: getSessionId() });
    return request<{ deleted?: boolean }>(`/gallery/${entryId}?${params.toString()}`, {
      method: "DELETE",
    });
  },

  async recognizeFace(
    embedding: Float32Array | number[],
    threshold?: number
  ): Promise<RecognitionResult | null> {
    return request<RecognitionResult>("/gallery/recognize", {
      method: "POST",
      body: JSON.stringify({
        embedding: Array.from(embedding),
        userSessionId: getSessionId(),
        threshold,
      }),
    });
  },

  async register(
    email: string,
    password: string,
    displayName?: string
  ): Promise<AuthRequestResult<AuthLoginResult>> {
    const result = await authRequest<{
      accessToken: string;
      user: AuthUser;
      claimedGalleryEntries?: number;
    }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        displayName: displayName || undefined,
        anonymousSessionId: getSessionId(),
      }),
    });
    if (!result.ok) return result;
    return {
      ok: true,
      data: {
        token: result.data.accessToken,
        user: result.data.user,
        claimedGalleryEntries: result.data.claimedGalleryEntries ?? 0,
      },
    };
  },

  async login(email: string, password: string): Promise<AuthRequestResult<AuthSession>> {
    const result = await authRequest<{ accessToken: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!result.ok) return result;
    return { ok: true, data: { token: result.data.accessToken, user: result.data.user } };
  },

  async deleteAccount(
    password: string
  ): Promise<AuthRequestResult<{ deleted: boolean; galleryEntriesDeleted: number }>> {
    return authRequest("/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
  },

  /** Checklist §18 — GET /metrics, per-route latency percentiles and error
   * rates. See backend/app/core/metrics.py for how these are computed. */
  async getMetrics(): Promise<MetricsSnapshot | null> {
    return request<MetricsSnapshot>("/metrics", { method: "GET" });
  },
};

export type RouteMetrics = {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sampledRequests: number;
};

export type MetricsSnapshot = {
  uptimeSeconds: number;
  routes: Record<string, RouteMetrics>;
};
