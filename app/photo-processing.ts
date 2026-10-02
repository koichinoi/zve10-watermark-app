type Size = { width: number; height: number };
export type EmbeddedJpeg = Size & { start: number; end: number };

export const previewMaxEdge = 1600;
export const previewMaxPixels = 2_000_000;
export const batchMaxBytes = 96 * 1024 * 1024;
export const rawScanChunkBytes = 1024 * 1024;

export function previewSize(width: number, height: number): Size {
  const scale = Math.min(1, previewMaxEdge / Math.max(width, height), Math.sqrt(previewMaxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function validSize(width: number, height: number): Size | null {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    ? { width, height } : null;
}

// Read dimensions without retaining or decoding the complete camera photo.
// A failed sliced read falls back to the browser decoder in the caller.
export async function readRasterSize(file: Blob): Promise<Size | null> {
  try {
    const bytes = new Uint8Array(await file.slice(0, 30).arrayBuffer());
    const view = new DataView(bytes.buffer);
    if (bytes.length >= 24 && bytes.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i])) {
      return validSize(view.getUint32(16), view.getUint32(20));
    }
    const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') {
      if (text(12, 16) === 'VP8X') {
        return validSize(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16));
      }
      if (text(12, 16) === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
        return validSize(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
      }
      if (text(12, 16) === 'VP8L' && bytes[20] === 0x2f) {
        const bits = view.getUint32(21, true);
        return validSize(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
      }
    }
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 4 <= file.size) {
      const segment = new Uint8Array(await file.slice(offset, offset + 12).arrayBuffer());
      if (segment[0] !== 0xff) return null;
      const marker = segment[1];
      if (marker === 0xff) { offset += 1; continue; }
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0xd8 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = (segment[2] << 8) | segment[3];
      if (length < 2 || offset + length + 2 > file.size) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        return validSize((segment[7] << 8) | segment[8], (segment[5] << 8) | segment[6]);
      }
      offset += length + 2;
    }
  } catch { /* Content providers may not support sliced reads. */ }
  return null;
}

// Marker state survives chunk boundaries; only a small part of the ARW is
// resident at once. Candidate JPEGs are decoded later, largest first.
export async function findEmbeddedJpegs(file: Blob): Promise<EmbeddedJpeg[]> {
  const candidates: EmbeddedJpeg[] = [];
  let previous = -1;
  let beforePrevious = -1;
  let start = -1;
  for (let offset = 0; offset < file.size; offset += rawScanChunkBytes) {
    const bytes = new Uint8Array(await file.slice(offset, offset + rawScanChunkBytes).arrayBuffer());
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index];
      if (start < 0 && beforePrevious === 0xff && previous === 0xd8 && byte === 0xff) start = offset + index - 2;
      if (start >= 0 && previous === 0xff && byte === 0xd9) {
        const end = offset + index + 1;
        const size = await readRasterSize(file.slice(start, end));
        if (size) candidates.push({ start, end, ...size });
        start = -1;
      }
      beforePrevious = previous;
      previous = byte;
    }
  }
  return candidates.sort((a, b) => b.width * b.height - a.width * a.height);
}
