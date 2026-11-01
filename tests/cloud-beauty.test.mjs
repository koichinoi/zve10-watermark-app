import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync('app/cloud-beauty.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports);
test('cloud URLs reject credentials, mixed content and remote use of local relay', () => {
  assert.throws(()=>exports.cloudBase('http://192.168.1.2/v1','https://example.com'));
  assert.throws(()=>exports.cloudBase('https://key:secret@example.com/v1','https://example.com'));
  assert.throws(()=>exports.cloudBase('/api/cloud','https://example.com'));
  assert.equal(exports.cloudBase('/api/cloud','http://127.0.0.1:5188'),'/api/cloud');
  assert.equal(exports.cloudBase('https://example.com/v1/','https://example.org'),'https://example.com/v1');
});
test('cloud payload rejects non-image output and invalid base64', async () => {
  const signal=new AbortController().signal;
  await assert.rejects(()=>exports.cloudImage({data:[{b64_json:btoa('<html>bad</html>')}]},signal));
  await assert.rejects(()=>exports.cloudImage({data:[{b64_json:'***'}]},signal));
  await assert.rejects(()=>exports.cloudImage({data:[{url:'http://unsafe/image.png'}]},signal));
  await assert.rejects(()=>exports.cloudImage({},signal));
});
test('bounded response stops oversized streaming bodies', async () => {
  await assert.rejects(()=>exports.limitedBlob(new Response('0123456789'),5));
  assert.equal(await (await exports.limitedBlob(new Response('ok'),5)).text(),'ok');
});
