import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../app/photo-processing.ts', import.meta.url), 'utf8');
const exports = {};
new Function('exports', ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText)(exports);
const { previewSize, previewMaxEdge, previewMaxPixels, readRasterSize, findEmbeddedJpegs, rawScanChunkBytes } = exports;

function jpeg(width, height) {
  return new Uint8Array([255, 216, 255, 192, 0, 11, 8, height >> 8, height & 255,
    width >> 8, width & 255, 1, 1, 17, 0, 255, 218, 0, 2, 255, 217]);
}

test('large portrait, landscape and square previews obey pixel and edge budgets', () => {
  for (const [width, height] of [[6192, 4128], [4128, 6192], [10000, 10000], [100, 30000]]) {
    const size = previewSize(width, height);
    assert.ok(Math.max(size.width, size.height) <= previewMaxEdge);
    assert.ok(size.width * size.height <= previewMaxPixels);
    assert.ok(Math.abs(size.width / size.height - width / height) < 0.002);
  }
  assert.deepEqual(previewSize(320, 240), { width: 320, height: 240 });
});

test('JPEG dimensions skip large metadata without reading the whole photo', async () => {
  const file = new Blob([jpeg(6192, 4128).slice(0, 2), new Uint8Array([255, 225, 234, 98]), new Uint8Array(60_000), jpeg(6192, 4128).slice(2)]);
  const reads = [];
  const sliced = { size: file.size, slice: (start, end) => { reads.push(end - start); return file.slice(start, end); } };
  assert.deepEqual(await readRasterSize(sliced), { width: 6192, height: 4128 });
  assert.ok(Math.max(...reads) <= 30);
});

test('PNG and all three WebP headers retain original dimensions', async () => {
  const png = new Uint8Array(30);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(png.buffer).setUint32(16, 6192);
  new DataView(png.buffer).setUint32(20, 4128);
  assert.deepEqual(await readRasterSize(new Blob([png])), { width: 6192, height: 4128 });
  for (const kind of ['VP8X', 'VP8 ', 'VP8L']) {
    const bytes = new Uint8Array(30);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode('RIFF'), 0);
    bytes.set(new TextEncoder().encode('WEBP' + kind), 8);
    if (kind === 'VP8X') bytes.set([255, 3, 0, 255, 1, 0], 24);
    if (kind === 'VP8 ') { bytes.set([157, 1, 42], 23); view.setUint16(26, 1024, true); view.setUint16(28, 512, true); }
    if (kind === 'VP8L') { bytes[20] = 47; view.setUint32(21, 1023 | (511 << 14), true); }
    assert.deepEqual(await readRasterSize(new Blob([bytes])), { width: 1024, height: 512 });
  }
});

test('unsupported, truncated and failed sliced reads allow decoder fallback', async () => {
  assert.equal(await readRasterSize(new Blob([jpeg(0, 10)])), null);
  assert.equal(await readRasterSize(new Blob([jpeg(100, 100).slice(0, 8)])), null);
  assert.equal(await readRasterSize(new Blob(['not a photo'])), null);
  assert.equal(await readRasterSize({ slice: () => { throw new Error('content provider'); } }), null);
});

test('RAW scan handles markers split across chunks and rejects an unfinished JPEG', async () => {
  const bytes = new Uint8Array(rawScanChunkBytes * 3 + 64);
  const firstStart = rawScanChunkBytes - 2;
  const firstEnd = rawScanChunkBytes * 2 + 1;
  bytes.set(jpeg(6192, 4128).slice(0, -2), firstStart);
  bytes.set([255, 217], firstEnd - 2);
  const secondStart = firstEnd + 10;
  const small = jpeg(640, 480);
  bytes.set(small, secondStart);
  bytes.set(jpeg(8192, 8192).slice(0, -2), rawScanChunkBytes * 3);
  const blob = new Blob([bytes]);
  const reads = [];
  const watch = (value) => ({
    size: value.size,
    slice: (start, end) => watch(value.slice(start, end)),
    arrayBuffer: () => { reads.push(value.size); return value.arrayBuffer(); },
  });
  const file = watch(blob);
  assert.deepEqual(await findEmbeddedJpegs(file), [
    { start: firstStart, end: firstEnd, width: 6192, height: 4128 },
    { start: secondStart, end: secondStart + small.length, width: 640, height: 480 },
  ]);
  assert.ok(Math.max(...reads) <= rawScanChunkBytes);
});
