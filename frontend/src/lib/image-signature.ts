/**
 * File-signature ("magic byte") validation — checklist §6.
 *
 * `File.type` and the filename extension are both client-supplied metadata:
 * a renamed `.exe` or a crafted file can claim `image/png` and pass a MIME
 * check while decoding to something else entirely. The only trustworthy
 * signal is the actual leading bytes of the file, so we read and verify
 * them before the file is ever handed to a decoder.
 */

export type DetectedImageFormat = "jpeg" | "png" | "webp";

/** Longest signature we need to inspect (WebP needs 12 bytes: RIFF????WEBP). */
const SIGNATURE_PROBE_BYTES = 12;

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  if (bytes.length < expected.length) return false;
  return expected.every((byte, index) => bytes[index] === byte);
}

/**
 * Identify an image format from its leading bytes, or null if the bytes
 * don't match any format we accept.
 *
 * Exported separately from the File-reading wrapper so the byte-matching
 * logic stays unit-testable without constructing real File/Blob objects.
 */
export function detectImageFormat(bytes: Uint8Array): DetectedImageFormat | null {
  // JPEG: FF D8 FF  (SOI marker + first segment marker)
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";

  // PNG: 89 "PNG" CR LF SUB LF  — the full 8-byte signature, which is
  // deliberately designed to survive/expose text-mode corruption.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";

  // WebP: "RIFF" <4-byte little-endian size> "WEBP"
  // The size field is file-dependent, so bytes 4-7 are skipped rather than matched.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

/** MIME types each detected format is allowed to claim. Used to catch a
 * file whose real format disagrees with its declared Content-Type. */
const FORMAT_TO_MIME: Record<DetectedImageFormat, readonly string[]> = {
  jpeg: ["image/jpeg", "image/jpg"],
  png: ["image/png"],
  webp: ["image/webp"],
};

export function formatMatchesDeclaredType(
  format: DetectedImageFormat,
  declaredType: string
): boolean {
  return FORMAT_TO_MIME[format].includes(declaredType.toLowerCase());
}

/**
 * Read just the leading bytes of a File. Reads a 12-byte slice rather than
 * the whole file so a 12MB upload doesn't get pulled into memory purely to
 * check its header.
 */
export async function readSignatureBytes(file: File): Promise<Uint8Array> {
  const slice = file.slice(0, SIGNATURE_PROBE_BYTES);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}
