import { describe, expect, it } from "vitest";
import {
  detectImageFormat,
  formatMatchesDeclaredType,
  readSignatureBytes,
} from "./image-signature";

describe("detectImageFormat", () => {
  it("recognizes a JPEG signature", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(detectImageFormat(bytes)).toBe("jpeg");
  });

  it("recognizes a PNG signature", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectImageFormat(bytes)).toBe("png");
  });

  it("recognizes a WebP signature", () => {
    // RIFF <4-byte size, arbitrary> WEBP
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageFormat(bytes)).toBe("webp");
  });

  it("rejects an executable's signature (MZ header) even if renamed .jpg", () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(detectImageFormat(bytes)).toBeNull();
  });

  it("rejects a GIF signature (not in the supported set)", () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectImageFormat(bytes)).toBeNull();
  });

  it("rejects a RIFF file that isn't actually WEBP (e.g. a WAV file)", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(detectImageFormat(bytes)).toBeNull();
  });

  it("rejects a buffer too short to contain any known signature", () => {
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectImageFormat(new Uint8Array([]))).toBeNull();
  });
});

describe("formatMatchesDeclaredType", () => {
  it("accepts matching format/MIME pairs", () => {
    expect(formatMatchesDeclaredType("jpeg", "image/jpeg")).toBe(true);
    expect(formatMatchesDeclaredType("png", "image/png")).toBe(true);
    expect(formatMatchesDeclaredType("webp", "image/webp")).toBe(true);
  });

  it("is case-insensitive on the declared MIME type", () => {
    expect(formatMatchesDeclaredType("png", "IMAGE/PNG")).toBe(true);
  });

  it("flags a PNG file that claims to be a JPEG", () => {
    expect(formatMatchesDeclaredType("png", "image/jpeg")).toBe(false);
  });
});

describe("readSignatureBytes", () => {
  it("reads only the leading bytes, not the whole file", async () => {
    const bigContent = new Uint8Array(1_000_000).fill(0x41);
    bigContent.set([0xff, 0xd8, 0xff], 0);
    const file = new File([bigContent], "big.jpg", { type: "image/jpeg" });

    const bytes = await readSignatureBytes(file);

    expect(bytes.length).toBeLessThanOrEqual(12);
    expect(detectImageFormat(bytes)).toBe("jpeg");
  });
});
