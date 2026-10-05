import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../app/photo-processing.ts',import.meta.url),'utf8');const exports={};new Function('exports',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(exports);
const {fitLongEdge,watermarkOutputSize}=exports;
test('share dimensions bound the entire watermarked image after rotation',()=>{
 assert.deepEqual(watermarkOutputSize(6192,4128,12.5),{width:6192,height:4902});
 for(const edge of [2048,1080])for(const turn of [0,1,2,3])for(const [w,h] of [[6192,4128],[4128,6192],[4000,4000]]){
  const original=watermarkOutputSize(w,h,12.5,turn);const size=watermarkOutputSize(w,h,12.5,turn,edge);
  assert.ok(Math.max(size.width,size.height)<=edge);assert.ok(Math.max(size.width,size.height)>=edge-1);
  assert.ok(Math.abs(size.width/size.height-original.width/original.height)<.003);
 }
});
test('small images keep native pixels and the minimum watermark band',()=>{
 assert.deepEqual(watermarkOutputSize(320,200,8,0,1080),{width:320,height:272});
 assert.deepEqual(watermarkOutputSize(320,200,8,1,1080),{width:200,height:392});
 assert.deepEqual(fitLongEdge(512,256,2048),{width:512,height:256});
});
test('watermark height affects portrait export dimensions before resizing',()=>{
 assert.deepEqual(watermarkOutputSize(3200,2000,12.5,0,2048),{width:2048,height:1536});
 assert.deepEqual(watermarkOutputSize(3200,2000,12.5,1,1080),{width:600,height:1080});
 assert.deepEqual(watermarkOutputSize(3200,2000,22,1,1080),{width:553,height:1080});
});
