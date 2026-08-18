import {
  detectImageFormat,
  formatMatchesDeclaredType,
  readSignatureBytes,
} from "./image-signature";

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Guards against decompression-bomb-style files: a tiny file that decodes
// to an enormous bitmap (e.g. a few KB PNG expanding to 50000x50000 px)
// can freeze or crash the tab during canvas/ONNX processing even though it
// passed the byte-size check above. 40 megapixels covers any realistic
// camera/upload photo (e.g. a 8000x5000 shot) while rejecting bomb-style
// dimensions.
export const MAX_IMAGE_PIXELS = 40_000_000;

export function validateImage(file: File): string | null {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) return "Choose a JPG, PNG, or WebP image.";
  if (file.size > MAX_IMAGE_BYTES) return "Image must be 12 MB or smaller.";
  return null;
}

/**
 * Second-stage validation: verify the file's actual leading bytes, not just
 * its declared MIME type (§6). `validateImage()` above only inspects
 * client-supplied metadata, which a renamed or crafted file can lie about.
 *
 * Async because reading bytes off a File requires awaiting a Blob slice —
 * kept separate from the sync checks so callers can fail fast on the cheap
 * checks before touching file contents.
 */
export async function validateImageSignature(file: File): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = await readSignatureBytes(file);
  } catch {
    return "The selected file could not be read.";
  }

  const format = detectImageFormat(bytes);
  if (!format) {
    return "This file isn't a valid JPG, PNG, or WebP image.";
  }
  if (!formatMatchesDeclaredType(format, file.type)) {
    // The file decodes as a real image, but not the type it claimed. Worth
    // rejecting rather than silently accepting: a type/content mismatch is
    // a signal of either a broken upload path or a deliberately crafted file.
    return `This file claims to be ${file.type} but its contents are ${format.toUpperCase()}.`;
  }
  return null;
}

/** Validate decoded image dimensions after loadImage() resolves. Call this
 * before handing the image to the detector — validateImage() alone can't
 * catch a decompression-bomb file since it only inspects file bytes, not
 * decoded pixel dimensions. */
export function validateDecodedImageDimensions(image: HTMLImageElement): string | null {
  const pixels = image.naturalWidth * image.naturalHeight;
  if (pixels <= 0) return "The selected image could not be decoded.";
  if (pixels > MAX_IMAGE_PIXELS) {
    return "This image's dimensions are too large to process safely.";
  }
  return null;
}

export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be decoded."));
    image.src = source;
  });
}
