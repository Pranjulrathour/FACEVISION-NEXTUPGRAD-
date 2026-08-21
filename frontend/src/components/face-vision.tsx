"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Face,
  RuntimeState,
  DetectionMode,
  DetectionRecord,
  StatsSummary,
  AppSettings,
  GalleryEntry,
  RecognitionLabel,
} from "@/lib/face-types";
import { loadImage, validateImage, validateImageSignature } from "@/lib/image";
import { captureFaceThumbnail } from "@/lib/face-crop";
import { YuNetDetector } from "@/lib/yunet";
import { SFaceEmbedder } from "@/lib/sface";
import { MiniFASNetClassifier } from "@/lib/minifasnet";
import { deepEqualFace } from "@/lib/face-math";
import {
  runDetectionPipeline,
  embedFace,
  checkLiveness,
  FacePipelineError,
  EmbeddingError,
} from "@/lib/face-pipeline";
import { LivenessHeuristic } from "@/lib/liveness";
import { shouldAutoRecognize } from "@/lib/recognition-throttle";
import {
  nextRecognitionStreak,
  shouldApplyRecognitionResult,
  type RecognitionStreak,
} from "@/lib/recognition-stability";
import {
  saveDetection as saveLocal,
  getHistory as getLocalHistory,
  clearHistory as clearLocalHistory,
  getSettings,
  saveSettings,
  getStats as getLocalStats,
} from "@/lib/storage";
import { api } from "@/lib/api-client";
import {
  clearSession,
  consumePendingWelcomeMessage,
  getStoredSession,
  type AuthSession,
} from "@/lib/auth-client";
import type { PanelTab } from "@/lib/panel-types";

const DEFAULT_SETTINGS: AppSettings = {
  saveHistory: true,
  autoDetect: true,
  showLandmarks: true,
  showConfidenceLabel: true,
  frameColor: "#55f3b0",
  landmarkColor: "#ffd93d",
};

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sourceDimensions(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }
  return { width: source.naturalWidth, height: source.naturalHeight };
}

export function FaceVision() {
  const router = useRouter();
  const detector = useRef<YuNetDetector | null>(null);
  const embedder = useRef<SFaceEmbedder | null>(null);
  const antiSpoof = useRef<MiniFASNetClassifier | null>(null);
  const lastSource = useRef<HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null>(null);
  const cameraLiveness = useRef<LivenessHeuristic>(new LivenessHeuristic());
  /** Mirrors recognizedNames state for draw() to read at call time. draw()
   * intentionally does NOT depend on recognizedNames (that would recreate
   * it, and therefore startCamera, on every recognition tick) -- the
   * already-running camera loop closes over one draw() instance for its
   * whole session, so anything it needs to see update live has to come
   * from a ref, not a dependency-array-triggered recreation. */
  const recognizedNamesRef = useRef<Record<number, RecognitionLabel>>({});
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** Offscreen, reused per camera tick — see the scan() comment below for why
   * detection and drawing must run against one frozen frame, not the live
   * video twice. */
  const cameraSnapshot = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef<number | null>(null);

  const [mode, setMode] = useState<DetectionMode>("upload");
  const [runtime, setRuntime] = useState<RuntimeState>("idle");
  const [engine, setEngine] = useState<string>("");
  const [livenessSignal, setLivenessSignal] = useState<string | null>(null);
  const [status, setStatus] = useState(
    () => consumePendingWelcomeMessage() ?? "Choose an image or start your camera."
  );
  const [faces, setFaces] = useState<Face[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [confidenceSlider, setConfidenceSlider] = useState(0.75);
  const [nmsSlider, setNmsSlider] = useState(0.35);

  const [panel, setPanel] = useState<PanelTab>("workspace");
  const [settings, setSettings] = useState<AppSettings>(() => getSettings());
  const [history, setHistory] = useState<DetectionRecord[]>(() => getLocalHistory());
  const [stats, setStats] = useState<StatsSummary | null>(() => getLocalStats());
  const [selectedFaceIdx, setSelectedFaceIdx] = useState<number | null>(null);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [embedderStatus, setEmbedderStatus] = useState<RuntimeState>("idle");
  const [antiSpoofStatus, setAntiSpoofStatus] = useState<RuntimeState>("idle");
  const [antiSpoofResults, setAntiSpoofResults] = useState<Record<number, { label: string; confidence: number }>>({});
  const [galleryEntries, setGalleryEntries] = useState<GalleryEntry[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [recognizedNames, setRecognizedNames] = useState<Record<number, RecognitionLabel>>({});
  /** Per-face-slot auto-recognition throttle state (see shouldAutoRecognize) --
   * a ref, not state, since updating it must never trigger a re-render. */
  const recognizeThrottle = useRef<{ lastCheckedAt: Record<number, number>; inFlight: Set<number> }>({
    lastCheckedAt: {},
    inFlight: new Set(),
  });
  /** Per-face-slot streak state for runRecognitionCheck's hysteresis (see
   * recognition-stability.ts) -- a ref for the same reason as the throttle
   * state above: it's bookkeeping the auto-recognition loop reads and
   * writes on every tick, not something that should trigger a re-render. */
  const recognitionStreaks = useRef<Record<number, RecognitionStreak>>({});

  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getStoredSession());
  /** Gates rendering the camera UI until we know the stored session (if
   * any) is actually still accepted by the backend -- see the mount
   * effect below. The app requires signing in first, so this starts
   * false and the guard effect is what flips it true (or bounces to
   * /login). */
  const [authChecked, setAuthChecked] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [enrollTarget, setEnrollTarget] = useState<Face | null>(null);
  const [enrollNameInput, setEnrollNameInput] = useState("");
  const [enrollModalError, setEnrollModalError] = useState<string | null>(null);

  useEffect(() => {
    void api.health().then((r) => setApiAvailable(!!r && r.status === "ok"));
  }, []);

  useEffect(() => {
    if (!authSession) {
      router.replace("/login");
      return;
    }
    void api.getMe().then((result) => {
      if (result.ok) {
        setAuthChecked(true);
        return;
      }
      if (result.status === 401) {
        // The token is genuinely no good any more (expired/revoked) --
        // send the user back to sign in.
        clearSession();
        setAuthSession(null);
        router.replace("/login");
        return;
      }
      // Network hiccup or backend error, not an auth rejection -- don't
      // sign the user out just because the backend blipped once.
      setAuthChecked(true);
    });
  }, [authSession, router]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    recognizedNamesRef.current = recognizedNames;
  }, [recognizedNames]);

  const refreshEngine = useCallback(() => {
    const active = detector.current?.provider;
    if (active) setEngine(active.toUpperCase());
  }, []);

  const toDataUrl = useCallback((): string | null => {
    return canvas.current?.toDataURL("image/jpeg", 0.8) ?? null;
  }, []);

  const persistCurrent = useCallback(
    (found: Face[]) => {
      if (found.length === 0) return;
      const avgConf =
        found.reduce((s, f) => s + f.confidence, 0) / found.length;
      const record: DetectionRecord = {
        id: uid(),
        timestamp: Date.now(),
        mode,
        faceCount: found.length,
        averageConfidence: avgConf,
        faces: found,
        imageName: mode === "upload" && preview ? preview.slice(0, 60) : undefined,
        imageDataUrl: settings.saveHistory ? toDataUrl() ?? undefined : undefined,
        modelVersion: detector.current?.modelVersion,
      };
      saveLocal(record);
      setHistory(getLocalHistory());
      setStats(getLocalStats());
      if (apiAvailable) void api.saveDetection(record);
    },
    [mode, preview, settings.saveHistory, toDataUrl, apiAvailable]
  );

  const draw = useCallback(
    (
      source: CanvasImageSource,
      width: number,
      height: number,
      found: Face[],
      highlightIndex: number | null = null
    ) => {
      const output = canvas.current;
      if (!output) return;
      output.width = width;
      output.height = height;
      const context = output.getContext("2d");
      if (!context) return;
      context.drawImage(source, 0, 0, width, height);
      const strokeWidth = Math.max(3, width / 320);
      context.lineWidth = strokeWidth;
      context.font = `${Math.max(12, width / 42)}px ui-sans-serif`;
      const radius = Math.max(6, width / 180);
      found.forEach((face, i) => {
        const { x, y, width: boxWidth, height: boxHeight } = face.box;
        const isHighlight = highlightIndex === i;
        let stroke = settings.frameColor;
        let fillAlpha = 0.14;
        if (isHighlight) {
          stroke = "#fff";
          fillAlpha = 0.2;
        }
        context.strokeStyle = stroke;
        context.fillStyle = `${stroke}${Math.round(fillAlpha * 255)
          .toString(16)
          .padStart(2, "0")}`;
        const rx = Math.min(radius, boxWidth / 2, boxHeight / 2);
        context.beginPath();
        context.moveTo(x + rx, y);
        context.lineTo(x + boxWidth - rx, y);
        context.quadraticCurveTo(x + boxWidth, y, x + boxWidth, y + rx);
        context.lineTo(x + boxWidth, y + boxHeight - rx);
        context.quadraticCurveTo(x + boxWidth, y + boxHeight, x + boxWidth - rx, y + boxHeight);
        context.lineTo(x + rx, y + boxHeight);
        context.quadraticCurveTo(x, y + boxHeight, x, y + boxHeight - rx);
        context.lineTo(x, y + rx);
        context.quadraticCurveTo(x, y, x + rx, y);
        context.closePath();
        context.fill();
        context.stroke();
        if (settings.showConfidenceLabel) {
          const label = `${Math.round(face.confidence * 100)}%`;
          const labelW = context.measureText(label).width + 16;
          context.fillStyle = "#07130e";
          context.fillRect(x, Math.max(0, y - 24), labelW, 24);
          context.fillStyle = stroke;
          context.fillText(label, x + 8, Math.max(17, y - 7));
        }
        const recognition = recognizedNamesRef.current[i];
        if (recognition && recognition.status !== "checking") {
          const nameText = recognition.status === "matched" ? recognition.name : "Not registered";
          const nameColor = recognition.status === "matched" ? "#55f3b0" : "#ff8f8f";
          const nameW = context.measureText(nameText).width + 16;
          const nameY = Math.min(height - 24, y + boxHeight + 6);
          context.fillStyle = "#07130ecc";
          context.fillRect(x, nameY, nameW, 24);
          context.fillStyle = nameColor;
          context.fillText(nameText, x + 8, nameY + 17);
        }
        if (settings.showLandmarks) {
          const landmarkRadius = Math.max(3, width / 260);
          context.fillStyle = settings.landmarkColor;
          const lm = face.landmarks;
          const points = [lm.rightEye, lm.leftEye, lm.nose, lm.rightMouth, lm.leftMouth];
          points.forEach((pt) => {
            context.beginPath();
            context.arc(pt.x, pt.y, landmarkRadius, 0, Math.PI * 2);
            context.fill();
          });
          context.strokeStyle = `${settings.landmarkColor}99`;
          context.lineWidth = Math.max(1, width / 900);
          context.beginPath();
          context.moveTo(lm.rightEye.x, lm.rightEye.y);
          context.lineTo(lm.nose.x, lm.nose.y);
          context.lineTo(lm.leftEye.x, lm.leftEye.y);
          context.moveTo(lm.nose.x, lm.nose.y);
          context.lineTo(lm.rightMouth.x, lm.rightMouth.y);
          context.lineTo(lm.leftMouth.x, lm.leftMouth.y);
          context.stroke();
        }
      });
    },
    [settings.frameColor, settings.landmarkColor, settings.showConfidenceLabel, settings.showLandmarks]
  );

  // Upload mode draws the canvas once, at detection time -- unlike camera
  // mode's continuously-redrawing loop, nothing repaints it afterwards.
  // Auto-recognition resolves shortly after that initial draw, so without
  // this the on-canvas name tag would never actually appear for an
  // uploaded image (the sidebar face card would still show it correctly,
  // just not the frame itself).
  useEffect(() => {
    if (mode !== "upload" || !lastSource.current || faces.length === 0) return;
    const { width, height } = sourceDimensions(lastSource.current);
    draw(lastSource.current, width, height, faces, selectedFaceIdx);
  }, [recognizedNames, mode, faces, selectedFaceIdx, draw]);

  const prepareDetector = useCallback(async () => {
    if (detector.current) return true;
    setRuntime("loading");
    setStatus("Loading the private on-device detector…");
    try {
      const instance = new YuNetDetector();
      const activeEngine = await instance.initialize();
      detector.current = instance;
      setEngine(activeEngine.toUpperCase());
      setRuntime("ready");
      return true;
    } catch (err) {
      console.error("[FaceVision] Failed to load detector model:", err);
      setRuntime("error");
      setStatus("Face model is unavailable. Add the YuNet model file and refresh.");
      return false;
    }
  }, []);

  const prepareEmbedder = useCallback(async () => {
    if (embedder.current) return true;
    setEmbedderStatus("loading");
    setStatus("Loading the face-recognition model (SFace, ~37MB, cached after first load)…");
    try {
      const instance = new SFaceEmbedder();
      await instance.initialize();
      embedder.current = instance;
      setEmbedderStatus("ready");
      return true;
    } catch (err) {
      console.error("[FaceVision] Failed to load embedding model:", err);
      setEmbedderStatus("error");
      setStatus("Face-recognition model is unavailable. Add the SFace model file and refresh.");
      return false;
    }
  }, []);

  const prepareAntiSpoof = useCallback(async () => {
    if (antiSpoof.current) return true;
    setAntiSpoofStatus("loading");
    setStatus("Loading the anti-spoofing model (MiniFASNet, ~2MB, cached after first load)…");
    try {
      const instance = new MiniFASNetClassifier();
      await instance.initialize();
      antiSpoof.current = instance;
      setAntiSpoofStatus("ready");
      return true;
    } catch (err) {
      console.error("[FaceVision] Failed to load anti-spoofing model:", err);
      setAntiSpoofStatus("error");
      setStatus("Anti-spoofing model is unavailable. Add the MiniFASNet model file and refresh.");
      return false;
    }
  }, []);

  const checkFaceLiveness = useCallback(
    async (face: Face, faceIdx: number) => {
      if (!lastSource.current) return;
      if (!(await prepareAntiSpoof())) return;
      setGalleryBusy(true);
      try {
        const result = await checkLiveness(
          antiSpoof.current!,
          lastSource.current,
          // MiniFASNet's crop expects the detector's raw box, not the one
          // padded for on-screen display -- see the rawBox comment in
          // face-types.ts for why using the padded box here skewed results.
          face.rawBox ?? face.box,
          sourceDimensions(lastSource.current).width,
          sourceDimensions(lastSource.current).height
        );
        setAntiSpoofResults((prev) => ({ ...prev, [faceIdx]: result }));
        setStatus(
          result.label === "real"
            ? `Liveness check: likely a real face (${Math.round(result.confidence * 100)}% confidence). Not a certified anti-spoofing result.`
            : `Liveness check: possible spoof — photo or screen replay (${Math.round(result.confidence * 100)}% confidence). Not a certified anti-spoofing result.`
        );
      } catch (err) {
        console.error("[FaceVision] Liveness check failed:", err);
        const detail = err instanceof Error ? err.message : String(err);
        setStatus(`Liveness check failed — ${detail}.`);
      } finally {
        setGalleryBusy(false);
      }
    },
    [prepareAntiSpoof]
  );

  const openAccountModal = useCallback(() => {
    setAuthError(null);
    setDeleteConfirmOpen(false);
    setDeletePassword("");
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
  }, []);

  const logOut = useCallback(() => {
    clearSession();
    setAuthSession(null);
    setAuthModalOpen(false);
    router.replace("/login");
  }, [router]);

  const confirmDeleteAccount = useCallback(async () => {
    if (!deletePassword) {
      setAuthError("Enter your password to confirm.");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await api.deleteAccount(deletePassword);
      if (!result.ok) {
        setAuthError(result.detail);
        return;
      }
      clearSession();
      setAuthSession(null);
      setAuthModalOpen(false);
      setDeleteConfirmOpen(false);
      setDeletePassword("");
      setStatus(
        `Account deleted (${result.data.galleryEntriesDeleted} gallery ${
          result.data.galleryEntriesDeleted === 1 ? "entry" : "entries"
        } removed with it).`
      );
    } finally {
      setAuthBusy(false);
    }
  }, [deletePassword]);

  const refreshGallery = useCallback(async () => {
    const result = await api.listGallery();
    if (result) setGalleryEntries(result.items);
  }, []);

  const enrollFace = useCallback(
    async (face: Face, name: string) => {
      if (!lastSource.current) {
        setStatus("Run a detection first, then enroll a face.");
        return;
      }
      if (!(await prepareEmbedder())) return;
      setGalleryBusy(true);
      try {
        const vector = await embedFace(embedder.current!, lastSource.current, face.landmarks);
        const { width, height } = sourceDimensions(lastSource.current);
        const thumbnail = captureFaceThumbnail(lastSource.current, face.box, width, height) ?? undefined;
        const entry = await api.enrollFace(name, vector, embedder.current!.modelVersion, thumbnail);
        if (entry) {
          setStatus(`Enrolled "${name}" (${entry.sampleCount} sample${entry.sampleCount === 1 ? "" : "s"}).`);
          // Reflect the name immediately rather than waiting for the next
          // auto-recognition throttle tick -- we already know the answer,
          // no need to re-ask the backend.
          const idx = faces.findIndex((f) => deepEqualFace(f, face));
          if (idx >= 0) {
            setRecognizedNames((prev) => ({
              ...prev,
              [idx]: { status: "matched", name, similarity: 1 },
            }));
            recognizeThrottle.current.lastCheckedAt[idx] = Date.now();
          }
          await refreshGallery();
          return true;
        }
        setStatus("Enrollment failed — backend unavailable or rejected the request.");
        return false;
      } catch (err) {
        console.error("[FaceVision] Enrollment failed:", err);
        const detail = err instanceof Error ? err.message : String(err);
        setStatus(`Enrollment failed — ${detail}.`);
        return false;
      } finally {
        setGalleryBusy(false);
      }
    },
    [prepareEmbedder, refreshGallery, faces]
  );

  const openEnrollModal = useCallback((face: Face) => {
    setEnrollTarget(face);
    setEnrollNameInput("");
    setEnrollModalError(null);
  }, []);

  const closeEnrollModal = useCallback(() => {
    setEnrollTarget(null);
    setEnrollNameInput("");
    setEnrollModalError(null);
  }, []);

  const confirmEnroll = useCallback(async () => {
    if (!enrollTarget) return;
    const trimmed = enrollNameInput.trim();
    if (!trimmed) {
      setEnrollModalError("Enter a name for this identity.");
      return;
    }
    setEnrollModalError(null);
    const ok = await enrollFace(enrollTarget, trimmed);
    if (ok) {
      setEnrollTarget(null);
      setEnrollNameInput("");
    } else {
      setEnrollModalError("Enrollment failed — see status bar below for details.");
    }
  }, [enrollTarget, enrollNameInput, enrollFace]);

  /** Checks one detected face against the gallery and always lands on a
   * definite label -- "matched" or "unregistered", never left blank --
   * so a shown face reliably tells the user whether it's recognized.
   * Shared by the manual "Recognize" button (silent: false, reports
   * through the status bar) and the automatic per-tick checks below
   * (silent: true, so a 5s auto-poll doesn't spam the status bar). */
  const runRecognitionCheck = useCallback(
    async (face: Face, faceIdx: number, opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (!lastSource.current) return;
      recognizeThrottle.current.inFlight.add(faceIdx);
      recognizeThrottle.current.lastCheckedAt[faceIdx] = Date.now();
      const hasConfirmedLabel = () => {
        const current = recognizedNamesRef.current[faceIdx];
        return !!current && current.status !== "checking";
      };
      // Once a label is confirmed, a silent recheck runs quietly -- no
      // "checking" flash -- so a single borderline blip can't even
      // visibly pass through before potentially being discarded below.
      // Manual clicks always show it; there's nothing confirmed to
      // protect from a check the user explicitly just asked for.
      if (!silent || !hasConfirmedLabel()) {
        setRecognizedNames((prev) => ({ ...prev, [faceIdx]: { status: "checking" } }));
      }
      if (!silent) setGalleryBusy(true);
      try {
        if (!(await prepareEmbedder())) {
          if (!hasConfirmedLabel()) {
            setRecognizedNames((prev) => {
              const next = { ...prev };
              delete next[faceIdx];
              return next;
            });
          }
          return;
        }
        const vector = await embedFace(embedder.current!, lastSource.current, face.landmarks);
        const result = await api.recognizeFace(vector);
        const rawLabel: RecognitionLabel =
          result?.matched && result.name
            ? { status: "matched", name: result.name, similarity: result.similarity }
            : { status: "unregistered" };
        const resultKey = rawLabel.status === "matched" ? `matched:${rawLabel.name}` : "unregistered";

        if (!silent) {
          // An explicit, user-requested check always shows exactly what
          // was just found -- no smoothing -- and resets the streak so
          // subsequent silent auto-checks build on this fresh baseline.
          recognitionStreaks.current[faceIdx] = { key: resultKey, count: 1 };
          setRecognizedNames((prev) => ({ ...prev, [faceIdx]: rawLabel }));
          setStatus(
            rawLabel.status === "matched"
              ? `Recognized as "${rawLabel.name}" (${Math.round(rawLabel.similarity * 100)}% similarity).`
              : "Not registered — no match found in your gallery for this face."
          );
        } else {
          const streak = nextRecognitionStreak(recognitionStreaks.current[faceIdx], resultKey);
          recognitionStreaks.current[faceIdx] = streak;
          // A lone disagreeing check keeps showing the previously
          // confirmed label instead of flickering to this one -- it only
          // takes over once it's repeated enough to be a real change,
          // not a one-frame fluctuation near the match threshold.
          if (shouldApplyRecognitionResult(streak, hasConfirmedLabel())) {
            setRecognizedNames((prev) => ({ ...prev, [faceIdx]: rawLabel }));
          }
        }
      } catch (err) {
        console.error("[FaceVision] Recognition failed:", err);
        if (!hasConfirmedLabel()) {
          setRecognizedNames((prev) => {
            const next = { ...prev };
            delete next[faceIdx];
            return next;
          });
        }
        if (!silent) {
          // Only ever show the raw error message for our own, deliberately
          // worded error types. Anything else (e.g. an internal ONNX
          // Runtime failure) surfaces as a minified, unreadable string --
          // show a plain message instead and leave the real detail in the
          // console for debugging.
          const detail =
            err instanceof EmbeddingError || err instanceof FacePipelineError
              ? err.message
              : "an unexpected error — see the browser console for details";
          setStatus(`Recognition failed — ${detail}.`);
        }
      } finally {
        recognizeThrottle.current.inFlight.delete(faceIdx);
        if (!silent) setGalleryBusy(false);
      }
    },
    [prepareEmbedder]
  );

  const deleteGalleryEntry = useCallback(
    async (entryId: number) => {
      setGalleryBusy(true);
      try {
        await api.deleteGalleryEntry(entryId);
        await refreshGallery();
      } finally {
        setGalleryBusy(false);
      }
    },
    [refreshGallery]
  );

  const renameGalleryEntry = useCallback(
    async (entryId: number, currentName: string) => {
      const nextName = window.prompt("Rename this identity to:", currentName);
      if (!nextName || !nextName.trim() || nextName.trim() === currentName) return;
      setGalleryBusy(true);
      try {
        const updated = await api.renameGalleryEntry(entryId, nextName.trim());
        if (updated) {
          setStatus(`Renamed "${currentName}" to "${updated.name}".`);
          await refreshGallery();
        } else {
          setStatus("Rename failed — backend unavailable or rejected the request.");
        }
      } finally {
        setGalleryBusy(false);
      }
    },
    [refreshGallery]
  );

  const detectImage = useCallback(
    async (url: string, confidence: number, nms: number) => {
      const image = await loadImage(url);
      lastSource.current = image;
      if (!(await prepareDetector())) return;
      setProcessing(true);
      setStatus("Scanning locally — your image never leaves this device.");
      try {
        const { faces: found, quality } = await runDetectionPipeline(
          detector.current!,
          image,
          image.naturalWidth,
          image.naturalHeight,
          {
            confidenceThreshold: confidence,
            nmsThreshold: nms,
            // Pixel-based blur/lighting checks cost an extra canvas crop —
            // affordable for one upload-mode detection, not for every
            // camera frame (see the camera-mode call below, which omits this).
            enablePixelQualityChecks: true,
          }
        );
        refreshEngine();
        draw(
          image,
          image.naturalWidth,
          image.naturalHeight,
          found,
          selectedFaceIdx
        );
        setFaces(found);
        setRecognizedNames({});
        recognizeThrottle.current = { lastCheckedAt: {}, inFlight: new Set() };
        recognitionStreaks.current = {};
        setAntiSpoofResults({});
        persistCurrent(found);
        // A shown face should always end up labeled "Recognized" or "Not
        // registered" without the user having to click anything -- one
        // auto-check per detected face is affordable here since upload
        // detection runs once per image, not on a repeating timer.
        found.forEach((face, idx) => {
          void runRecognitionCheck(face, idx, { silent: true });
        });
        if (!found.length) {
          setStatus(`No faces detected (${quality.detail})`);
        } else if (quality.code !== "OK") {
          setStatus(
            `${found.length} face${found.length === 1 ? "" : "s"} detected — ${quality.detail}`
          );
        } else {
          setStatus(`${found.length} face${found.length === 1 ? "" : "s"} detected.`);
        }
      } catch (err) {
        console.error("[FaceVision] Image detection failed:", err);
        if (err instanceof FacePipelineError) {
          setStatus(err.message);
          return;
        }
        const detail = err instanceof Error ? err.message : String(err);
        setStatus(`Detection failed — ${detail}. Try another image or refresh the page.`);
      } finally {
        setProcessing(false);
      }
    },
    [draw, prepareDetector, refreshEngine, persistCurrent, selectedFaceIdx, runRecognitionCheck]
  );

  const selectFile = useCallback(
    async (file?: File) => {
      if (!file) return;
      const error = validateImage(file);
      if (error) {
        setStatus(error);
        return;
      }
      const signatureError = await validateImageSignature(file);
      if (signatureError) {
        setStatus(signatureError);
        return;
      }
      if (preview) URL.revokeObjectURL(preview);
      const url = URL.createObjectURL(file);
      setPreview(url);
      setFaces([]);
      await detectImage(url, confidenceSlider, nmsSlider);
    },
    [detectImage, preview, confidenceSlider, nmsSlider]
  );

  const stopCamera = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLivenessSignal(null);
  }, []);

  const startCamera = useCallback(
    async (confidence: number, nms: number) => {
      if (!(await prepareDetector())) return;
      try {
        stopCamera();
        stream.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!video.current) return;
        video.current.srcObject = stream.current;
        await video.current.play();
        setStatus("Camera is live. Processing happens only in your browser.");
        cameraLiveness.current.reset();
        setLivenessSignal(null);
        let busy = false;
        let cameraFailures = 0;
        let lastPersistAt = 0;
        const scan = async () => {
          const element = video.current;
          if (element && element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !busy) {
            busy = true;
            // Detection is async (real ONNX inference latency, tens to
            // hundreds of ms) — the live <video> element keeps playing
            // during that await, so sampling it a second time for draw()
            // captures a NEWER frame than the one detect() just analyzed.
            // For any moving face this shows up as the box trailing behind
            // reality — reported as the frame looking "deviated" from the
            // face even though the detection math itself is correct (the
            // box is exactly right for the frame it was computed from,
            // just not the frame drawn a beat later). Snapshot once per
            // tick into a reused offscreen canvas so detect() and draw()
            // both operate on the identical, frozen frame.
            const videoWidth = element.videoWidth;
            const videoHeight = element.videoHeight;
            if (!cameraSnapshot.current) cameraSnapshot.current = document.createElement("canvas");
            const snapshot = cameraSnapshot.current;
            snapshot.width = videoWidth;
            snapshot.height = videoHeight;
            const snapshotContext = snapshot.getContext("2d");
            if (!snapshotContext) {
              busy = false;
              frame.current = requestAnimationFrame(scan);
              return;
            }
            snapshotContext.drawImage(element, 0, 0, videoWidth, videoHeight);
            lastSource.current = snapshot;
            try {
              const { faces: found, liveness } = await runDetectionPipeline(
                detector.current!,
                snapshot,
                videoWidth,
                videoHeight,
                {
                  confidenceThreshold: confidence,
                  nmsThreshold: nms,
                  livenessHeuristic: cameraLiveness.current,
                }
              );
              if (liveness) setLivenessSignal(liveness.signal);
              cameraFailures = 0;
              draw(
                snapshot,
                videoWidth,
                videoHeight,
                found,
                selectedFaceIdx
              );
              setFaces(found);
              refreshEngine();
              const now = Date.now();
              // Live camera mode: re-check each visible face on a throttle
              // (see shouldAutoRecognize) rather than every tick, so a face
              // that stays on screen gets labeled without hammering the
              // backend at animation-frame rate.
              found.forEach((face, idx) => {
                const throttleState = recognizeThrottle.current;
                if (shouldAutoRecognize(now, throttleState.lastCheckedAt[idx], throttleState.inFlight.has(idx))) {
                  void runRecognitionCheck(face, idx, { silent: true });
                }
              });
              if (found.length > 0 && now - lastPersistAt > 5000) {
                persistCurrent(found);
                lastPersistAt = now;
              }
            } catch (err) {
              cameraFailures += 1;
              console.warn("[FaceVision] Camera frame error:", err);
              if (cameraFailures >= 5) {
                const detail = err instanceof Error ? err.message : String(err);
                setStatus(`Camera detection paused — ${detail}. Reconnect camera or refresh.`);
              }
            } finally {
              busy = false;
            }
          }
          frame.current = requestAnimationFrame(scan);
        };
        scan();
      } catch (err) {
        console.error("[FaceVision] Camera access error:", err);
        const detail = err instanceof Error ? err.message : String(err);
        if (detail.toLowerCase().includes("permission") || detail.toLowerCase().includes("denied")) {
          setStatus("Camera access was blocked. Allow permission and try again.");
        } else {
          setStatus(`Camera could not start — ${detail}.`);
        }
      }
    },
    [draw, prepareDetector, refreshEngine, stopCamera, persistCurrent, selectedFaceIdx, runRecognitionCheck]
  );

  useEffect(() => () => {
    stopCamera();
    if (preview) URL.revokeObjectURL(preview);
  }, [preview, stopCamera]);

  function changeMode(next: DetectionMode) {
    setMode(next);
    setFaces([]);
    setSelectedFaceIdx(null);
    if (next === "upload") stopCamera();
    else void startCamera(confidenceSlider, nmsSlider);
  }
  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    void selectFile(event.dataTransfer.files[0]);
  }
  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void selectFile(event.target.files?.[0]);
  }
  function onConfidenceChange(event: ChangeEvent<HTMLInputElement>) {
    const value = Number(event.target.value);
    setConfidenceSlider(value);
    if (preview && mode === "upload") void detectImage(preview, value, nmsSlider);
    if (mode === "camera") {
      stopCamera();
      void startCamera(value, nmsSlider);
    }
  }
  function onNmsChange(event: ChangeEvent<HTMLInputElement>) {
    const value = Number(event.target.value);
    setNmsSlider(value);
    if (preview && mode === "upload") void detectImage(preview, confidenceSlider, value);
    if (mode === "camera") {
      stopCamera();
      void startCamera(confidenceSlider, value);
    }
  }

  function exportCanvas() {
    const url = canvas.current?.toDataURL("image/png");
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `facevision-${Date.now()}.png`;
    a.click();
  }


  async function loadFromHistory(rec: DetectionRecord) {
    setPanel("workspace");
    setMode("upload");
    stopCamera();
    setFaces(rec.faces);
    if (rec.imageDataUrl) {
      const img = await loadImage(rec.imageDataUrl);
      setPreview(rec.imageDataUrl);
      draw(img, img.naturalWidth, img.naturalHeight, rec.faces, selectedFaceIdx);
    }
    setStatus(`Loaded detection from ${new Date(rec.timestamp).toLocaleString()} · ${rec.faceCount} face(s).`);
  }

  function clearAllHistory() {
    clearLocalHistory();
    if (apiAvailable) void api.clearHistory();
    setHistory([]);
    setStats(getLocalStats());
  }

  async function refreshRemoteStats() {
    if (!apiAvailable) {
      setStats(getLocalStats());
      return;
    }
    const r = await api.getStats();
    if (r) setStats(r);
    else setStats(getLocalStats());
  }

  if (!authChecked) {
    return (
      <main className="auth-checking">
        <p>Checking your session…</p>
      </main>
    );
  }

  return (
    <div className="shell">
      <header>
        <a className="brand" href="#top">
          <span>◉</span> FaceVision
        </a>
        <p>Private face detection, entirely in your browser.</p>
        <div className="header-right">
          <div className="privacy">
            {apiAvailable ? "● API synced" : "○ Local-only mode"}
          </div>
          <button className="ghost-btn" onClick={openAccountModal}>
            {authSession?.user.displayName || authSession?.user.email || "Account"}
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">ON-DEVICE COMPUTER VISION</p>
          <h1>
            See the signal.<br />
            <em>Keep the privacy.</em>
          </h1>
          <p className="lede">
            Detect and recognize faces in your photos or live camera feed with a fast, local
            YuNet model. Save history and inspect detection statistics.
          </p>
        </div>
        <div className="stat">
          <strong>{faces.length}</strong>
          <span>faces detected</span>
          <small>
            {runtime === "ready"
              ? `${engine} acceleration active`
              : "Model loads when needed"}
          </small>
          {mode === "camera" && livenessSignal && (
            <small title="Heuristic signal only — not certified anti-spoofing">
              Liveness: {livenessSignal.replace(/_/g, " ")}
            </small>
          )}
        </div>
      </section>

      <nav className="panel-tabs">
        {(
          [
            ["workspace", "Workspace"],
            ["history", "History"],
            ["stats", "Stats"],
            ["gallery", "Gallery"],
            ["settings", "Settings"],
          ] as [PanelTab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            className={panel === k ? "active" : ""}
            onClick={() => {
              setPanel(k);
              if (k === "stats") void refreshRemoteStats();
              if (k === "gallery") void refreshGallery();
              if (k === "history") {
                setHistory(getLocalHistory());
                if (apiAvailable) void api.listHistory(50, 0).then((r) => {
                  if (r && r.items.length > 0) {
                    const merged = new Map<string, DetectionRecord>();
                    getLocalHistory().forEach((x) => merged.set(x.id, x));
                  }
                });
              }
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {panel === "workspace" && (
        <section className="workspace">
          <div className="toolbar">
            <div className="tabs">
              <button className={mode === "upload" ? "active" : ""} onClick={() => changeMode("upload")}>
                Upload image
              </button>
              <button className={mode === "camera" ? "active" : ""} onClick={() => changeMode("camera")}>
                Live camera
              </button>
            </div>
            <div className="sliders">
              <div className="slider-group">
                <label>
                  Confidence <span>{Math.round(confidenceSlider * 100)}%</span>
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="0.99"
                  step="0.01"
                  value={confidenceSlider}
                  onChange={onConfidenceChange}
                  className="mint-slider"
                />
              </div>
              <div className="slider-group">
                <label>
                  NMS IoU <span>{Math.round(nmsSlider * 100)}%</span>
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.01"
                  value={nmsSlider}
                  onChange={onNmsChange}
                  className="mint-slider"
                />
              </div>
            </div>
            <div className="toolbar-actions">
              <button
                className="ghost-btn"
                onClick={exportCanvas}
                disabled={!preview && mode !== "camera"}
                title="Export annotated image"
              >
                ⬇ Export
              </button>
              <span className={`runtime ${runtime}`}>
                {runtime === "loading"
                  ? "Preparing model"
                  : runtime === "ready"
                    ? engine
                    : runtime === "error"
                      ? "Model error"
                      : "Ready when you are"}
              </span>
            </div>
          </div>

          <div className="stage">
            {mode === "upload" && !preview && (
              <label
                className="dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
              >
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFileChange} />
                <span className="upload-icon">↑</span>
                <strong>Drop an image here</strong>
                <span>or click to browse · JPG, PNG, WebP · up to 12 MB</span>
              </label>
            )}
            {mode === "camera" && <video ref={video} className="source-video" muted playsInline />}
            {preview && mode === "upload" && (
              <img className="preview-image" src={preview} alt="Uploaded image" />
            )}
            {(preview || mode === "camera") && (
              <canvas ref={canvas} className="result-canvas" aria-label="Face detection result" />
            )}
          </div>

          {faces.length > 0 && (
            <div className="faces-grid">
              {faces.map((face, i) => {
                const selected = selectedFaceIdx === i;
                const recognition = recognizedNames[i];
                return (
                  <div
                    key={i}
                    className={`face-card ${selected ? "selected" : ""}`}
                    onClick={() => setSelectedFaceIdx(selected ? null : i)}
                  >
                    <div className="face-card-header">
                      <strong>Face {i + 1}</strong>
                      <span className="conf-badge">{Math.round(face.confidence * 100)}%</span>
                    </div>
                    <div className="face-card-meta">
                      <small>Box: {Math.round(face.box.width)} × {Math.round(face.box.height)}</small>
                      {recognition && (
                        <small className={`recognized-label ${recognition.status}`}>
                          {recognition.status === "matched" && `Recognized: ${recognition.name}`}
                          {recognition.status === "unregistered" && "Not registered"}
                          {recognition.status === "checking" && "Scanning…"}
                        </small>
                      )}
                      {antiSpoofResults[i] && (
                        <small className={`liveness-label ${antiSpoofResults[i].label}`}>
                          Liveness: {antiSpoofResults[i].label} ({Math.round(antiSpoofResults[i].confidence * 100)}%)
                        </small>
                      )}
                    </div>
                    <div className="face-card-actions">
                      {mode !== "camera" && (
                        <button
                          className="chip chip-enroll"
                          disabled={galleryBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEnrollModal(face);
                          }}
                        >
                          Enroll
                        </button>
                      )}
                      <button
                        className="chip chip-recognize"
                        disabled={galleryBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void runRecognitionCheck(face, i, { silent: false });
                        }}
                      >
                        Recognize
                      </button>
                      <button
                        className="chip chip-liveness"
                        disabled={galleryBusy}
                        title="Real anti-spoofing model check — not certified, see docs"
                        onClick={(e) => {
                          e.stopPropagation();
                          void checkFaceLiveness(face, i);
                        }}
                      >
                        Check Liveness
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="status">
            <span className={processing ? "pulse" : "dot"}></span>
            {status}
          </div>
        </section>
      )}

      {panel === "history" && (
        <section className="workspace panel-content">
          <div className="panel-header">
            <h3>Detection history</h3>
            <div>
              <button className="ghost-btn" onClick={() => setHistory(getLocalHistory())}>
                ↻ Refresh
              </button>{" "}
              <button className="danger-btn" onClick={clearAllHistory} disabled={history.length === 0}>
                Clear all
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <div className="empty-state">
              <p>No detection history yet.</p>
              <small>Run detections from the Workspace to build history (disable in Settings).</small>
            </div>
          ) : (
            <div className="history-list">
              {history.map((rec) => (
                <button key={rec.id} className="history-item" onClick={() => loadFromHistory(rec)}>
                  {rec.imageDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={rec.imageDataUrl} alt="" className="history-thumb" />
                  ) : (
                    <div className="history-thumb placeholder">{rec.mode === "camera" ? "📹" : "🖼"}</div>
                  )}
                  <div className="history-body">
                    <div className="history-title">
                      <strong>{rec.faceCount} face{rec.faceCount !== 1 ? "s" : ""}</strong>
                      <span className={`history-mode ${rec.mode}`}>{rec.mode}</span>
                    </div>
                    <small>{new Date(rec.timestamp).toLocaleString()}</small>
                    <small className="muted">
                      Avg confidence: {Math.round(rec.averageConfidence * 100)}%
                      {rec.imageName ? ` · ${rec.imageName}` : ""}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {panel === "stats" && (
        <section className="workspace panel-content">
          <div className="panel-header">
            <h3>Detection statistics</h3>
            <button className="ghost-btn" onClick={refreshRemoteStats}>↻ Refresh</button>
          </div>
          {!stats ? (
            <div className="empty-state"><p>No statistics available yet.</p></div>
          ) : (
            <div className="stats-grid">
              <div className="stat-card">
                <h4>Total detections</h4>
                <p className="big">{stats.totalDetections}</p>
              </div>
              <div className="stat-card">
                <h4>Faces detected</h4>
                <p className="big">{stats.totalFacesDetected}</p>
              </div>
              <div className="stat-card">
                <h4>Avg confidence</h4>
                <p className="big">{Math.round(stats.avgConfidence * 100)}%</p>
              </div>
              <div className="stat-card">
                <h4>Top mode</h4>
                <p className="big">{stats.topMode === "upload" ? "🖼 Upload" : stats.topMode === "camera" ? "📹 Camera" : "—"}</p>
              </div>
            </div>
          )}
          {stats && stats.detectionHistory.length > 0 && (
            <div className="chart-wrap">
              <h4>Faces per day</h4>
              <div className="bar-chart">
                {stats.detectionHistory.map((row) => {
                  const max = Math.max(1, ...stats.detectionHistory.map((r) => r.count));
                  const h = (row.count / max) * 100;
                  return (
                    <div key={row.day} className="bar-col">
                      <div className="bar" style={{ height: `${h}%` }} title={`${row.count} faces`}>
                        <span>{row.count}</span>
                      </div>
                      <small>{row.day.slice(5)}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}


      {panel === "gallery" && (
        <section className="workspace panel-content">
          <div className="panel-header">
            <h3>Identity gallery</h3>
            <button className="ghost-btn" onClick={() => void refreshGallery()}>↻ Refresh</button>
          </div>
          <p className="lede">
            Enroll and recognize faces using SFace — a real trained embedding model. A small
            reference photo is stored alongside each identity so you can tell them apart at a
            glance.{" "}
            <small className="muted">
              Model: {embedderStatus === "ready" ? "loaded" : embedderStatus === "loading" ? "loading…" : "not loaded yet"}
            </small>
          </p>
          {!apiAvailable && (
            <div className="empty-state">
              <p>Backend unavailable — the gallery requires the optional FastAPI backend to be running.</p>
            </div>
          )}
          <div className="empty-state">
            <p>Go to Workspace → detect a face → click &quot;Enroll&quot; on a face card to name it.</p>
            <small>Click &quot;Recognize&quot; on any detected face to check it against enrolled identities.</small>
          </div>
          {galleryEntries.length === 0 ? (
            <div className="empty-state">
              <p>No enrolled identities yet.</p>
            </div>
          ) : (
            <div className="history-list">
              {galleryEntries.map((entry) => (
                <div key={entry.id} className="history-item gallery-entry">
                  {entry.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.image} alt="" className="history-thumb" />
                  ) : (
                    <div className="history-thumb placeholder">👤</div>
                  )}
                  <div className="history-body">
                    <div className="history-title">
                      <strong>{entry.name}</strong>
                      <span className="history-mode upload">
                        {entry.sampleCount} sample{entry.sampleCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <small className="muted">Enrolled {new Date(entry.createdAt).toLocaleString()}</small>
                  </div>
                  <div className="gallery-entry-actions">
                    <button
                      className="ghost-btn"
                      disabled={galleryBusy}
                      onClick={() => void renameGalleryEntry(entry.id, entry.name)}
                    >
                      Rename
                    </button>
                    <button
                      className="danger-btn"
                      disabled={galleryBusy}
                      onClick={() => void deleteGalleryEntry(entry.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {panel === "settings" && (
        <section className="workspace panel-content">
          <div className="panel-header">
            <h3>Settings</h3>
            <button className="ghost-btn" onClick={() => setSettings(DEFAULT_SETTINGS)}>Reset defaults</button>
          </div>
          <div className="settings-grid">
            <label className="setting-row">
              <div>
                <strong>Save detection history</strong>
                <small>Store recent detections (up to 100) locally and sync with the backend when available.</small>
              </div>
              <input
                type="checkbox"
                checked={settings.saveHistory}
                onChange={(e) => setSettings({ ...settings, saveHistory: e.target.checked })}
              />
            </label>
            <label className="setting-row">
              <div>
                <strong>Show confidence labels on frames</strong>
                <small>Display the detection confidence percentage above each face box.</small>
              </div>
              <input
                type="checkbox"
                checked={settings.showConfidenceLabel}
                onChange={(e) => setSettings({ ...settings, showConfidenceLabel: e.target.checked })}
              />
            </label>
            <label className="setting-row">
              <div>
                <strong>Show face landmarks</strong>
                <small>Draw the 5 key points (eyes, nose, mouth corners) and connective lines.</small>
              </div>
              <input
                type="checkbox"
                checked={settings.showLandmarks}
                onChange={(e) => setSettings({ ...settings, showLandmarks: e.target.checked })}
              />
            </label>
            <div className="setting-row">
              <div>
                <strong>Frame color</strong>
                <small>Color for the face bounding box.</small>
              </div>
              <input
                type="color"
                value={settings.frameColor}
                onChange={(e) => setSettings({ ...settings, frameColor: e.target.value })}
              />
            </div>
            <div className="setting-row">
              <div>
                <strong>Landmark color</strong>
                <small>Color for the face landmark dots and lines.</small>
              </div>
              <input
                type="color"
                value={settings.landmarkColor}
                onChange={(e) => setSettings({ ...settings, landmarkColor: e.target.value })}
              />
            </div>
          </div>
          <div className="panel-header small">
            <h4>About</h4>
          </div>
          <div className="about-box">
            <p>
              <strong>FaceVision</strong> runs the YuNet face detector (ONNX) in your browser with
              WebGPU acceleration (fallback to WASM). Detection is performed on-device — your
              images never leave your device by default.
            </p>
            <p className="muted small">
              The FastAPI backend stores <em>metadata only</em>: bounding boxes, confidence, and
              landmark geometry. It never receives your image pixels unless you explicitly enable
              image snapshots in a future version.
            </p>
          </div>
        </section>
      )}

      <footer>
        <span>Built for privacy-first vision.</span>
        <span>YuNet · ONNX Runtime Web · {engine || "WebGPU / WASM"}</span>
      </footer>

      {authModalOpen && authSession && (
        <div className="modal-overlay" onClick={closeAuthModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header small">
              <h4>Account</h4>
              <button className="ghost-btn" onClick={closeAuthModal}>Close</button>
            </div>

            <div className="auth-account">
              <p>
                Signed in as <strong>{authSession.user.email}</strong>
                {authSession.user.displayName ? ` (${authSession.user.displayName})` : ""}.
              </p>
              <p className="muted small">
                Gallery enrollments you make now are tied to this account instead of an anonymous
                browser session.
              </p>
              {!deleteConfirmOpen ? (
                <div className="modal-actions">
                  <button className="ghost-btn" onClick={logOut}>Log out</button>
                  <button className="danger-btn" onClick={() => setDeleteConfirmOpen(true)}>
                    Delete account
                  </button>
                </div>
              ) : (
                <div className="auth-form">
                  <p className="small">
                    This permanently deletes your account and every gallery identity enrolled under
                    it. Enter your password to confirm.
                  </p>
                  <input
                    type="password"
                    placeholder="Password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                  />
                  {authError && <p className="auth-error">{authError}</p>}
                  <div className="modal-actions">
                    <button className="ghost-btn" onClick={() => setDeleteConfirmOpen(false)} disabled={authBusy}>
                      Cancel
                    </button>
                    <button className="danger-btn" onClick={confirmDeleteAccount} disabled={authBusy}>
                      {authBusy ? "Deleting…" : "Permanently delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {enrollTarget && (
        <div className="modal-overlay" onClick={closeEnrollModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header small">
              <h4>Enroll this face</h4>
              <button className="ghost-btn" onClick={closeEnrollModal}>Close</button>
            </div>

            <div className="auth-form">
              <input
                type="text"
                placeholder="Name"
                autoFocus
                value={enrollNameInput}
                onChange={(e) => setEnrollNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void confirmEnroll()}
                disabled={galleryBusy}
              />
              {enrollModalError && <p className="auth-error">{enrollModalError}</p>}
              <div className="modal-actions">
                <button className="ghost-btn" onClick={closeEnrollModal} disabled={galleryBusy}>
                  Cancel
                </button>
                <button className="primary-btn" onClick={confirmEnroll} disabled={galleryBusy}>
                  {galleryBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

{/* v1 */}
{/* v2 */}
{/* v3 */}
