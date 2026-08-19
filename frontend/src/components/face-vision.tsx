"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Face,
  RuntimeState,
  DetectionMode,
  DetectionRecord,
  FaceMatchResult,
  StatsSummary,
  AppSettings,
  GalleryEntry,
} from "@/lib/face-types";
import { loadImage, validateImage, validateImageSignature } from "@/lib/image";
import { YuNetDetector } from "@/lib/yunet";
import { SFaceEmbedder } from "@/lib/sface";
import { MiniFASNetClassifier } from "@/lib/minifasnet";
import { deepEqualFace } from "@/lib/face-math";
import {
  runDetectionPipeline,
  matchFaces,
  embedFace,
  checkLiveness,
  FacePipelineError,
} from "@/lib/face-pipeline";
import { LivenessHeuristic } from "@/lib/liveness";
import {
  saveDetection as saveLocal,
  getHistory as getLocalHistory,
  clearHistory as clearLocalHistory,
  getSettings,
  saveSettings,
  getStats as getLocalStats,
} from "@/lib/storage";
import { api } from "@/lib/api-client";
import type { PanelTab } from "@/lib/panel-types";

const DEFAULT_SETTINGS: AppSettings = {
  saveHistory: true,
  autoDetect: true,
  showLandmarks: true,
  showConfidenceLabel: true,
  frameColor: "#55f3b0",
  landmarkColor: "#ffd93d",
  compareThreshold: 0.78,
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
  const detector = useRef<YuNetDetector | null>(null);
  const embedder = useRef<SFaceEmbedder | null>(null);
  const antiSpoof = useRef<MiniFASNetClassifier | null>(null);
  const lastSource = useRef<HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null>(null);
  const cameraLiveness = useRef<LivenessHeuristic>(new LivenessHeuristic());
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
  const [status, setStatus] = useState("Choose an image or start your camera.");
  const [faces, setFaces] = useState<Face[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [confidenceSlider, setConfidenceSlider] = useState(0.75);
  const [nmsSlider, setNmsSlider] = useState(0.35);

  const [panel, setPanel] = useState<PanelTab>("workspace");
  const [settings, setSettings] = useState<AppSettings>(() => getSettings());
  const [history, setHistory] = useState<DetectionRecord[]>(() => getLocalHistory());
  const [stats, setStats] = useState<StatsSummary | null>(() => getLocalStats());
  const [compareSlots, setCompareSlots] = useState<[Face | null, Face | null]>([null, null]);
  const [compareResult, setCompareResult] = useState<FaceMatchResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [selectedFaceIdx, setSelectedFaceIdx] = useState<number | null>(null);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [embedderStatus, setEmbedderStatus] = useState<RuntimeState>("idle");
  const [antiSpoofStatus, setAntiSpoofStatus] = useState<RuntimeState>("idle");
  const [antiSpoofResults, setAntiSpoofResults] = useState<Record<number, { label: string; confidence: number }>>({});
  const [galleryEntries, setGalleryEntries] = useState<GalleryEntry[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [recognizedNames, setRecognizedNames] = useState<Record<number, string>>({});

  useEffect(() => {
    void api.health().then((r) => setApiAvailable(!!r && r.status === "ok"));
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

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
      highlightIndex: number | null = null,
      slotIndices: [number | null, number | null] = [null, null]
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
        const isCompareA = slotIndices[0] === i;
        const isCompareB = slotIndices[1] === i;
        const isHighlight = highlightIndex === i;
        let stroke = settings.frameColor;
        let fillAlpha = 0.14;
        if (isCompareA) {
          stroke = "#3db4ff";
          fillAlpha = 0.22;
        } else if (isCompareB) {
          stroke = "#ff7bd1";
          fillAlpha = 0.22;
        } else if (isHighlight) {
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
          face.box,
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

  const refreshGallery = useCallback(async () => {
    const result = await api.listGallery();
    if (result) setGalleryEntries(result.items);
  }, []);

  const enrollFace = useCallback(
    async (face: Face) => {
      if (!lastSource.current) {
        setStatus("Run a detection first, then enroll a face.");
        return;
      }
      const name = window.prompt("Enroll this face as (name):");
      if (!name || !name.trim()) return;
      if (!(await prepareEmbedder())) return;
      setGalleryBusy(true);
      try {
        const vector = await embedFace(embedder.current!, lastSource.current, face.landmarks);
        const entry = await api.enrollFace(name.trim(), vector, embedder.current!.modelVersion);
        if (entry) {
          setStatus(`Enrolled "${name.trim()}" (${entry.sampleCount} sample${entry.sampleCount === 1 ? "" : "s"}).`);
          await refreshGallery();
        } else {
          setStatus("Enrollment failed — backend unavailable or rejected the request.");
        }
      } catch (err) {
        console.error("[FaceVision] Enrollment failed:", err);
        const detail = err instanceof Error ? err.message : String(err);
        setStatus(`Enrollment failed — ${detail}.`);
      } finally {
        setGalleryBusy(false);
      }
    },
    [prepareEmbedder, refreshGallery]
  );

  const recognizeFace = useCallback(
    async (face: Face, faceIdx: number) => {
      if (!lastSource.current) return;
      if (!(await prepareEmbedder())) return;
      setGalleryBusy(true);
      try {
        const vector = await embedFace(embedder.current!, lastSource.current, face.landmarks);
        const result = await api.recognizeFace(vector);
        if (result?.matched && result.name) {
          setRecognizedNames((prev) => ({ ...prev, [faceIdx]: result.name! }));
          setStatus(`Recognized as "${result.name}" (${Math.round(result.similarity * 100)}% similarity).`);
        } else {
          setStatus("No match found in the gallery for this face.");
        }
      } catch (err) {
        console.error("[FaceVision] Recognition failed:", err);
        const detail = err instanceof Error ? err.message : String(err);
        setStatus(`Recognition failed — ${detail}.`);
      } finally {
        setGalleryBusy(false);
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

  const slotIndices = useMemo<[number | null, number | null]>(() => {
    const aIdx = compareSlots[0] ? faces.findIndex((f) => deepEqualFace(f, compareSlots[0]!)) : -1;
    const bIdx = compareSlots[1] ? faces.findIndex((f) => deepEqualFace(f, compareSlots[1]!)) : -1;
    return [aIdx >= 0 ? aIdx : null, bIdx >= 0 ? bIdx : null];
  }, [compareSlots, faces]);

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
          selectedFaceIdx,
          slotIndices
        );
        setFaces(found);
        setRecognizedNames({});
        setAntiSpoofResults({});
        persistCurrent(found);
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
    [draw, prepareDetector, refreshEngine, persistCurrent, selectedFaceIdx, slotIndices]
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
      setCompareSlots([null, null]);
      setCompareResult(null);
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
                selectedFaceIdx,
                slotIndices
              );
              setFaces(found);
              refreshEngine();
              const now = Date.now();
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
    [draw, prepareDetector, refreshEngine, stopCamera, persistCurrent, selectedFaceIdx, slotIndices]
  );

  useEffect(() => () => {
    stopCamera();
    if (preview) URL.revokeObjectURL(preview);
  }, [preview, stopCamera]);

  function changeMode(next: DetectionMode) {
    setMode(next);
    setFaces([]);
    setCompareSlots([null, null]);
    setCompareResult(null);
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

  function pickSlot(slot: 0 | 1, face: Face) {
    const next: [Face | null, Face | null] = [...compareSlots];
    next[slot] = face;
    setCompareSlots(next);
    setCompareResult(null);
  }
  function clearSlot(slot: 0 | 1) {
    const next: [Face | null, Face | null] = [...compareSlots];
    next[slot] = null;
    setCompareSlots(next);
    setCompareResult(null);
  }
  async function runCompare() {
    if (!compareSlots[0] || !compareSlots[1]) return;
    setComparing(true);
    try {
      if (apiAvailable) {
        const res = await api.compareFaces(
          compareSlots[0],
          compareSlots[1],
          settings.compareThreshold
        );
        if (res) setCompareResult(res);
      } else {
        const res = matchFaces(compareSlots[0], compareSlots[1], settings.compareThreshold);
        setCompareResult(res);
      }
    } finally {
      setComparing(false);
    }
  }

  async function loadFromHistory(rec: DetectionRecord) {
    setPanel("workspace");
    setMode("upload");
    stopCamera();
    setFaces(rec.faces);
    if (rec.imageDataUrl) {
      const img = await loadImage(rec.imageDataUrl);
      setPreview(rec.imageDataUrl);
      draw(img, img.naturalWidth, img.naturalHeight, rec.faces, selectedFaceIdx, slotIndices);
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

  return (
    <div className="shell">
      <header>
        <a className="brand" href="#top">
          <span>◉</span> FaceVision
        </a>
        <p>Private face detection, entirely in your browser.</p>
        <div className="privacy">
          {apiAvailable ? "● API synced" : "○ Local-only mode"}
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
            Detect faces in your photos or live camera feed with a fast, local YuNet model.
            Save history, compare faces, and inspect detection statistics.
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
            ["compare", "Compare"],
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
                const inA = compareSlots[0] && deepEqualFace(face, compareSlots[0]);
                const inB = compareSlots[1] && deepEqualFace(face, compareSlots[1]);
                return (
                  <div
                    key={i}
                    className={`face-card ${selected ? "selected" : ""} ${inA ? "slot-a" : ""} ${inB ? "slot-b" : ""}`}
                    onClick={() => setSelectedFaceIdx(selected ? null : i)}
                  >
                    <div className="face-card-header">
                      <strong>Face {i + 1}</strong>
                      <span className="conf-badge">{Math.round(face.confidence * 100)}%</span>
                    </div>
                    <div className="face-card-meta">
                      <small>Box: {Math.round(face.box.width)} × {Math.round(face.box.height)}</small>
                      {recognizedNames[i] && (
                        <small className="recognized-label">Recognized: {recognizedNames[i]}</small>
                      )}
                      {antiSpoofResults[i] && (
                        <small className={`liveness-label ${antiSpoofResults[i].label}`}>
                          Liveness: {antiSpoofResults[i].label} ({Math.round(antiSpoofResults[i].confidence * 100)}%)
                        </small>
                      )}
                    </div>
                    <div className="face-card-actions">
                      <button
                        className={`chip chip-a ${inA ? "on" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          inA ? clearSlot(0) : pickSlot(0, face);
                        }}
                      >
                        {inA ? "✓ Slot A" : "+ Compare A"}
                      </button>
                      <button
                        className={`chip chip-b ${inB ? "on" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          inB ? clearSlot(1) : pickSlot(1, face);
                        }}
                      >
                        {inB ? "✓ Slot B" : "+ Compare B"}
                      </button>
                      <button
                        className="chip chip-enroll"
                        disabled={galleryBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void enrollFace(face);
                        }}
                      >
                        Enroll
                      </button>
                      <button
                        className="chip chip-recognize"
                        disabled={galleryBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void recognizeFace(face, i);
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

      {panel === "compare" && (
        <section className="workspace panel-content">
          <div className="panel-header">
            <h3>Face comparison</h3>
            <small className="muted">Pick Slot A + B from Workspace face cards</small>
          </div>
          <div className="compare-row">
            {[0, 1].map((s) => (
              <div key={s} className={`compare-slot slot-${s === 0 ? "a" : "b"}`}>
                <div className="compare-slot-label">
                  Slot {s === 0 ? "A" : "B"}
                </div>
                {compareSlots[s] ? (
                  <div className="compare-summary">
                    <div className="summary-grid">
                      <div><small>Confidence</small><strong>{Math.round(compareSlots[s]!.confidence * 100)}%</strong></div>
                      <div><small>Box size</small><strong>{Math.round(compareSlots[s]!.box.width)} × {Math.round(compareSlots[s]!.box.height)}</strong></div>
                    </div>
                    <LandmarkPreview face={compareSlots[s]!} />
                    <button className="ghost-btn" onClick={() => clearSlot(s as 0 | 1)}>Clear</button>
                  </div>
                ) : (
                  <div className="empty-slot">
                    <p>Empty slot {s === 0 ? "A" : "B"}</p>
                    <small>Go to Workspace → choose a face card → “+ Compare {s === 0 ? "A" : "B"}”.</small>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="compare-actions">
            <button
              className="primary-btn"
              disabled={!compareSlots[0] || !compareSlots[1] || comparing}
              onClick={runCompare}
            >
              {comparing ? "Comparing…" : "Compare faces"}
            </button>
            <label className="inline-slider">
              Threshold: {Math.round(settings.compareThreshold * 100)}%
              <input
                type="range"
                min="0.5"
                max="0.99"
                step="0.01"
                value={settings.compareThreshold}
                onChange={(e) =>
                  setSettings({ ...settings, compareThreshold: Number(e.target.value) })
                }
                className="mint-slider"
              />
            </label>
          </div>
          {compareResult && (
            <div className={`compare-result ${compareResult.isMatch ? "match" : "no-match"}`}>
              <h4>
                {compareResult.isMatch ? "✓ Likely the same person" : "✗ Different people"}
              </h4>
              <div className="similarity-meter">
                <div
                  className="similarity-fill"
                  style={{ width: `${Math.round(compareResult.similarity * 100)}%` }}
                />
              </div>
              <p>
                Similarity: <strong>{Math.round(compareResult.similarity * 100)}%</strong> ·
                threshold {Math.round(compareResult.threshold * 100)}%
              </p>
              <small className="muted">
                Result is derived from landmark geometry (cosine similarity on normalized keypoints).
              </small>
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
            Enroll and recognize faces using SFace — a real trained embedding model, distinct
            from the landmark-geometry similarity used in Compare. Only the embedding vector
            (128 numbers) is ever sent to the backend — never an image.{" "}
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
                  <div className="history-body">
                    <div className="history-title">
                      <strong>{entry.name}</strong>
                      <span className="history-mode upload">
                        {entry.sampleCount} sample{entry.sampleCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <small className="muted">Enrolled {new Date(entry.createdAt).toLocaleString()}</small>
                  </div>
                  <button
                    className="danger-btn"
                    disabled={galleryBusy}
                    onClick={() => void deleteGalleryEntry(entry.id)}
                  >
                    Delete
                  </button>
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
    </div>
  );
}

function LandmarkPreview({ face }: { face: Face }) {
  const size = 140;
  const lm = face.landmarks;
  const pts = [lm.rightEye, lm.leftEye, lm.nose, lm.rightMouth, lm.leftMouth];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs) - 20;
  const minY = Math.min(...ys) - 20;
  const maxX = Math.max(...xs) + 20;
  const maxY = Math.max(...ys) + 20;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const sx = size / w;
  const sy = size / h;
  const norm = pts.map((p) => ({ x: (p.x - minX) * sx, y: (p.y - minY) * sy }));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="lm-preview">
      <rect x="0" y="0" width={size} height={size} rx="10" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
      <polyline
        fill="none"
        stroke="#ffd93d88"
        strokeWidth="1.5"
        points={`${norm[0].x},${norm[0].y} ${norm[2].x},${norm[2].y} ${norm[1].x},${norm[1].y}`}
      />
      <polyline
        fill="none"
        stroke="#ffd93d88"
        strokeWidth="1.5"
        points={`${norm[2].x},${norm[2].y} ${norm[3].x},${norm[3].y} ${norm[4].x},${norm[4].y}`}
      />
      {norm.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#ffd93d" />
      ))}
    </svg>
  );
}
{/* v1 */}
{/* v2 */}
{/* v3 */}
