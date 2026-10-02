import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the page's export lifecycle without a DOM dependency.
const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const start = page.indexOf('  const exportPhoto =');
const end = page.indexOf('  const saveDownload =', start);
const code = ts.transpileModule(page.slice(start, end), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
} }).outputText;

function exporter(failAt, editedMeta) {
  const source = { name: 'camera.JPG' };
  const canvas = { width: 300, height: 150 };
  const image = { width: 6192, height: 4128, cleanup: () => { cleanupCount += 1; } };
  let cleanupCount = 0;
  let metadataCount = 0;
  const fail = (stage) => { if (stage === failAt) throw new Error(stage); };
  const environment = {
    document: { createElement: () => canvas }, window: { setTimeout: (fn) => fn() },
    readPhotoFile: async (file, preview = false) => {
      assert.equal(file, source); assert.equal(preview, false);
      fail('decode'); return { image, meta: { iso: 'ISO 400' } };
    },
    drawWatermark: (target, original, meta) => {
      assert.equal(original, image);
      if (editedMeta) assert.equal(meta, editedMeta);
      else assert.equal(meta.iso, 'ISO 400');
      target.width = 6192; target.height = 4902; fail('render');
    },
    canvasToBlob: async (target) => {
      assert.equal(target.width, 6192); assert.equal(target.height, 4902);
      fail('encode'); return new Blob(['encoded']);
    },
    releaseCanvas: (target) => { target.width = target.height = 0; },
    attachJpegExif: async (blob, file, width, height) => {
      // EXIF uses captured output dimensions even after releasing the pixel store.
      assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
      assert.equal(cleanupCount, 1); assert.equal(file, source);
      assert.equal(width, 6192); assert.equal(height, 4902);
      metadataCount += 1; fail('metadata'); return blob;
    },
    exportFormat: 'jpeg', preserveExif: true, removeGps: true,
    theme: 'light', detailMode: 'full', watermarkHeight: 12.5, activeCameraAsset: null, customLensAsset: null,
    compactLensAsset: null, zoom18135LensAsset: null, signature: '', accentColor: '#ffffff',
    lensImageEnabled: false, holidayId: 'none', layoutMode: 'auto', parameterVisibility: {}, rotation: 0,
  };
  const keys = Object.keys(environment);
  const exportPhoto = new Function(...keys, `${code}\nreturn exportPhoto;`)(...keys.map((key) => environment[key]));
  return { run: () => exportPhoto(source, editedMeta), canvas, counts: () => ({ cleanupCount, metadataCount }) };
}

test('single export re-decodes the original and releases full-size rasters before EXIF writes', async () => {
  const fixture = exporter(undefined, { iso: 'ISO 123' });
  assert.equal(await (await fixture.run()).text(), 'encoded');
  assert.deepEqual(fixture.counts(), { cleanupCount: 1, metadataCount: 1 });
  assert.deepEqual(fixture.canvas, { width: 0, height: 0 });
});

for (const stage of ['decode', 'render', 'encode', 'metadata']) {
  test(`failure during ${stage} releases allocated canvas and decoded source`, async () => {
    const fixture = exporter(stage);
    await assert.rejects(fixture.run, new RegExp(stage));
    assert.deepEqual(fixture.canvas, { width: 0, height: 0 });
    assert.equal(fixture.counts().cleanupCount, stage === 'decode' ? 0 : 1);
  });
}
