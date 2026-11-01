import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const code=ts.transpileModule(readFileSync('app/auto-color.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function setup(value){let calls=0;const canvas={width:64,height:64,getContext:()=>({drawImage(){calls++},getImageData:()=>({data:new Uint8ClampedArray([value,value,value,255])})})};const exports={};new Function('exports','document',code)(exports,{createElement:()=>canvas});return {filter:exports.autoColorFilter,canvas,calls:()=>calls};}
test('disabled adjustment skips decoding and leaves original colors',()=>{const f=setup(20);assert.equal(f.filter({},0),'none');assert.equal(f.calls(),0)});
test('dark and bright scenes receive bounded opposite exposure adjustments',()=>{for(const [input,expected] of [[20,1.18],[240,.9]]){const f=setup(input);const source={};const result=f.filter(source,100);assert.ok(result.startsWith('brightness('+expected+')'));f.filter(source,50);assert.equal(f.calls(),1);assert.equal(f.canvas.width,0);assert.equal(f.canvas.height,0)}});
