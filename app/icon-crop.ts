export type CropRect = { x: number; y: number; width: number; height: number };
export type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
export const fullCrop: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

export function adjustCrop(rect: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  if (handle === 'move') return { ...rect, x: clamp(rect.x + dx, 0, 1 - rect.width), y: clamp(rect.y + dy, 0, 1 - rect.height) };
  let left = rect.x, top = rect.y, right = left + rect.width, bottom = top + rect.height;
  const minWidth = Math.min(.02, rect.width), minHeight = Math.min(.02, rect.height);
  if (handle.includes('w')) left = clamp(left + dx, 0, right - minWidth);
  if (handle.includes('e')) right = clamp(right + dx, left + minWidth, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minHeight);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Analyze a small, oriented copy. Only connected exterior background is ignored;
// its pixels are never erased from the saved artwork.
export function detectIconCrop(data: Uint8ClampedArray, width: number, height: number): { rect: CropRect; kind: 'transparent' | 'solid' | 'none' } {
  const unchanged = { rect: { ...fullCrop }, kind: 'none' as const };
  if (width < 4 || height < 4 || data.length !== width * height * 4) return unchanged;
  const total = width * height;
  const corners = [0, width - 1, total - width, total - 1];
  const transparent = corners.filter((p) => data[p * 4 + 3] <= 8).length >= 3;
  const color = [0, 1, 2].map((c) => corners.reduce((sum, p) => sum + data[p * 4 + c], 0) / 4);
  const isBackground = (p: number) => data[p * 4 + 3] <= 8 || (!transparent && data[p * 4 + 3] >= 248 && color.every((v, c) => Math.abs(data[p * 4 + c] - v) <= 16));
  if (!transparent && !corners.every((p) => data[p * 4 + 3] >= 248 && color.every((v, c) => Math.abs(data[p * 4 + c] - v) <= 10))) return unchanged;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0, edgeCount = 0, backgroundEdges = 0;
  const add = (p: number) => { if (!visited[p] && isBackground(p)) { visited[p] = 1; queue[tail++] = p; } };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x && y && x !== width - 1 && y !== height - 1) continue;
    edgeCount++;
    if (isBackground(y * width + x)) backgroundEdges++;
    add(y * width + x);
  }
  // A varied border is not a reliable solid backdrop.
  if (!transparent && backgroundEdges / edgeCount < .9) return unchanged;
  while (head < tail) {
    const p = queue[head++], x = p % width;
    if (x > 0) add(p - 1);
    if (x < width - 1) add(p + 1);
    if (p >= width) add(p - width);
    if (p < total - width) add(p + width);
  }
  let left = width, right = -1, top = height, bottom = -1, count = 0;
  for (let p = 0; p < total; p++) if (!visited[p]) {
    const x = p % width, y = Math.floor(p / width);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
  }
  if (count < 8) return unchanged;
  const margin = Math.max(2, Math.ceil(Math.max(right - left + 1, bottom - top + 1) * .04));
  left = Math.max(0, left - margin); top = Math.max(0, top - margin);
  right = Math.min(width, right + 1 + margin); bottom = Math.min(height, bottom + 1 + margin);
  if ((right - left) * (bottom - top) > total * .96) return unchanged;
  return { rect: { x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height }, kind: transparent ? 'transparent' : 'solid' };
}
