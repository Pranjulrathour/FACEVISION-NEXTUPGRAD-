import type { DetectionRecord, AppSettings, StatsSummary, DetectionMode } from "./face-types";

const HISTORY_KEY = "facevision:history";
const SETTINGS_KEY = "facevision:settings";

const DEFAULT_SETTINGS: AppSettings = {
  saveHistory: true,
  autoDetect: true,
  showLandmarks: true,
  showConfidenceLabel: true,
  frameColor: "#55f3b0",
  landmarkColor: "#ffd93d",
  compareThreshold: 0.78,
};

export function saveDetection(record: DetectionRecord): void {
  const settings = getSettings();
  if (!settings.saveHistory) return;
  const history = getHistory();
  history.unshift(record);
  const trimmed = history.slice(0, 100);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    const noImages = trimmed.map((r) => ({ ...r, imageDataUrl: undefined }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(noImages.slice(0, 200)));
  }
}

export function getHistory(): DetectionRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as DetectionRecord[]) : [];
  } catch {
    return [];
  }
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getStats(): StatsSummary {
  const history = getHistory();
  if (history.length === 0) {
    return {
      totalDetections: 0,
      totalFacesDetected: 0,
      avgConfidence: 0,
      topMode: "-",
      detectionHistory: [],
    };
  }
  const totalFaces = history.reduce((s, r) => s + r.faceCount, 0);
  const allConfidences = history.flatMap((r) => r.faces.map((f) => f.confidence));
  const avgConf =
    allConfidences.length > 0
      ? allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length
      : 0;
  const modeCounts: Record<DetectionMode, number> = { upload: 0, camera: 0 };
  history.forEach((r) => (modeCounts[r.mode] = (modeCounts[r.mode] || 0) + 1));
  const topMode: DetectionMode | "-" =
    modeCounts.upload >= modeCounts.camera && modeCounts.upload > 0
      ? "upload"
      : modeCounts.camera > 0
        ? "camera"
        : "-";
  const byDay = new Map<string, number>();
  history.forEach((r) => {
    const d = new Date(r.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    byDay.set(key, (byDay.get(key) || 0) + r.faceCount);
  });
  const detectionHistory = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([day, count]) => ({ day, count }));
  return {
    totalDetections: history.length,
    totalFacesDetected: totalFaces,
    avgConfidence: avgConf,
    topMode,
    detectionHistory,
  };
}
