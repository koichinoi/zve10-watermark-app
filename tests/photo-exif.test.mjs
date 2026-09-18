import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import exifr from 'exifr';

// Exercise the same helpers used by the page without publishing personal photos.
const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const start = page.indexOf('const photoExifTags =');
const end = page.indexOf('function isSupportedPhoto', start);
const code = ts.transpileModule(page.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function helpers(parse) {
  return new Function('exifr', `${code}\nreturn { parsePhotoExif, hasCoreExif };`)({ parse });
}
const complete = {
  Model: 'ZV-E10M2', FNumber: 6.3, ExposureTime: 1 / 30,
  ISO: 3200, FocalLength: 53, LensModel: 'E 18-135mm F3.5-5.6 OSS',
};
const buffer = new ArrayBuffer(16);
const smallFile = { name: 'DSC00297.JPG', type: 'image/jpeg', size: 327763, arrayBuffer: async () => buffer };
const largeFile = { ...smallFile, size: 32 * 1024 * 1024 };

test('small JPEG is read as one buffer, without sliced File reads', async () => {
  const { parsePhotoExif } = helpers(async (input, options) => {
    assert.equal(input, buffer);
    assert.equal(options.chunked, false);
    return complete;
  });
  assert.deepEqual(await parsePhotoExif(smallFile), complete);
});

test('partial success triggers buffer retry and retains complementary fields', async () => {
  let calls = 0;
  const { parsePhotoExif } = helpers(async (input) => {
    calls += 1;
    return input === largeFile ? { LensModel: complete.LensModel, MeteringMode: 'Pattern' } : complete;
  });
  assert.deepEqual(await parsePhotoExif(largeFile), { ...complete, MeteringMode: 'Pattern' });
  assert.equal(calls, 2);
});

test('failed retry does not erase useful partial metadata', async () => {
  const partial = { LensModel: complete.LensModel, FocalLengthIn35mmFormat: 79 };
  const { parsePhotoExif } = helpers(async (input) => {
    if (input === buffer) throw new Error('read failed');
    return partial;
  });
  assert.deepEqual(await parsePhotoExif(largeFile), partial);
});

test('whole-file read failure falls back to File reader', async () => {
  const file = { ...smallFile, arrayBuffer: async () => { throw new Error('unsupported'); } };
  const { parsePhotoExif } = helpers(async (input) => {
    assert.equal(input, file);
    return complete;
  });
  assert.deepEqual(await parsePhotoExif(file), complete);
});

test('missing or invalid core parameters are reported as incomplete', () => {
  const { hasCoreExif } = helpers(async () => ({}));
  assert.equal(hasCoreExif(complete), true);
  assert.equal(hasCoreExif({ ...complete, ISO: undefined }), false);
  assert.equal(hasCoreExif({ ...complete, FNumber: NaN }), false);
});

// Optional local fixture: node --test tests/photo-exif.test.mjs with this env set.
const fixturePath = process.env.WATERMARK_EXIF_FIXTURE;
if (fixturePath) {
  test('real phone JPEG retains all reported shooting parameters', async () => {
    const bytes = await readFile(fixturePath);
    const file = {
      name: 'DSC00297.JPG', type: 'image/jpeg', size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
    const { parsePhotoExif, hasCoreExif } = helpers(exifr.parse);
    const actual = await parsePhotoExif(file);
    assert.equal(hasCoreExif(actual), true);
    for (const [key, value] of Object.entries(complete)) assert.equal(actual[key], value, key);
    assert.equal(actual.FocalLengthIn35mmFormat, 79);
  });
}

