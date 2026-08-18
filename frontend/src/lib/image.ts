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
