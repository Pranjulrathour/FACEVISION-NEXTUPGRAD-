import type {
  DetectionRecord,
  StatsSummary,
  Face,
  FaceMatchResult,
  DetectionMode,
} from "./face-types";

const API_BASE =
  (typeof process !== "undefined" && (process as any).env?.NEXT_PUBLIC_API_URL) ||
  "http://localhost:8000/api";

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

async function request<T>(path: string, options?: RequestInit): Promise<T | null> {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
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
};
