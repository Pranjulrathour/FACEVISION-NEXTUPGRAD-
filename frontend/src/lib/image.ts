export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function validateImage(file: File): string | null {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) return "Choose a JPG, PNG, or WebP image.";
  if (file.size > MAX_IMAGE_BYTES) return "Image must be 12 MB or smaller.";
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
