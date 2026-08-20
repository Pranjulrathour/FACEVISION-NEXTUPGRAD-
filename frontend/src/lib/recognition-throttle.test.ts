import { describe, expect, it } from "vitest";
import { RECOGNIZE_THROTTLE_MS, shouldAutoRecognize } from "./recognition-throttle";

describe("shouldAutoRecognize", () => {
  it("allows the first check for a slot that has never been checked", () => {
    expect(shouldAutoRecognize(10_000, undefined, false)).toBe(true);
  });

  it("blocks a re-check before the throttle window elapses", () => {
    const now = 10_000;
    const lastCheckedAt = now - (RECOGNIZE_THROTTLE_MS - 1);
    expect(shouldAutoRecognize(now, lastCheckedAt, false)).toBe(false);
  });

  it("allows a re-check once the throttle window has fully elapsed", () => {
    const now = 10_000;
    const lastCheckedAt = now - RECOGNIZE_THROTTLE_MS;
    expect(shouldAutoRecognize(now, lastCheckedAt, false)).toBe(true);
  });

  it("blocks a check while one is already in flight, regardless of timing", () => {
    expect(shouldAutoRecognize(10_000, undefined, true)).toBe(false);
  });

  it("honors a custom throttle window", () => {
    expect(shouldAutoRecognize(1000, 500, false, 400)).toBe(true);
    expect(shouldAutoRecognize(1000, 700, false, 400)).toBe(false);
  });
});
