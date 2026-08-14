import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, validateImage } from "./image";

describe("validateImage", () => {
  it("accepts supported image formats within the size limit", () => {
    expect(validateImage(new File(["image"], "portrait.webp", { type: "image/webp" }))).toBeNull();
  });
  it("rejects unsupported formats and oversized files", () => {
    expect(validateImage(new File(["data"], "portrait.gif", { type: "image/gif" }))).toMatch(/JPG/);
    expect(validateImage(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "large.jpg", { type: "image/jpeg" }))).toMatch(/12 MB/);
  });
});
