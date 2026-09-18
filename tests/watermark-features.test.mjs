import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import exifr from 'exifr';

async function loadHelpers(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, () => exifr);
  return exports;
}
const { buildExif, attachJpegExif, rotationSize } = await loadHelpers('../app/photo-export.ts');
const { readPresets } = await loadHelpers('../app/watermark-presets.ts');
const original = {
  Make: 'SONY', Model: 'ZV-E10M2', FNumber: 6.3, ExposureTime: 1 / 30,
  ISO: 3200, FocalLength: 53, LensModel: 'E 18-135mm F3.5-5.6 OSS',
  LensInfo: [18, 135, 3.5, 5.6], ExposureCompensation: -0.7,
  Flash: 25, MeteringMode: 5, FocalLengthIn35mmFormat: 79,
  DateTimeOriginal: '2026:09:13 20:18:48', CreateDate: '2026:09:13 20:18:48',
  OffsetTimeOriginal: '+08:00', Orientation: 6,
  GPSVersionID: [2, 3, 0, 0], GPSLatitudeRef: 'N', GPSLatitude: [22, 18, 30.5],
  GPSLongitudeRef: 'E', GPSLongitude: [114, 10, 5], GPSAltitudeRef: 0, GPSAltitude: 25,
  SerialNumber: 'PRIVATE', MakerNote: [1, 2, 3],
};
function jpeg(tags, width = 1080, height = 1818, removeGps = true) {
  const tiff = buildExif(tags, width, height, removeGps);
  const length = tiff.length + 8;
  return Buffer.concat([Buffer.from([255, 216, 255, 225, length >> 8, length & 255, 69, 120, 105, 102, 0, 0]), tiff, Buffer.from([255, 217])]);
}
async function parse(bytes) {
  return exifr.parse(bytes, { translateValues: false, reviveValues: false });
}

test('EXIF round trip retains original exposure, lens and shooting time', async () => {
  const result = await parse(jpeg(original));
  for (const key of ['Make', 'Model', 'FNumber', 'ISO', 'FocalLength', 'LensModel', 'Flash', 'MeteringMode', 'DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal']) assert.equal(result[key], original[key], key);
  assert.deepEqual(result.LensInfo, original.LensInfo);
  assert.ok(Math.abs(result.ExposureTime - 1 / 30) < 0.000001);
  assert.equal(result.ExposureCompensation, -0.7);
  assert.equal(result.Orientation, 1);
  assert.equal(result.ExifImageWidth, 1080);
  assert.equal(result.ExifImageHeight, 1818);
  assert.equal(result.MakerNote, undefined);
  assert.equal(result.SerialNumber, undefined);
});

test('GPS removal omits all location data, while opt-in keeps coordinates', async () => {
  const removed = await parse(jpeg(original));
  assert.equal(Object.keys(removed).some((key) => key.startsWith('GPS') || key === 'latitude' || key === 'longitude'), false);
  const kept = await parse(jpeg(original, 1818, 1080, false));
  assert.deepEqual(kept.GPSLatitude, original.GPSLatitude);
  assert.deepEqual(kept.GPSLongitude, original.GPSLongitude);
  assert.equal(kept.GPSAltitude, 25);
});

test('attach JPEG metadata does not change the encoded image payload', async () => {
  const bytes = jpeg(original, 1080, 1616, false);
  const source = new File([bytes], 'original.JPG', { type: 'image/jpeg' });
  const payload = new Uint8Array([255, 216, 255, 218, 0, 2, 17, 18, 19, 255, 217]);
  const blob = await attachJpegExif(new Blob([payload], { type: 'image/jpeg' }), source, 1616, 1282, true);
  const exported = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(exported.slice(-payload.length + 2), payload.slice(2));
  const tags = await parse(exported);
  assert.equal(tags.Model, original.Model);
  assert.equal(tags.ExifImageWidth, 1616);
  assert.equal(tags.Orientation, 1);
  assert.equal(tags.GPSLatitude, undefined);
});

test('empty metadata does not invent a camera or exposure', async () => {
  const result = await parse(jpeg({}));
  assert.equal(result.Model, undefined);
  assert.equal(result.FNumber, undefined);
  assert.equal(result.Orientation, 1);
});

const settings = { theme: 'dark', detailMode: 'compact', exportFormat: 'jpeg', layoutMode: 'auto',
  watermarkHeight: 15, signature: 'PHOTO BY ME', accentColor: '#3976d5', lensImageEnabled: true,
  holidayId: 'none', parameterVisibility: { lens: true, date: false }, preserveExif: true, removeGps: true };
test('presets restore settings and discard photos, GPS and rotation', () => {
  const result = readPresets(JSON.stringify([{ name: '我的预设', settings: { ...settings, photo: 'private', rotation: 1, GPSLatitude: 20 } }]), ['lens', 'date'], ['none']);
  assert.deepEqual(result, [{ name: '我的预设', settings }]);
});
test('corrupt or invalid presets fail safely', () => {
  assert.deepEqual(readPresets('not json', ['lens'], ['none']), []);
  assert.deepEqual(readPresets(JSON.stringify([{ name: 'bad', settings: { ...settings, watermarkHeight: 999 } }]), ['lens'], ['none']), []);
  assert.deepEqual(readPresets(JSON.stringify([{ name: 'bad', settings: { ...settings, parameterVisibility: {} } }]), ['lens'], ['none']), []);
});
test('quarter turns swap dimensions and a full turn restores them', () => {
  assert.deepEqual(rotationSize(6192, 4128, 1), { width: 4128, height: 6192 });
  assert.deepEqual(rotationSize(6192, 4128, 2), { width: 6192, height: 4128 });
  assert.deepEqual(rotationSize(6192, 4128, 3), { width: 4128, height: 6192 });
  assert.deepEqual(rotationSize(6192, 4128, 4), { width: 6192, height: 4128 });
});

if (process.env.WATERMARK_EXIF_FIXTURE) {
  test('real phone photo retains shooting metadata after export', async () => {
    const bytes = await readFile(process.env.WATERMARK_EXIF_FIXTURE);
    const source = new File([bytes], 'phone.JPG', { type: 'image/jpeg' });
    const blob = await attachJpegExif(new Blob([new Uint8Array([255, 216, 255, 217])]), source, 1080, 1818, true);
    const actual = await parse(new Uint8Array(await blob.arrayBuffer()));
    for (const key of ['Make', 'Model', 'FNumber', 'ISO', 'FocalLength', 'LensModel']) assert.equal(actual[key], original[key], key);
    assert.equal(actual.DateTimeOriginal, original.DateTimeOriginal);
    assert.equal(actual.Orientation, 1);
  });
}

