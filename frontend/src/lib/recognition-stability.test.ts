import { describe, expect, it } from "vitest";
import {
  nextRecognitionStreak,
  shouldApplyRecognitionResult,
  REQUIRED_CONSECUTIVE_AGREEMENT,
} from "./recognition-stability";

describe("nextRecognitionStreak", () => {
  it("starts a fresh streak at count 1 when there is no previous streak", () => {
    expect(nextRecognitionStreak(undefined, "matched:Alice")).toEqual({ key: "matched:Alice", count: 1 });
  });

  it("extends the streak when the key repeats", () => {
    const first = nextRecognitionStreak(undefined, "matched:Alice");
    const second = nextRecognitionStreak(first, "matched:Alice");
    expect(second).toEqual({ key: "matched:Alice", count: 2 });
  });

  it("restarts the streak at 1 when the key changes", () => {
    const first = nextRecognitionStreak(undefined, "matched:Alice");
    const second = nextRecognitionStreak(first, "unregistered");
    expect(second).toEqual({ key: "unregistered", count: 1 });
  });

  it("treats a different matched name as a different key, not the same as any 'matched' status", () => {
    const first = nextRecognitionStreak(undefined, "matched:Alice");
    const second = nextRecognitionStreak(first, "matched:Bob");
    expect(second).toEqual({ key: "matched:Bob", count: 1 });
  });
});

describe("shouldApplyRecognitionResult", () => {
  it("applies immediately when there is no confirmed label yet, regardless of streak count", () => {
    expect(shouldApplyRecognitionResult({ key: "matched:Alice", count: 1 }, false)).toBe(true);
  });

  it("does not apply a single disagreeing result once a label is confirmed", () => {
    expect(shouldApplyRecognitionResult({ key: "unregistered", count: 1 }, true)).toBe(false);
  });

  it("applies once the streak reaches the required consecutive agreement", () => {
    expect(
      shouldApplyRecognitionResult({ key: "unregistered", count: REQUIRED_CONSECUTIVE_AGREEMENT }, true)
    ).toBe(true);
  });

  it("applies a repeat of the already-confirmed result too (streak just keeps growing)", () => {
    expect(shouldApplyRecognitionResult({ key: "matched:Alice", count: 5 }, true)).toBe(true);
  });
});
