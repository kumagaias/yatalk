export const MAX_MENU_IMAGE_BYTES = 4 * 1024 * 1024;

export const MENU_IMAGE_MIME_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
] as const;

export type MenuImageMimeType = typeof MENU_IMAGE_MIME_TYPES[number];

function matches(buffer: Buffer, expected: number[]): boolean {
  return buffer.length >= expected.length && expected.every((value, index) => buffer[index] === value);
}

export function detectMenuImageMimeType(buffer: Buffer): MenuImageMimeType | null {
  if (matches(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (matches(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (buffer.length >= 16 && buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(buffer.toString("ascii", 12, 16))) {
    return "image/webp";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}
