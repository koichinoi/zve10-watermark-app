import exifr from 'exifr';
import { readRasterSize, releaseCanvas } from './photo-processing';
import { CropRect, detectIconCrop, fullCrop } from './icon-crop';

export type IconKind = 'camera' | 'lens';
export type SavedIcon = { name: string; dataUrl: string };
export type CustomIcon = SavedIcon & { image: HTMLImageElement; cleanup: () => void };
export type IconCropSource = { name: string; url: string; image: HTMLImageElement; cleanup: () => void };
export type CustomIcons = Record<IconKind, CustomIcon | null>;
export const customIconsStorageKey = 'zve10-custom-icons-v1';
export const iconMaxEdge = 512;
const maxDataUrlLength = 1_500_000;

// Contain artwork in a bounded slot without stretching narrow or wide logos.
export function fitArtwork(width: number, height: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(boxWidth / width, boxHeight / height);
  return { width: width * scale, height: height * scale };
}

export function readCustomIcons(value: string | null): Record<IconKind, SavedIcon | null> {
  const result: Record<IconKind, SavedIcon | null> = { camera: null, lens: null };
  try {
    const parsed = JSON.parse(value || '{}');
    for (const kind of ['camera', 'lens'] as const) {
      const icon = parsed?.[kind];
      if (icon && typeof icon.name === 'string' && icon.name.trim() && icon.name.length <= 128
        && typeof icon.dataUrl === 'string' && icon.dataUrl.length <= maxDataUrlLength
        && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(icon.dataUrl)) {
        result[kind] = { name: icon.name, dataUrl: icon.dataUrl };
      }
    }
  } catch { /* Corrupt storage falls back to built-in artwork. */ }
  return result;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => { image.src = ''; reject(new Error('无法读取图标，请换一张完整的 PNG、JPG 或 WEBP 图片。')); };
    image.src = url;
  });
}

export async function restoreCustomIcon(saved: SavedIcon): Promise<CustomIcon> {
  const image = await loadImage(saved.dataUrl);
  if (image.naturalWidth > iconMaxEdge || image.naturalHeight > iconMaxEdge || !image.naturalWidth || !image.naturalHeight) {
    image.src = '';
    throw new Error('保存的图标无效，请重新上传。');
  }
  return { ...saved, image, cleanup: () => { image.src = ''; } };
}

export async function loadIconForCropping(file: File): Promise<IconCropSource> {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的图标图片。');
  const dimensions = await readRasterSize(file);
  if (!dimensions) throw new Error('图标支持 PNG、JPG 和 WEBP，请选择这些格式的图片。');
  if (dimensions.width * dimensions.height > 40_000_000) throw new Error('图标图片像素过大，请缩小图片后重试。');
  const orientation = await exifr.orientation(file).catch(() => 1);
  const original = orientation && orientation >= 5 && orientation <= 8
    ? { width: dimensions.height, height: dimensions.width } : dimensions;
  // Keep more detail while framing; only the final crop is reduced to 512px.
  const editingMaxEdge = 1536;
  const target = fitArtwork(original.width, original.height, Math.min(editingMaxEdge, original.width), Math.min(editingMaxEdge, original.height));
  const canvas = document.createElement('canvas');
  let bitmap: ImageBitmap | null = null;
  let native: HTMLImageElement | null = null;
  let url: string | null = null;
  let normalized: Blob;
  try {
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: Math.max(1, Math.round(target.width)), resizeHeight: Math.max(1, Math.round(target.height)), resizeQuality: 'high' });
      } catch { /* Fall back to the native image decoder. */ }
    }
    if (!bitmap) {
      url = URL.createObjectURL(file);
      native = await loadImage(url);
    }
    const size = bitmap ? target : fitArtwork(native!.naturalWidth, native!.naturalHeight, Math.min(editingMaxEdge, native!.naturalWidth), Math.min(editingMaxEdge, native!.naturalHeight));
    canvas.width = Math.max(1, Math.round(size.width));
    canvas.height = Math.max(1, Math.round(size.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法生成图标，请换一张尺寸较小的图片。');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap ?? native!, 0, 0, canvas.width, canvas.height);
    normalized = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成图标，请重试。')), 'image/png'));
  } finally {
    bitmap?.close();
    if (native) native.src = '';
    if (url) URL.revokeObjectURL(url);
    releaseCanvas(canvas);
  }
  const normalizedUrl = URL.createObjectURL(normalized);
  try {
    const image = await loadImage(normalizedUrl);
    return { name: file.name.slice(0, 128) || '自定义图标', url: normalizedUrl, image, cleanup: () => { image.src = ''; URL.revokeObjectURL(normalizedUrl); } };
  } catch (error) { URL.revokeObjectURL(normalizedUrl); throw error; }
}

export function suggestIconCrop(source: IconCropSource) {
  const canvas = document.createElement('canvas');
  try {
    const size = fitArtwork(source.image.naturalWidth, source.image.naturalHeight, 512, 512);
    canvas.width = Math.max(1, Math.round(size.width)); canvas.height = Math.max(1, Math.round(size.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return { rect: { ...fullCrop }, kind: 'none' as const };
    ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
    return detectIconCrop(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  } catch {
    // Browsers that restrict pixel reads can still offer manual cropping.
    return { rect: { ...fullCrop }, kind: 'none' as const };
  } finally { releaseCanvas(canvas); }
}

export async function cropCustomIcon(source: IconCropSource, rect: CropRect): Promise<CustomIcon> {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.x >= 1 || rect.y >= 1 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) throw new Error('裁剪范围无效，请恢复完整图片后重试。');
  const image = source.image;
  const x = Math.floor(rect.x * image.naturalWidth), y = Math.floor(rect.y * image.naturalHeight);
  const width = Math.min(image.naturalWidth - x, Math.max(1, Math.round(rect.width * image.naturalWidth)));
  const height = Math.min(image.naturalHeight - y, Math.max(1, Math.round(rect.height * image.naturalHeight)));
  const size = fitArtwork(width, height, Math.min(iconMaxEdge, width), Math.min(iconMaxEdge, height));
  const canvas = document.createElement('canvas');
  try {
    canvas.width = Math.max(1, Math.round(size.width)); canvas.height = Math.max(1, Math.round(size.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法生成图标，请重试。');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > maxDataUrlLength) throw new Error('图标内容较大，请缩小图片后重试。');
    // Store cropped PNG pixels only: no original file, EXIF or editing buffer.
    return await restoreCustomIcon({ name: source.name, dataUrl });
  } finally { releaseCanvas(canvas); }
}

export async function prepareCustomIcon(file: File): Promise<CustomIcon> {
  const source = await loadIconForCropping(file);
  try { return await cropCustomIcon(source, fullCrop); }
  finally { source.cleanup(); }
}
