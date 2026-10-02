import exifr from 'exifr';
import { readRasterSize, releaseCanvas } from './photo-processing';

export type IconKind = 'camera' | 'lens';
export type SavedIcon = { name: string; dataUrl: string };
export type CustomIcon = SavedIcon & { image: HTMLImageElement; cleanup: () => void };
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

export async function prepareCustomIcon(file: File): Promise<CustomIcon> {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的图标图片。');
  const dimensions = await readRasterSize(file);
  if (!dimensions) throw new Error('图标支持 PNG、JPG 和 WEBP，请选择这些格式的图片。');
  if (dimensions.width * dimensions.height > 40_000_000) throw new Error('图标图片像素过大，请缩小图片后重试。');
  const orientation = await exifr.orientation(file).catch(() => 1);
  const original = orientation && orientation >= 5 && orientation <= 8
    ? { width: dimensions.height, height: dimensions.width } : dimensions;
  const target = fitArtwork(original.width, original.height, Math.min(iconMaxEdge, original.width), Math.min(iconMaxEdge, original.height));
  const canvas = document.createElement('canvas');
  let bitmap: ImageBitmap | null = null;
  let native: HTMLImageElement | null = null;
  let url: string | null = null;
  let dataUrl: string;
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
    const size = bitmap ? target : fitArtwork(native!.naturalWidth, native!.naturalHeight, Math.min(iconMaxEdge, native!.naturalWidth), Math.min(iconMaxEdge, native!.naturalHeight));
    canvas.width = Math.max(1, Math.round(size.width));
    canvas.height = Math.max(1, Math.round(size.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法生成图标，请换一张尺寸较小的图片。');
    ctx.drawImage(bitmap ?? native!, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > maxDataUrlLength) throw new Error('图标内容较大，请缩小图片后重试。');
  } finally {
    bitmap?.close();
    if (native) native.src = '';
    if (url) URL.revokeObjectURL(url);
    releaseCanvas(canvas);
  }
  // Persist normalized PNG pixels, with transparency but no source EXIF.
  return restoreCustomIcon({ name: file.name.slice(0, 128) || '自定义图标', dataUrl });
}
