import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const exports = {};
new Function('exports', ts.transpileModule(await readFile(new URL('../app/icon-crop.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(exports);
const { detectIconCrop, adjustCrop, fullCrop } = exports;
function fixture(background, subject = true) {
  const data = new Uint8ClampedArray(100 * 80 * 4);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) {
    data.set(subject && x >= 30 && x < 70 && y >= 20 && y < 60 ? [40, 40, 40, 255] : background, (y * 100 + x) * 4);
  }
  return data;
}
test('transparent and solid margins produce a padded crop around the subject', () => {
  for (const [background, kind] of [[[0, 0, 0, 0], 'transparent'], [[255, 255, 255, 255], 'solid'], [[52, 80, 123, 255], 'solid']]) {
    assert.deepEqual(detectIconCrop(fixture(background), 100, 80), { kind, rect: { x: .28, y: .225, width: .44, height: .55 } });
  }
});
test('empty, all-transparent and uniform images keep the full rectangle', () => {
  for (const background of [[0, 0, 0, 0], [255, 255, 255, 255], [15, 20, 35, 255]]) {
    assert.deepEqual(detectIconCrop(fixture(background, false), 100, 80), { kind: 'none', rect: fullCrop });
  }
  assert.equal(detectIconCrop(new Uint8ClampedArray(0), 100, 80).kind, 'none');
});
test('varied corners and borders fall back to manual cropping', () => {
  const varied = fixture([255, 255, 255, 255]); varied.set([100, 180, 20, 255], 0);
  assert.equal(detectIconCrop(varied, 100, 80).kind, 'none');
  const border = fixture([255, 255, 255, 255]);
  for (let x = 10; x < 90; x++) border.set([30, 30, 30, 255], x * 4);
  assert.equal(detectIconCrop(border, 100, 80).kind, 'none');
});
test('subject regions connected to the image edge remain inside the crop', () => {
  const data = fixture([0, 0, 0, 0]);
  for (let x = 0; x < 50; x++) data.set([0, 0, 0, 255], (40 * 100 + x) * 4);
  const { rect } = detectIconCrop(data, 100, 80);
  assert.equal(rect.x, 0); assert.ok(rect.width >= .7);
});
test('interior background-colored holes do not erase or split the subject', () => {
  const data = fixture([255, 255, 255, 255]);
  for (let y = 30; y < 50; y++) for (let x = 40; x < 60; x++) data.set([255, 255, 255, 255], (y * 100 + x) * 4);
  assert.deepEqual(detectIconCrop(data, 100, 80).rect, { x: .28, y: .225, width: .44, height: .55 });
});
test('dragging the crop keeps its size and clamps to the image', () => {
  assert.deepEqual(adjustCrop({ x: .2, y: .3, width: .4, height: .5 }, 'move', -5, 5), { x: 0, y: .5, width: .4, height: .5 });
});
test('all resize handles stay inside the image without flipping, including tiny crops', () => {
  for (const rect of [fullCrop, { x: .2, y: .3, width: .4, height: .5 }, { x: 0, y: 0, width: .01, height: .01 }]) {
    for (const handle of ['nw', 'ne', 'sw', 'se']) for (const dx of [-10, -.01, 0, .01, 10]) for (const dy of [-10, -.01, 0, .01, 10]) {
      const result = adjustCrop(rect, handle, dx, dy);
      assert.ok(result.x >= 0 && result.y >= 0);
      assert.ok(result.width > 0 && result.height > 0);
      assert.ok(result.x + result.width <= 1.000001 && result.y + result.height <= 1.000001);
    }
  }
});
