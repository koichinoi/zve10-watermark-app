'use client';

import exifr from 'exifr';
import JSZip from 'jszip';
import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from 'react';

type WatermarkTheme = 'light' | 'dark';
type DetailMode = 'full' | 'compact';
type ExportFormat = 'jpeg' | 'png';
type LayoutMode = 'auto' | 'landscape';
type HolidayId = 'none' | 'new-year' | 'spring-festival' | 'lantern' | 'qingming' | 'labor-day' | 'dragon-boat' | 'mid-autumn' | 'national-day' | 'christmas';

type PhotoMeta = {
  make: string;
  model: string;
  aperture: string;
  exposure: string;
  exposureCompensation: string;
  iso: string;
  lens: string;
  focal: string;
  maxAperture: string;
  metering: string;
  distance: string;
  flash: string;
  focal35: string;
  date: string;
};

type ParameterKey = Exclude<keyof PhotoMeta, 'make' | 'model'>;
type ParameterVisibility = Record<ParameterKey, boolean>;

type LoadedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  name: string;
  rawPreview: boolean;
  cleanup?: () => void;
};

type DroppedEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, failure?: (reason: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: DroppedEntry[]) => void, failure?: (reason: DOMException) => void) => void;
  };
};

const supportedPhotoPattern = /\.(?:jpe?g|png|webp|arw)$/i;

function isSupportedPhoto(file: File) {
  return supportedPhotoPattern.test(file.name)
    || /image\/(?:jpeg|png|webp)/i.test(file.type)
    || /sony.*raw/i.test(file.type);
}

function fileFromEntry(entry: DroppedEntry) {
  return new Promise<File>((resolve, reject) => {
    if (!entry.file) return reject(new Error('无法读取文件'));
    entry.file(resolve, reject);
  });
}

async function entriesFromDirectory(entry: DroppedEntry) {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const entries: DroppedEntry[] = [];

  while (true) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    entries.push(...batch);
  }

  return entries;
}

async function filesFromEntry(entry: DroppedEntry): Promise<File[]> {
  if (entry.isFile) {
    try {
      return [await fileFromEntry(entry)];
    } catch {
      return [];
    }
  }
  if (!entry.isDirectory) return [];
  const children = await entriesFromDirectory(entry);
  return (await Promise.all(children.map(filesFromEntry))).flat();
}

async function photosFromDrop(entries: DroppedEntry[], fallbackFiles: File[]) {
  const files = entries.length
    ? (await Promise.all(entries.map(filesFromEntry))).flat()
    : fallbackFiles;
  return files
    .filter((file) => !file.name.startsWith('.') && isSupportedPhoto(file))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
}

const demoMeta: PhotoMeta = {
  make: 'SONY',
  model: 'ZV-E10 II',
  aperture: 'f/4.5',
  exposure: '1/125s',
  exposureCompensation: '±0.0 EV',
  iso: 'ISO 400',
  lens: 'E PZ 16-50mm F3.5-5.6 OSS II',
  focal: '26mm',
  maxAperture: 'f/4.5',
  metering: '图案测光',
  distance: '—',
  flash: '无闪光，强制',
  focal35: '39mm',
  date: '',
};

const fields: Array<{ key: keyof PhotoMeta; label: string; wide?: boolean }> = [
  { key: 'make', label: '相机制造商' },
  { key: 'model', label: '相机型号' },
  { key: 'aperture', label: '光圈值' },
  { key: 'exposure', label: '曝光时间' },
  { key: 'exposureCompensation', label: '曝光补偿' },
  { key: 'iso', label: 'ISO 速度' },
  { key: 'focal', label: '焦距' },
  { key: 'lens', label: '镜头', wide: true },
  { key: 'maxAperture', label: '最大光圈' },
  { key: 'focal35', label: '35mm 等效' },
  { key: 'metering', label: '测光模式' },
  { key: 'distance', label: '目标距离' },
  { key: 'flash', label: '闪光灯模式', wide: true },
  { key: 'date', label: '拍摄时间', wide: true },
];

const parameterOptions: Array<{ key: ParameterKey; label: string }> = [
  { key: 'lens', label: '镜头' },
  { key: 'focal', label: '焦距' },
  { key: 'aperture', label: '光圈' },
  { key: 'exposure', label: '快门' },
  { key: 'iso', label: 'ISO' },
  { key: 'exposureCompensation', label: '曝光补偿' },
  { key: 'maxAperture', label: '最大光圈' },
  { key: 'focal35', label: '35mm 等效' },
  { key: 'metering', label: '测光' },
  { key: 'distance', label: '目标距离' },
  { key: 'flash', label: '闪光灯' },
  { key: 'date', label: '拍摄时间' },
];

const defaultParameterVisibility: ParameterVisibility = {
  aperture: true,
  exposure: true,
  exposureCompensation: true,
  iso: true,
  lens: true,
  focal: true,
  maxAperture: true,
  metering: true,
  distance: true,
  flash: true,
  focal35: true,
  date: true,
};

const holidayPresets: Array<{ id: HolidayId; title: string; subtitle: string; color: string }> = [
  { id: 'none', title: '关闭', subtitle: '纯参数水印', color: '#71747b' },
  { id: 'new-year', title: '新年', subtitle: 'HAPPY NEW YEAR', color: '#d7a629' },
  { id: 'spring-festival', title: '新春', subtitle: 'SPRING FESTIVAL', color: '#e02936' },
  { id: 'lantern', title: '元宵', subtitle: 'LANTERN FESTIVAL', color: '#ec6139' },
  { id: 'qingming', title: '清明', subtitle: 'QINGMING FESTIVAL', color: '#5f846d' },
  { id: 'labor-day', title: '五一', subtitle: 'LABOUR DAY', color: '#3976d5' },
  { id: 'dragon-boat', title: '端午', subtitle: 'DRAGON BOAT', color: '#21805c' },
  { id: 'mid-autumn', title: '中秋', subtitle: 'MID-AUTUMN', color: '#c88a24' },
  { id: 'national-day', title: '国庆', subtitle: 'NATIONAL DAY', color: '#d91f2f' },
  { id: 'christmas', title: '圣诞', subtitle: 'MERRY CHRISTMAS', color: '#24734d' },
];

function enabledValues(visibility: ParameterVisibility, values: Array<[ParameterKey, string]>) {
  return values.filter(([key, value]) => visibility[key] && value.trim()).map(([, value]) => value);
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function trimNumber(value: number, digits = 1) {
  return value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatAperture(value: unknown) {
  const number = finiteNumber(value);
  return number ? `f/${trimNumber(number)}` : '—';
}

function formatMaxAperture(value: unknown) {
  const apex = finiteNumber(value);
  if (!apex) return '—';
  return `f/${trimNumber(Math.pow(2, apex / 2))}`;
}

function formatExposure(value: unknown) {
  const seconds = finiteNumber(value);
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 1) return `1/${Math.round(1 / seconds)}s`;
  return `${trimNumber(seconds, 2)}s`;
}

function formatExposureCompensation(value: unknown) {
  const number = finiteNumber(value);
  if (number === null) return value ? String(value) : '—';
  if (Math.abs(number) < 0.05) return '±0.0 EV';
  return `${number > 0 ? '+' : ''}${trimNumber(number, 1)} EV`;
}

function formatMillimeters(value: unknown) {
  const number = finiteNumber(value);
  return number === null ? '—' : `${trimNumber(number)}mm`;
}

function normalizeModel(value: unknown) {
  const model = String(value || '').trim();
  if (/ZV-E10M2/i.test(model)) return 'ZV-E10 II';
  return model || '—';
}

function formatLens(data: Record<string, unknown>) {
  const direct = String(data.LensModel || data.Lens || '').trim();
  if (direct) return direct;
  const info = data.LensInfo;
  if (Array.isArray(info) && info.length >= 4) {
    return `${trimNumber(Number(info[2]))}-${trimNumber(Number(info[3]))}mm f/${trimNumber(Number(info[0]))}-${trimNumber(Number(info[1]))}`;
  }
  return '—';
}

function formatMetering(value: unknown) {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('pattern') || text === '5') return '图案测光';
  if (text.includes('center') || text === '2') return '中央重点';
  if (text.includes('spot') || text === '3' || text === '4') return '点测光';
  if (text.includes('average') || text === '1') return '平均测光';
  return value ? String(value) : '—';
}

function formatFlash(value: unknown) {
  const text = String(value ?? '').toLowerCase();
  const number = finiteNumber(value);
  if (text.includes('did not fire') && (text.includes('compulsory') || text.includes('forced'))) return '无闪光，强制';
  if (text.includes('did not fire') || number === 0) return '未闪光';
  if (text.includes('fired') || (number !== null && (number & 1) === 1)) return '闪光灯已闪光';
  return value ? String(value) : '—';
}

function formatDistance(value: unknown) {
  const number = finiteNumber(value);
  return number === null ? '—' : `${trimNumber(number, 2)}m`;
}

function formatDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(value).replaceAll('/', '.');
  }
  return value ? String(value) : '';
}

function metadataFromExif(data: Record<string, unknown>): PhotoMeta {
  const iso = data.ISO ?? data.PhotographicSensitivity ?? data.ISOSpeedRatings;
  const isoNumber = finiteNumber(iso);
  return {
    make: String(data.Make || 'SONY').trim().toUpperCase(),
    model: normalizeModel(data.Model),
    aperture: formatAperture(data.FNumber ?? data.ApertureValue),
    exposure: formatExposure(data.ExposureTime),
    exposureCompensation: formatExposureCompensation(data.ExposureCompensation ?? data.ExposureBiasValue),
    iso: isoNumber === null ? '—' : `ISO ${isoNumber}`,
    lens: formatLens(data),
    focal: formatMillimeters(data.FocalLength),
    maxAperture: formatMaxAperture(data.MaxApertureValue),
    metering: formatMetering(data.MeteringMode),
    distance: formatDistance(data.SubjectDistance),
    flash: formatFlash(data.Flash),
    focal35: formatMillimeters(data.FocalLengthIn35mmFormat ?? data.FocalLengthIn35mmFilm),
    date: formatDate(data.DateTimeOriginal ?? data.CreateDate),
  };
}

function loadHtmlImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法解码图片'));
    image.src = url;
  });
}

async function loadNativeImageFile(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const htmlImage = await loadHtmlImage(objectUrl);
    const image: LoadedImage = {
      source: htmlImage,
      width: htmlImage.naturalWidth,
      height: htmlImage.naturalHeight,
      name: file.name,
      rawPreview: false,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
    return image;
  } catch (reason) {
    URL.revokeObjectURL(objectUrl);
    throw reason;
  }
}

type EmbeddedJpeg = { start: number; end: number; width: number; height: number };

function readEmbeddedJpegSize(bytes: Uint8Array, start: number, end: number) {
  let offset = start + 2;
  while (offset + 8 < end) {
    while (offset < end && bytes[offset] !== 0xff) offset += 1;
    while (offset < end && bytes[offset] === 0xff) offset += 1;
    if (offset >= end) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (offset + 1 >= end) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > end) break;
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xda) break;
    offset += segmentLength;
  }
  return null;
}

function findEmbeddedJpegs(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const candidates: EmbeddedJpeg[] = [];
  for (let start = 0; start + 10 < bytes.length; start += 1) {
    if (bytes[start] !== 0xff || bytes[start + 1] !== 0xd8 || bytes[start + 2] !== 0xff) continue;
    let end = start + 3;
    while (end + 1 < bytes.length && !(bytes[end] === 0xff && bytes[end + 1] === 0xd9)) end += 1;
    if (end + 1 >= bytes.length) continue;
    end += 2;
    const size = readEmbeddedJpegSize(bytes, start, end);
    if (size) candidates.push({ start, end, ...size });
    start = end - 1;
  }
  return candidates.sort((left, right) => (right.width * right.height) - (left.width * left.height));
}

function orientRawPreview(image: HTMLImageElement, orientation: number) {
  if (orientation < 2 || orientation > 8) return { source: image as CanvasImageSource, width: image.naturalWidth, height: image.naturalHeight };
  // Some browsers may already honor orientation stored inside the embedded JPEG.
  if (orientation >= 5 && image.naturalHeight > image.naturalWidth) {
    return { source: image as CanvasImageSource, width: image.naturalWidth, height: image.naturalHeight };
  }

  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const swapsDimensions = orientation >= 5;
  const canvas = document.createElement('canvas');
  canvas.width = swapsDimensions ? sourceHeight : sourceWidth;
  canvas.height = swapsDimensions ? sourceWidth : sourceHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { source: image as CanvasImageSource, width: sourceWidth, height: sourceHeight };

  switch (orientation) {
    case 2: ctx.setTransform(-1, 0, 0, 1, sourceWidth, 0); break;
    case 3: ctx.setTransform(-1, 0, 0, -1, sourceWidth, sourceHeight); break;
    case 4: ctx.setTransform(1, 0, 0, -1, 0, sourceHeight); break;
    case 5: ctx.setTransform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.setTransform(0, 1, -1, 0, sourceHeight, 0); break;
    case 7: ctx.setTransform(0, -1, -1, 0, sourceHeight, sourceWidth); break;
    case 8: ctx.setTransform(0, -1, 1, 0, 0, sourceWidth); break;
  }
  ctx.drawImage(image, 0, 0);
  return { source: canvas as CanvasImageSource, width: canvas.width, height: canvas.height };
}

async function loadLargestRawPreview(file: File, orientation: number) {
  const candidates = findEmbeddedJpegs(await file.arrayBuffer());
  for (const candidate of candidates.slice(0, 6)) {
    const objectUrl = URL.createObjectURL(file.slice(candidate.start, candidate.end, 'image/jpeg'));
    try {
      const htmlImage = await loadHtmlImage(objectUrl);
      if (htmlImage.naturalWidth * htmlImage.naturalHeight < 320 * 240) {
        URL.revokeObjectURL(objectUrl);
        continue;
      }
      const oriented = orientRawPreview(htmlImage, orientation);
      const image: LoadedImage = {
        source: oriented.source,
        width: oriented.width,
        height: oriented.height,
        name: file.name,
        rawPreview: true,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      };
      return image;
    } catch {
      URL.revokeObjectURL(objectUrl);
    }
  }
  throw new Error('missing large preview');
}

async function readPhotoFile(file: File) {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await exifr.parse(file, true)) || {};
  } catch {
    parsed = {};
  }
  let meta: PhotoMeta;
  try {
    meta = metadataFromExif(parsed);
  } catch {
    meta = metadataFromExif({});
  }

  const isRaw = /\.arw$/i.test(file.name) || /sony.*raw/i.test(file.type);

  if (!isRaw) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const image: LoadedImage = {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          name: file.name,
          rawPreview: false,
          cleanup: () => bitmap.close(),
        };
        return { image, meta };
      } catch {
        try {
          const bitmap = await createImageBitmap(file);
          const image: LoadedImage = {
            source: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            name: file.name,
            rawPreview: false,
            cleanup: () => bitmap.close(),
          };
          return { image, meta };
        } catch {
          // Continue with the browser's native image decoder below.
        }
      }
    }

    try {
      const image = await loadNativeImageFile(file);
      return { image, meta };
    } catch {
      throw new Error(`无法读取“${file.name}”，请确认它是完整的 JPG、PNG 或 WEBP 图片。`);
    }
  }

  try {
    const orientation = await exifr.orientation(file).catch(() => undefined);
    const image = await loadLargestRawPreview(file, typeof orientation === 'number' ? orientation : 1);
    return { image, meta };
  } catch {
    // Older RAW files may only expose the standard EXIF thumbnail.
  }

  try {
    const thumbnailUrl = await exifr.thumbnailUrl(file);
    if (!thumbnailUrl) throw new Error('missing thumbnail');
    const htmlImage = await loadHtmlImage(thumbnailUrl);
    const image: LoadedImage = {
      source: htmlImage,
      width: htmlImage.naturalWidth,
      height: htmlImage.naturalHeight,
      name: file.name,
      rawPreview: true,
      cleanup: () => URL.revokeObjectURL(thumbnailUrl),
    };
    return { image, meta };
  } catch {
    throw new Error(`无法读取“${file.name}”的 RAW 预览，请先将它转成 JPEG 再导入。`);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, format: ExportFormat) {
  const lossless = format === 'png';
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片生成失败'));
    }, lossless ? 'image/png' : 'image/jpeg', lossless ? undefined : 0.98);
  });
}

function cameraGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, accentColor: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.045);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.roundRect(x, y + size * 0.2, size * 1.35, size * 0.78, size * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.25, y + size * 0.2);
  ctx.lineTo(x + size * 0.4, y);
  ctx.lineTo(x + size * 0.78, y);
  ctx.lineTo(x + size * 0.92, y + size * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + size * 0.7, y + size * 0.59, size * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(x + size * 1.12, y + size * 0.39, size * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function cameraPhoto(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: WatermarkTheme,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height * 0.08);
  ctx.clip();
  ctx.shadowColor = theme === 'light' ? 'rgba(20,20,24,.18)' : 'rgba(0,0,0,.45)';
  ctx.shadowBlur = height * 0.08;
  ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, x, y, width, height);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = theme === 'light' ? 'rgba(30,31,34,.16)' : 'rgba(255,255,255,.2)';
  ctx.lineWidth = Math.max(1, height * 0.012);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height * 0.08);
  ctx.stroke();
  ctx.restore();
}

function shorten(text: string, max = 56) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function lensPhoto(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: WatermarkTheme,
) {
  ctx.save();
  ctx.shadowColor = theme === 'light' ? 'rgba(20,20,24,.2)' : 'rgba(0,0,0,.5)';
  ctx.shadowBlur = height * 0.1;
  ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, x, y, width, height);
  ctx.restore();
}

function drawHolidayWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  photoHeight: number,
  scaleBase: number,
  holidayId: HolidayId,
) {
  const preset = holidayPresets.find((item) => item.id === holidayId);
  if (!preset || preset.id === 'none') return;

  const badgeWidth = Math.min(width * 0.42, scaleBase * 0.23);
  const badgeHeight = badgeWidth * 0.3;
  const padding = Math.max(width * 0.025, scaleBase * 0.014);
  const x = width - padding - badgeWidth;
  const y = photoHeight - padding - badgeHeight;
  const radius = badgeHeight * 0.13;

  ctx.save();
  ctx.fillStyle = 'rgba(12, 13, 16, .62)';
  ctx.beginPath();
  ctx.roundRect(x, y, badgeWidth, badgeHeight, radius);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.24)';
  ctx.lineWidth = Math.max(1, scaleBase * 0.0007);
  ctx.stroke();

  const accentWidth = Math.max(4, badgeWidth * 0.018);
  ctx.fillStyle = preset.color;
  ctx.beginPath();
  ctx.roundRect(x, y, accentWidth, badgeHeight, [radius, 0, 0, radius]);
  ctx.fill();

  const textX = x + badgeWidth * 0.12;
  const titleSize = badgeHeight * 0.36;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${titleSize}px "Microsoft YaHei", Arial, sans-serif`;
  ctx.fillText(preset.title, textX, y + badgeHeight * 0.51, badgeWidth * 0.78);
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.font = `600 ${badgeHeight * 0.13}px Arial, sans-serif`;
  ctx.fillText(preset.subtitle, textX, y + badgeHeight * 0.76, badgeWidth * 0.78);
  ctx.restore();
}

function drawWatermark(
  canvas: HTMLCanvasElement,
  image: LoadedImage,
  meta: PhotoMeta,
  theme: WatermarkTheme,
  detailMode: DetailMode,
  heightPercent: number,
  cameraAsset: HTMLImageElement | null,
  lensAsset: HTMLImageElement | null,
  signature: string,
  accentColor: string,
  lensImageEnabled: boolean,
  holidayId: HolidayId,
  layoutMode: LayoutMode,
  visibility: ParameterVisibility,
) {
  const width = image.width;
  // Keep the watermark visually consistent when the same sensor image is rotated.
  // Portrait photos otherwise used the short edge here and produced a much smaller band.
  const scaleBase = Math.max(image.width, image.height);
  const bandHeight = Math.max(72, Math.round(scaleBase * heightPercent / 100));
  const canvasHeight = image.height + bandHeight;
  canvas.width = width;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image.source, 0, 0, width, image.height);
  drawHolidayWatermark(ctx, width, image.height, scaleBase, holidayId);

  const background = theme === 'light' ? '#f8f8f6' : '#101113';
  const primary = theme === 'light' ? '#121316' : '#f7f7f4';
  const muted = theme === 'light' ? '#62646a' : '#a9abb1';
  const y0 = image.height;
  const padX = width * 0.045;
  ctx.fillStyle = background;
  ctx.fillRect(0, y0, width, bandHeight);

  const isPortraitLayout = layoutMode === 'auto' && image.height > image.width;
  if (isPortraitLayout) {
    const portraitPad = width * 0.06;
    const brandSize = Math.max(12, Math.min(scaleBase * 0.02, width * 0.032, bandHeight * 0.16));
    const smallSize = Math.max(8, Math.min(scaleBase * 0.011, width * 0.017, bandHeight * 0.085));
    const tinySize = Math.max(7, Math.min(scaleBase * 0.0092, width * 0.0145, bandHeight * 0.072));
    const mainSize = Math.max(15, Math.min(scaleBase * 0.0185, width * 0.03, bandHeight * 0.15));
    const topDetail = signature.trim();
    const topHeight = brandSize + smallSize * 1.35 + (topDetail ? tinySize * 1.25 : 0);
    const bottomHeight = mainSize + smallSize * 1.45 + (detailMode === 'full' ? tinySize * 1.35 : 0);
    const contentGap = bandHeight * 0.06;
    const totalHeight = topHeight + contentGap + bottomHeight;
    const contentTop = y0 + Math.max(bandHeight * 0.07, (bandHeight - totalHeight) / 2);

    const cameraHeight = Math.min(bandHeight * 0.27, topHeight * 0.95);
    const cameraWidth = cameraHeight * 1.82;
    const cameraY = contentTop + (topHeight - cameraHeight) / 2;
    if (cameraAsset) cameraPhoto(ctx, cameraAsset, portraitPad, cameraY, cameraWidth, cameraHeight, theme);
    else cameraGlyph(ctx, portraitPad, cameraY, cameraHeight, primary, accentColor);

    const lensHeight = lensImageEnabled && lensAsset ? cameraHeight * 0.92 : 0;
    const lensWidth = lensHeight * (1402 / 1122);
    const gearGap = lensHeight ? width * 0.01 : 0;
    if (lensAsset && lensHeight) {
      lensPhoto(ctx, lensAsset, portraitPad + cameraWidth + gearGap, contentTop + (topHeight - lensHeight) / 2, lensWidth, lensHeight, theme);
    }
    const dividerX = portraitPad + cameraWidth + gearGap + lensWidth + width * 0.018;
    ctx.fillStyle = accentColor;
    ctx.fillRect(dividerX, contentTop, Math.max(3, width * 0.0012), topHeight);
    const textX = dividerX + width * 0.026;
    const topMaxWidth = width - portraitPad - textX;
    const brandRow = contentTop + brandSize;
    const lensRow = brandRow + smallSize * 1.35;
    const signatureRow = lensRow + tinySize * 1.25;

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = primary;
    ctx.font = `700 ${brandSize}px Arial, sans-serif`;
    ctx.fillText(`${meta.make}  ${meta.model}`, textX, brandRow, topMaxWidth);
    ctx.fillStyle = muted;
    ctx.font = `500 ${smallSize}px Arial, sans-serif`;
    if (visibility.lens) ctx.fillText(shorten(meta.lens), textX, lensRow, topMaxWidth);
    if (topDetail) {
      ctx.font = `600 ${tinySize}px Arial, sans-serif`;
      ctx.fillText(topDetail, textX, signatureRow, topMaxWidth);
    }

    const mainRow = contentTop + topHeight + contentGap + mainSize;
    const secondaryRow = mainRow + smallSize * 1.45;
    const detailRow = secondaryRow + tinySize * 1.35;
    const centeredMaxWidth = width - portraitPad * 2;
    const mainText = enabledValues(visibility, [
      ['focal', meta.focal],
      ['aperture', meta.aperture],
      ['exposure', meta.exposure],
      ['iso', meta.iso],
    ]).join('   ·   ');
    const secondaryText = enabledValues(visibility, [
      ['maxAperture', `最大光圈 ${meta.maxAperture}`],
      ['focal35', `35mm 等效 ${meta.focal35}`],
      ['metering', meta.metering],
    ]).join('  ·  ');
    ctx.textAlign = 'center';
    ctx.fillStyle = primary;
    ctx.font = `700 ${mainSize}px Arial, sans-serif`;
    if (mainText) ctx.fillText(mainText, width / 2, mainRow, centeredMaxWidth);
    ctx.fillStyle = muted;
    ctx.font = `500 ${smallSize}px Arial, sans-serif`;
    if (secondaryText) ctx.fillText(secondaryText, width / 2, secondaryRow, centeredMaxWidth);
    if (detailMode === 'full') {
      const detailText = enabledValues(visibility, [
        ['date', meta.date],
        ['exposureCompensation', meta.exposureCompensation],
        ['distance', `目标距离 ${meta.distance}`],
        ['flash', meta.flash],
      ]).filter((value) => value && value !== '—').join('  ·  ');
      ctx.font = `500 ${tinySize}px Arial, sans-serif`;
      if (detailText) ctx.fillText(detailText, width / 2, detailRow, centeredMaxWidth);
    }
    return;
  }

  const cameraHeight = bandHeight * 0.42;
  const cameraWidth = cameraHeight * 1.82;
  const cameraY = y0 + (bandHeight - cameraHeight) / 2;
  if (cameraAsset) cameraPhoto(ctx, cameraAsset, padX, cameraY, cameraWidth, cameraHeight, theme);
  else cameraGlyph(ctx, padX, cameraY, cameraHeight, primary, accentColor);
  const lensHeight = lensImageEnabled && lensAsset ? cameraHeight * 0.92 : 0;
  const lensWidth = lensHeight * (1402 / 1122);
  const gearGap = lensHeight ? width * 0.008 : 0;
  if (lensAsset && lensHeight) {
    lensPhoto(ctx, lensAsset, padX + cameraWidth + gearGap, y0 + (bandHeight - lensHeight) / 2, lensWidth, lensHeight, theme);
  }
  const dividerX = padX + cameraWidth + gearGap + lensWidth + width * 0.014;
  const dividerHeight = bandHeight * 0.56;
  ctx.fillStyle = accentColor;
  ctx.fillRect(dividerX, y0 + (bandHeight - dividerHeight) / 2, Math.max(3, width * 0.001), dividerHeight);

  const textX = dividerX + width * 0.023;
  const brandSize = Math.max(12, Math.min(scaleBase * 0.0225, width * 0.032, bandHeight * 0.24));
  const smallSize = Math.max(8, Math.min(scaleBase * 0.0115, width * 0.017, bandHeight * 0.12));
  const tinySize = Math.max(7, Math.min(scaleBase * 0.0098, width * 0.015, bandHeight * 0.1));
  const leftDetail = [signature.trim(), visibility.date ? meta.date : ''].filter(Boolean).join('  ·  ');
  const hasDetailRow = detailMode === 'full' || Boolean(leftDetail);
  const contentHeight = brandSize + smallSize * 1.5 + (hasDetailRow ? tinySize * 1.5 : 0);
  const contentTop = y0 + (bandHeight - contentHeight) / 2;
  const primaryRow = contentTop + brandSize;
  const secondaryRow = primaryRow + smallSize * 1.5;
  const detailRow = secondaryRow + tinySize * 1.5;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = primary;
  ctx.font = `700 ${brandSize}px Arial, sans-serif`;
  const leftMaxWidth = Math.max(width * 0.2, width * 0.48 - textX);
  ctx.fillText(`${meta.make}  ${meta.model}`, textX, primaryRow, leftMaxWidth);
  ctx.fillStyle = muted;
  ctx.font = `500 ${smallSize}px Arial, sans-serif`;
  if (visibility.lens) ctx.fillText(shorten(meta.lens), textX, secondaryRow, leftMaxWidth);
  if (leftDetail) {
    ctx.font = `500 ${tinySize}px Arial, sans-serif`;
    ctx.fillText(leftDetail, textX, detailRow, leftMaxWidth);
  }

  const rightX = width - padX;
  const rightMaxWidth = width * 0.48;
  ctx.textAlign = 'right';
  ctx.fillStyle = primary;
  ctx.font = `700 ${Math.max(16, Math.min(scaleBase * 0.0205, width * 0.032))}px Arial, sans-serif`;
  const mainText = enabledValues(visibility, [
    ['focal', meta.focal],
    ['aperture', meta.aperture],
    ['exposure', meta.exposure],
    ['iso', meta.iso],
  ]).join('   ·   ');
  if (mainText) ctx.fillText(mainText, rightX, primaryRow, rightMaxWidth);
  ctx.fillStyle = muted;
  ctx.font = `500 ${smallSize}px Arial, sans-serif`;
  const secondLine = enabledValues(visibility, [
    ...(detailMode === 'full' ? [['maxAperture', `最大光圈 ${meta.maxAperture}`] as [ParameterKey, string]] : []),
    ['focal35', `35mm 等效 ${meta.focal35}`],
    ['metering', meta.metering],
  ]).join('  ·  ');
  if (secondLine) ctx.fillText(secondLine, rightX, secondaryRow, rightMaxWidth);
  if (detailMode === 'full') {
    ctx.font = `500 ${tinySize}px Arial, sans-serif`;
    const detailText = enabledValues(visibility, [
      ['exposureCompensation', meta.exposureCompensation],
      ['distance', `目标距离 ${meta.distance}`],
      ['flash', meta.flash],
    ]).join('  ·  ');
    if (detailText) ctx.fillText(detailText, rightX, detailRow, rightMaxWidth);
  }
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedRef = useRef<LoadedImage | null>(null);
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [meta, setMeta] = useState<PhotoMeta>(demoMeta);
  const [theme, setTheme] = useState<WatermarkTheme>('light');
  const [detailMode, setDetailMode] = useState<DetailMode>('full');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('jpeg');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('auto');
  const [watermarkHeight, setWatermarkHeight] = useState(12.5);
  const [signature, setSignature] = useState('');
  const [accentColor, setAccentColor] = useState('#e11d2e');
  const [lensImageEnabled, setLensImageEnabled] = useState(false);
  const [holidayId, setHolidayId] = useState<HolidayId>('none');
  const [parameterVisibility, setParameterVisibility] = useState<ParameterVisibility>(defaultParameterVisibility);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [cameraAsset, setCameraAsset] = useState<HTMLImageElement | null>(null);
  const [lensAsset, setLensAsset] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('等待导入照片');
  const [error, setError] = useState('');

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    if (loaded && canvasRef.current) {
      drawWatermark(canvasRef.current, loaded, meta, theme, detailMode, watermarkHeight, cameraAsset, lensAsset, signature, accentColor, lensImageEnabled, holidayId, layoutMode, parameterVisibility);
    }
  }, [loaded, meta, theme, detailMode, watermarkHeight, cameraAsset, lensAsset, signature, accentColor, lensImageEnabled, holidayId, layoutMode, parameterVisibility]);

  useEffect(() => {
    let active = true;
    const cameraUrl = new URL('zve10ii-camera-white-crop.png', window.location.href).toString();
    const lensUrl = new URL('zve10ii-lens-white.png', window.location.href).toString();
    loadHtmlImage(cameraUrl).then((image) => {
      if (active) setCameraAsset(image);
    }).catch(() => undefined);
    loadHtmlImage(lensUrl).then((image) => {
      if (active) setLensAsset(image);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => () => loadedRef.current?.cleanup?.(), []);

  const importFile = useCallback(async (file: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setStatus('正在读取照片和 EXIF…');
    let nextImage: LoadedImage | null = null;
    try {
      const result = await readPhotoFile(file);
      nextImage = result.image;

      loadedRef.current?.cleanup?.();
      setLoaded(nextImage);
      const nextMeta = result.meta;
      setMeta(nextMeta);
      const found = fields.filter(({ key }) => nextMeta[key] !== '—').length;
      setStatus(nextImage.rawPreview
        ? `已读取 ${found} 项参数 · ARW 使用最大预览图`
        : `已读取 ${found} 项参数 · 可直接导出`);
    } catch (reason) {
      nextImage?.cleanup?.();
      setError(reason instanceof Error ? reason.message : '读取失败，请换一张原始照片重试。');
      setStatus('读取失败');
    } finally {
      setBusy(false);
    }
  }, []);

  const importFiles = useCallback(async (files: File[]) => {
    const photos = files.filter(isSupportedPhoto);
    if (!photos.length) {
      setBatchFiles([]);
      setError('没有找到可读取的照片，请导入 JPG、PNG、WEBP 或 ARW 文件。');
      setStatus('未找到照片');
      return;
    }
    setBatchFiles(photos);
    await importFile(photos[0]);
  }, [importFile]);

  const chooseFile = () => inputRef.current?.click();

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length) void importFiles(files);
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const fallbackFiles = Array.from(event.dataTransfer.files || []);
    const entries = Array.from(event.dataTransfer.items || [])
      .map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => DroppedEntry | null }).webkitGetAsEntry?.() || null)
      .filter((entry): entry is DroppedEntry => Boolean(entry));
    setError('');
    setStatus(entries.some((entry) => entry.isDirectory) ? '正在扫描文件夹中的照片…' : '正在读取照片…');
    void photosFromDrop(entries, fallbackFiles).then(importFiles).catch(() => {
      setError('文件夹读取失败，请打开文件夹后多选照片导入。');
      setStatus('读取失败');
    });
  };

  const updateMeta = (key: keyof PhotoMeta, value: string) => {
    setMeta((current) => ({ ...current, [key]: value }));
  };

  const downloadSingle = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const lossless = exportFormat === 'png';
    const label = lossless ? '原尺寸无损 PNG' : '原尺寸高画质 JPG';
    setStatus(`正在生成${label}…`);
    try {
      const blob = await canvasToBlob(canvas, exportFormat);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const base = loaded.name.replace(/\.[^.]+$/, '');
      anchor.download = `${base}_ZVE10II_水印.${lossless ? 'png' : 'jpg'}`;
      anchor.href = url;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`${label}已导出`);
    } catch {
      setError('导出失败，请重试。');
    }
  };

  const downloadBatch = async () => {
    if (batchFiles.length < 2) return downloadSingle();
    setBusy(true);
    setError('');
    const zip = new JSZip();
    const extension = exportFormat === 'png' ? 'png' : 'jpg';
    let completed = 0;
    let failed = 0;

    for (let index = 0; index < batchFiles.length; index += 1) {
      const file = batchFiles[index];
      setStatus(`正在处理 ${index + 1}/${batchFiles.length} · ${file.name}`);
      let batchImage: LoadedImage | null = null;
      try {
        const result = await readPhotoFile(file);
        batchImage = result.image;
        const outputCanvas = document.createElement('canvas');
        drawWatermark(outputCanvas, batchImage, result.meta, theme, detailMode, watermarkHeight, cameraAsset, lensAsset, signature, accentColor, lensImageEnabled, holidayId, layoutMode, parameterVisibility);
        const blob = await canvasToBlob(outputCanvas, exportFormat);
        const base = file.name.replace(/\.[^.]+$/, '');
        const sequence = String(index + 1).padStart(3, '0');
        zip.file(`${sequence}_${base}_ZVE10II_水印.${extension}`, blob);
        completed += 1;
      } catch {
        failed += 1;
      } finally {
        batchImage?.cleanup?.();
      }
    }

    try {
      setStatus(`正在打包 ${completed} 张照片…`);
      const archive = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement('a');
      anchor.download = `ZVE10II_水印_${completed}张.zip`;
      anchor.href = url;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`批量导出完成：成功 ${completed} 张${failed ? `，失败 ${failed} 张` : ''}`);
    } catch {
      setError('压缩包生成失败，请减少照片数量后重试。');
    } finally {
      setBusy(false);
    }
  };

  const download = () => batchFiles.length > 1 ? downloadBatch() : downloadSingle();
  const allParametersVisible = parameterOptions.every(({ key }) => parameterVisibility[key]);
  const activeHoliday = holidayPresets.find((item) => item.id === holidayId) || holidayPresets[0];

  const setAllParameters = (visible: boolean) => {
    setParameterVisibility(Object.fromEntries(parameterOptions.map(({ key }) => [key, visible])) as ParameterVisibility);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><span className="record-dot" />ZE10</div>
        <div className="topbar-copy">
          <strong>ZV-E10 II 专属水印工坊</strong>
          <span>照片仅在本机处理，不会上传</span>
        </div>
        <div className="privacy-pill"><span>●</span> 本地模式</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">SONY ZV-E10 II · PHOTO SIGNATURE</p>
          <h1>把拍摄参数，<br />变成照片的一部分。</h1>
          <p className="hero-text">导入原图，自动读取光圈、快门、ISO、焦距、镜头与测光信息。一键生成干净的相机参数水印。</p>
        </div>
        <div className="hero-specs" aria-label="示例参数">
          <span>26mm</span><span>f/4.5</span><span>1/125s</span><span>ISO 400</span>
        </div>
      </section>

      <div className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <div><span className="step">01</span><h2>导入照片</h2></div>
            <span className={`status-dot ${loaded ? 'ready' : ''}`} />
          </div>

          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,.arw,.ARW" multiple hidden onChange={onInput} />
          <div
            className={`dropzone ${dragging ? 'dragging' : ''} ${loaded ? 'has-file' : ''}`}
            onClick={chooseFile}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') chooseFile(); }}
          >
            <div className="upload-symbol">＋</div>
            <strong>{batchFiles.length > 1 ? `已选择 ${batchFiles.length} 张照片` : loaded ? loaded.name : '点击选择或拖入照片'}</strong>
            <span>支持多选 · JPG、PNG、WEBP、ARW</span>
          </div>

          {batchFiles.length > 1 && (
            <div className="batch-summary">
              <div><strong>批量模式</strong><span>{batchFiles.length} 张</span></div>
              <p>当前预览：{batchFiles[0].name}</p>
              <small>导出时会逐张读取参数并打包为 ZIP。</small>
            </div>
          )}

          <div className="read-status">
            <span className={busy ? 'spinner' : 'status-icon'}>{busy ? '' : loaded ? '✓' : 'i'}</span>
            <p><strong>{status}</strong>{loaded?.rawPreview && <small>已按相机方向自动转正；画质以 ARW 内嵌 JPEG 为准。</small>}</p>
          </div>
          {error && <p className="error-message">{error}</p>}

          <div className="panel-heading settings-heading">
            <div><span className="step">02</span><h2>水印设置</h2></div>
          </div>
          <label className="setting-label">底色</label>
          <div className="segmented">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>象牙白</button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>曜石黑</button>
          </div>
          <label className="setting-label">信息密度</label>
          <div className="segmented">
            <button className={detailMode === 'full' ? 'active' : ''} onClick={() => setDetailMode('full')}>完整参数</button>
            <button className={detailMode === 'compact' ? 'active' : ''} onClick={() => setDetailMode('compact')}>精简参数</button>
          </div>

          <label className="setting-label">竖图排版</label>
          <div className="segmented">
            <button className={layoutMode === 'auto' ? 'active' : ''} onClick={() => setLayoutMode('auto')}>自动双层</button>
            <button className={layoutMode === 'landscape' ? 'active' : ''} onClick={() => setLayoutMode('landscape')}>保持横排</button>
          </div>

          <label className="setting-label" htmlFor="signature">个性署名</label>
          <input
            id="signature"
            className="signature-input"
            value={signature}
            maxLength={36}
            placeholder="例如 PHOTO BY KOICHINOI"
            onChange={(event) => setSignature(event.target.value)}
          />

          <label className="setting-label">强调色</label>
          <div className="color-options" aria-label="选择强调色">
            {['#e11d2e', '#f36c21', '#d49a2a', '#3976d5', '#25a36f'].map((color) => (
              <button
                key={color}
                className={accentColor.toLowerCase() === color ? 'active' : ''}
                style={{ backgroundColor: color }}
                aria-label={`选择颜色 ${color}`}
                title={color}
                onClick={() => setAccentColor(color)}
              />
            ))}
            <label className="custom-color" title="自定义颜色">
              <input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} aria-label="自定义强调色" />
              <span>＋</span>
            </label>
          </div>

          <label className="setting-label">节日水印</label>
          <div className="holiday-grid" aria-label="选择节日水印">
            {holidayPresets.map((preset) => (
              <button
                key={preset.id}
                className={holidayId === preset.id ? 'active' : ''}
                style={{ '--holiday-color': preset.color } as React.CSSProperties}
                onClick={() => setHolidayId(preset.id)}
              >
                <i />
                <span><strong>{preset.title}</strong><small>{preset.subtitle}</small></span>
              </button>
            ))}
          </div>

          <label className="setting-label">镜头图片</label>
          <label className="feature-switch">
            <span><strong>显示镜头</strong><small>在底部水印栏的相机旁显示镜头图片</small></span>
            <input
              type="checkbox"
              checked={lensImageEnabled}
              onChange={(event) => setLensImageEnabled(event.target.checked)}
            />
          </label>

          <div className="setting-label parameter-heading">
            <span>参数显示</span>
            <button onClick={() => setAllParameters(!allParametersVisible)}>{allParametersVisible ? '全部隐藏' : '全部显示'}</button>
          </div>
          <div className="parameter-switches">
            {parameterOptions.map(({ key, label }) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={parameterVisibility[key]}
                  onChange={(event) => setParameterVisibility((current) => ({ ...current, [key]: event.target.checked }))}
                />
              </label>
            ))}
          </div>

          <label className="setting-label range-label"><span>水印高度</span><strong>{watermarkHeight.toFixed(1)}%</strong></label>
          <div className="range-setting">
            <input
              type="range"
              min="8"
              max="22"
              step="0.5"
              value={watermarkHeight}
              onChange={(event) => setWatermarkHeight(Number(event.target.value))}
              aria-label="水印高度"
            />
            <div><span>低</span><span>高</span></div>
          </div>

          <label className="setting-label">导出格式</label>
          <div className="segmented">
            <button className={exportFormat === 'jpeg' ? 'active' : ''} onClick={() => setExportFormat('jpeg')}>高画质 JPG</button>
            <button className={exportFormat === 'png' ? 'active' : ''} onClick={() => setExportFormat('png')}>无损 PNG</button>
          </div>

          <button className="export-button" disabled={!loaded || busy} onClick={download}>
            <span>{batchFiles.length > 1
              ? `批量导出 ${batchFiles.length} 张 ZIP`
              : exportFormat === 'png' ? '无损导出 PNG' : '高画质导出 JPG'}</span><b>→</b>
          </button>
        </aside>

        <section className="preview-panel">
          <div className="preview-heading">
            <div><span className="step">03</span><h2>实时预览</h2></div>
            <span>{loaded ? `${loaded.width} × ${loaded.height}px` : '等待照片'}</span>
          </div>
          <div className="preview-stage">
            {loaded ? (
              <canvas ref={canvasRef} aria-label="水印照片预览" />
            ) : (
              <div className="sample-photo">
                <div className="sample-scene">
                  <span>YOUR<br />PHOTO</span>
                  {holidayId !== 'none' && (
                    <div className="sample-holiday" style={{ '--holiday-color': activeHoliday.color } as React.CSSProperties}>
                      <strong>{activeHoliday.title}</strong><small>{activeHoliday.subtitle}</small>
                    </div>
                  )}
                </div>
                <div className={`sample-band ${theme}`}>
                  <div className="sample-gear-photos">
                    <div className="sample-camera-photo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="zve10ii-camera-white-crop.png" alt="白色 ZV-E10 II 相机" width={684} height={375} />
                    </div>
                    {lensImageEnabled && (
                      <div className="sample-lens-photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="zve10ii-lens-white.png" alt="白色套机镜头" width={1402} height={1122} />
                      </div>
                    )}
                  </div>
                  <div className="sample-brand" style={{ borderLeftColor: accentColor }}><strong>SONY&nbsp;&nbsp;ZV-E10 II</strong><span>{signature || 'E PZ 16-50mm F3.5-5.6 OSS II'}</span></div>
                  <div className="sample-values"><strong>26mm&nbsp; · &nbsp;f/4.5&nbsp; · &nbsp;1/125s&nbsp; · &nbsp;ISO 400</strong><span>±0.0 EV&nbsp; · &nbsp;35mm 等效 39mm&nbsp; · &nbsp;图案测光</span></div>
                </div>
              </div>
            )}
          </div>

          <div className="metadata-heading">
            <div><h2>拍摄参数</h2><span>自动读取后仍可手动修改</span></div>
            <button onClick={() => setMeta(demoMeta)}>填入示例</button>
          </div>
          <div className="metadata-grid">
            {fields.map((field) => (
              <label key={field.key} className={field.wide ? 'wide' : ''}>
                <span>{field.label}</span>
                <input value={meta[field.key]} onChange={(event) => updateMeta(field.key, event.target.value)} />
              </label>
            ))}
          </div>
        </section>
      </div>

      <footer>
        <div>BUILT FOR SONY ZV-E10 II <span>·</span> JPG / LOSSLESS PNG <span>·</span> ORIGINAL RESOLUTION</div>
        <a
          href="https://github.com/koichinoi/zve10-watermark-app"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="在 GitHub 查看 ZV-E10 II 水印项目"
        >
          github.com/koichinoi/zve10-watermark-app <b>↗</b>
        </a>
      </footer>
    </main>
  );
}

