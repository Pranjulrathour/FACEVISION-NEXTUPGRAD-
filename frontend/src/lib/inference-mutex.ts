/**
 * Serializes every ONNX Runtime Web inference call in the app --
 * detection, embedding, and liveness classification alike -- behind one
 * shared queue.
 *
 * These are triggered from independent places: a camera loop ticking as
 * fast as detection allows, a periodic auto-recognition timer, and manual
 * button clicks. Different calls can therefore land on the event loop at
 * the same time, and onnxruntime-web's execution providers (WASM's
 * single-threaded runtime, WebGPU's device/session state) aren't
 * guaranteed safe for two concurrent `session.run()` calls -- even across
 * two *different* sessions, since a lot of that state (the wasm module
 * instance, its shared memory, the GPU device) is process-wide, not
 * per-session. Observed failure modes ranged from a cryptic minified
 * null-property crash to the tab hanging outright, instead of a real,
 * catchable error. Routing every inference call through this one queue
 * means only one is ever actually running at a time.
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
