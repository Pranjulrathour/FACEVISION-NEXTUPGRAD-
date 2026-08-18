import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, validateDecodedImageDimensions, validateImage } from "./image";

describe("validateImage", () => {
  it("accepts supported image formats within the size limit", () => {
    expect(validateImage(new File(["image"], "portrait.webp", { type: "image/webp" }))).toBeNull();
  });
  it("rejects unsupported formats and oversized files", () => {
    expect(validateImage(new File(["data"], "portrait.gif", { type: "image/gif" }))).toMatch(/JPG/);
    expect(validateImage(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "large.jpg", { type: "image/jpeg" }))).toMatch(/12 MB/);
  });
});

function makeFakeImage(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

describe("validateDecodedImageDimensions", () => {
  it("accepts a normal photo resolution", () => {
    expect(validateDecodedImageDimensions(makeFakeImage(1920, 1080))).toBeNull();
  });

  it("rejects a decompression-bomb-style image (tiny file, huge decoded dimensions)", () => {
    const error = validateDecodedImageDimensions(makeFakeImage(50000, 50000));
    expect(error).toMatch(/too large/);
  });

  it("rejects an image at exactly over the pixel budget", () => {
    // MAX_IMAGE_PIXELS x 1 + 1 extra pixel worth, split across dimensions
    const side = Math.ceil(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
    expect(validateDecodedImageDimensions(makeFakeImage(side, side))).toMatch(/too large/);
  });

  it("rejects a zero-dimension (failed decode) image", () => {
    expect(validateDecodedImageDimensions(makeFakeImage(0, 0))).toMatch(/could not be decoded/);
  });
});
