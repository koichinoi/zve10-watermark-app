import exifr from 'exifr';

type Entry = { tag: number; type: number; count: number; bytes: Uint8Array };
type Tags = Record<string, unknown>;
const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8 };

function entry(tag: number, type: number, value: unknown): Entry | null {
  if (value === undefined || value === null || value === '') return null;
  if (type === 2) {
    // EXIF ASCII fields must not contain arbitrary UTF-8 bytes.
    const text = String(value).replace(/[^\x20-\x7e]/g, '').slice(0, 256);
    if (!text) return null;
    const bytes = new TextEncoder().encode(`${text}\0`);
    return { tag, type, count: bytes.length, bytes };
  }
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.length > 16 || values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  if (type !== 10 && values.some((v) => v < 0)) return null;
  const bytes = new Uint8Array(values.length * sizes[type]);
  const view = new DataView(bytes.buffer);
  values.forEach((v: number, index) => {
    const offset = index * sizes[type];
    if (type === 1 || type === 7) view.setUint8(offset, v);
    else if (type === 3) view.setUint16(offset, Math.min(65535, v), true);
    else if (type === 4) view.setUint32(offset, v, true);
    else {
      const limit = type === 10 ? 0x7fffffff : 0xffffffff;
      const denominator = Math.max(1, Math.min(1000000, Math.floor(limit / Math.max(1, Math.abs(v)))));
      const numerator = Math.round(v * denominator);
      if (type === 10) {
        view.setInt32(offset, numerator, true);
        view.setInt32(offset + 4, denominator, true);
      } else {
        view.setUint32(offset, numerator, true);
        view.setUint32(offset + 4, denominator, true);
      }
    }
  });
  return { tag, type, count: values.length, bytes };
}

const shootingFields: Array<[number, number, string]> = [
  [0x829a, 5, 'ExposureTime'], [0x829d, 5, 'FNumber'],
  [0x8827, 3, 'ISO'], [0x8830, 3, 'SensitivityType'], [0x8832, 4, 'RecommendedExposureIndex'],
  [0x9003, 2, 'DateTimeOriginal'], [0x9004, 2, 'CreateDate'],
  [0x9010, 2, 'OffsetTime'], [0x9011, 2, 'OffsetTimeOriginal'], [0x9012, 2, 'OffsetTimeDigitized'],
  [0x9201, 10, 'ShutterSpeedValue'], [0x9202, 5, 'ApertureValue'],
  [0x9204, 10, 'ExposureCompensation'], [0x9205, 5, 'MaxApertureValue'],
  [0x9206, 5, 'SubjectDistance'], [0x9207, 3, 'MeteringMode'],
  [0x9209, 3, 'Flash'], [0x920a, 5, 'FocalLength'],
  [0x9291, 2, 'SubSecTimeOriginal'], [0xa402, 3, 'ExposureMode'],
  [0xa403, 3, 'WhiteBalance'], [0xa405, 3, 'FocalLengthIn35mmFormat'],
  [0xa432, 5, 'LensInfo'], [0xa433, 2, 'LensMake'], [0xa434, 2, 'LensModel'],
];
const gpsFields: Array<[number, number, string]> = [
  [0, 1, 'GPSVersionID'], [1, 2, 'GPSLatitudeRef'], [2, 5, 'GPSLatitude'],
  [3, 2, 'GPSLongitudeRef'], [4, 5, 'GPSLongitude'],
  [5, 1, 'GPSAltitudeRef'], [6, 5, 'GPSAltitude'],
  [7, 5, 'GPSTimeStamp'], [29, 2, 'GPSDateStamp'],
];
export const exportExifTags = ['Make', 'Model', 'ModifyDate', ...shootingFields.map((v) => v[2]), ...gpsFields.map((v) => v[2])];

// Write only known shooting fields. Never copy stale thumbnails, Sony
// MakerNotes, serial numbers, original orientation or opaque XMP/GPS blocks.
export function buildExif(tags: Tags, width: number, height: number, removeGps: boolean) {
  const collect = (fields: Array<[number, number, string]>) => fields
    .map(([tag, type, key]) => entry(tag, type, tags[key])).filter((v): v is Entry => Boolean(v));
  const root = collect([[0x010f, 2, 'Make'], [0x0110, 2, 'Model'], [0x0132, 2, 'ModifyDate']]);
  root.push(entry(0x0112, 3, 1)!, entry(0x0131, 2, 'ZV-E10 II Watermark')!);
  const photo = collect(shootingFields);
  photo.push(entry(0x9000, 7, [48, 50, 51, 50])!, entry(0xa002, 4, width)!, entry(0xa003, 4, height)!);
  const gps = removeGps ? [] : collect(gpsFields);
  root.push(entry(0x8769, 4, 0)!);
  if (gps.length) root.push(entry(0x8825, 4, 0)!);
  const groups = [root, photo, ...(gps.length ? [gps] : [])];
  const offsets: number[] = [];
  let length = 8;
  for (const group of groups) {
    group.sort((a, b) => a.tag - b.tag);
    offsets.push(length);
    length += 2 + group.length * 12 + 4;
  }
  new DataView(root.find((v) => v.tag === 0x8769)!.bytes.buffer).setUint32(0, offsets[1], true);
  if (gps.length) new DataView(root.find((v) => v.tag === 0x8825)!.bytes.buffer).setUint32(0, offsets[2], true);
  for (const group of groups) for (const item of group) if (item.bytes.length > 4) length += item.bytes.length + item.bytes.length % 2;
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  bytes.set([73, 73, 42, 0, 8, 0, 0, 0]);
  let dataOffset = offsets.at(-1)! + 2 + groups.at(-1)!.length * 12 + 4;
  groups.forEach((group, index) => {
    view.setUint16(offsets[index], group.length, true);
    group.forEach((item, j) => {
      const offset = offsets[index] + 2 + j * 12;
      view.setUint16(offset, item.tag, true);
      view.setUint16(offset + 2, item.type, true);
      view.setUint32(offset + 4, item.count, true);
      if (item.bytes.length <= 4) bytes.set(item.bytes, offset + 8);
      else {
        view.setUint32(offset + 8, dataOffset, true);
        bytes.set(item.bytes, dataOffset);
        dataOffset += item.bytes.length + item.bytes.length % 2;
      }
    });
  });
  return bytes;
}

export async function attachJpegExif(blob: Blob, source: File, width: number, height: number, removeGps: boolean) {
  // Re-read untranslated values only when exporting, so GPS never enters
  // presets and a batch does not retain every full-resolution file in memory.
  const options = { pick: exportExifTags, translateValues: false, reviveValues: false, silentErrors: false };
  let tags: Tags = {};
  const fromBuffer = async () => {
    const bufferOptions = { ...options, chunked: false } as Parameters<typeof exifr.parse>[1];
    return (await exifr.parse(await source.arrayBuffer(), bufferOptions)) || {};
  };
  const fromFile = async () => (await exifr.parse(source, options)) || {};
  const small = source.size <= 16 * 1024 * 1024;
  let readSucceeded = false;
  try { tags = await (small ? fromBuffer() : fromFile()); readSucceeded = true; } catch { /* Retry below. */ }
  if (!['Model', 'FNumber', 'ExposureTime', 'ISO', 'FocalLength'].every((key) => tags[key] !== undefined)) {
    try {
      const extra = await (small ? fromFile() : fromBuffer());
      for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== null && value !== '') tags[key] = value;
      readSucceeded = true;
    } catch {
      if (!readSucceeded) throw new Error('无法读取原图拍摄信息');
    }
  }
  const tiff = buildExif(tags, width, height, removeGps);
  const length = tiff.length + 8;
  if (length > 65535) throw new Error('EXIF 信息过大，无法写入 JPG');
  const header = new Uint8Array([0xff, 0xe1, length >> 8, length & 255, 69, 120, 105, 102, 0, 0]);
  const soi = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (soi[0] !== 0xff || soi[1] !== 0xd8) throw new Error('导出文件不是有效 JPG');
  return new Blob([soi, header, tiff, blob.slice(2)], { type: 'image/jpeg' });
}

export function rotationSize(width: number, height: number, turns: number) {
  return Math.abs(turns % 2) === 1 ? { width: height, height: width } : { width, height };
}

