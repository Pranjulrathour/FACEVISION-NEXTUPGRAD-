/**
 * Serializes onnxruntime-web inference calls that share a wasm runtime.
 *
 * Face detection, embedding, and liveness classification are triggered
 * from independent places -- a camera loop ticking as fast as detection
 * allows, a periodic auto-recognition timer, and manual button clicks --
 * so different calls can land on the event loop at the same time.
 * onnxruntime-web's execution providers aren't guaranteed safe for two
 * concurrent `session.run()` calls, even across *different* sessions,
 * since a lot of that state (the wasm module instance and its shared
 * memory, or a webgpu device/queue) is process-wide, not per-session.
 * Observed failure modes ranged from a cryptic minified null-property
 * crash to the tab hanging outright, instead of a real, catchable error.
 *
 * The embedder and liveness classifier are deliberately wasm-only (see
 * sface.ts/minifasnet.ts) specifically so they never contend with the
 * face detector's own webgpu session -- that GPU-session contention was
 * the actual crash, not a generic "any two models at once" issue. So only
 * calls that end up sharing the *same* wasm runtime need to queue through
 * here; face-pipeline.ts only routes the detector's own detect() call
 * through this queue when the detector itself ended up on wasm too (no
 * webgpu support on that device/browser). A webgpu-backed detector runs
 * unblocked, so the camera preview doesn't freeze every time
 * auto-recognition fires.
 */
let queue: Promise<unknown> = Promise.resolve();

export function runInferenceExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  // Chain off a version that never rejects, so one failed call doesn't
  // permanently wedge every future call behind a rejected promise.
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
