import { describe, expect, it } from "vitest";
import { runInferenceExclusive } from "./inference-mutex";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("runInferenceExclusive", () => {
  it("resolves with the wrapped function's result", async () => {
    const result = await runInferenceExclusive(async () => 42);
    expect(result).toBe(42);
  });

  it("never overlaps two calls -- the second only starts once the first settles", async () => {
    const events: string[] = [];
    const first = deferred<void>();

    const callA = runInferenceExclusive(async () => {
      events.push("A start");
      await first.promise;
      events.push("A end");
    });
    const callB = runInferenceExclusive(async () => {
      events.push("B start");
    });

    // B must not have started yet -- A hasn't resolved.
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["A start"]);

    first.resolve();
    await Promise.all([callA, callB]);
    expect(events).toEqual(["A start", "A end", "B start"]);
  });

  it("still runs the next call after a previous one rejects", async () => {
    await expect(
      runInferenceExclusive(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    const result = await runInferenceExclusive(async () => "recovered");
    expect(result).toBe("recovered");
  });
});
