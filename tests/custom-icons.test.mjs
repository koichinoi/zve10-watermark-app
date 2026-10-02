import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import exifr from 'exifr';
function module(source, dependencies={}) {
 const exports={}; const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 new Function('exports','require',code)(exports,name=>dependencies[name]);return exports;
}
const processing=module(await readFile(new URL('../app/photo-processing.ts',import.meta.url),'utf8'));
const icons=module(await readFile(new URL('../app/custom-icons.ts',import.meta.url),'utf8'),{'exifr':exifr,'./photo-processing':processing});
const gallery=module(await readFile(new URL('../app/gear-gallery.ts',import.meta.url),'utf8')).gearGallery;
test('icon storage discards corrupted, remote and non-PNG values',()=>{
 for(const value of [null,'{broken','null','[]','42'])assert.deepEqual(icons.readCustomIcons(value),{camera:null,lens:null});
 const valid={name:'Camera',dataUrl:'data:image/png;base64,YWJj'};
 const saved=icons.readCustomIcons(JSON.stringify({camera:{...valid,photo:'private'},lens:{name:'Lens',dataUrl:'https://example.com/lens.png'}}));
 assert.deepEqual(saved,{camera:valid,lens:null});
 for(const invalid of [{...valid,name:''},{...valid,name:'a'.repeat(129)},{...valid,dataUrl:'data:image/svg+xml;base64,YWJj'},{...valid,dataUrl:'data:image/png;base64,'+'a'.repeat(1500000)}])assert.equal(icons.readCustomIcons(JSON.stringify({camera:invalid})).camera,null);
});
test('wide and tall artwork stays within its slot and retains aspect ratio',()=>{
 for(const [w,h] of [[1800,180],[100,1000],[640,375]]){const result=icons.fitArtwork(w,h,120,60);assert.ok(result.width<=120&&result.height<=60);assert.ok(Math.abs(result.width/result.height-w/h)<1e-9);}
});
test('invalid or oversized icon files are rejected before image decoding',async()=>{
 await assert.rejects(()=>icons.prepareCustomIcon(new File([],'empty.png')),/10 MB/);
 await assert.rejects(()=>icons.prepareCustomIcon(new File([new Uint8Array(10*1024*1024+1)],'large.png')),/10 MB/);
 await assert.rejects(()=>icons.prepareCustomIcon(new File(['<svg/>'],'fake.png')),/PNG/);
});
test('all eight gallery choices have unique IDs and existing local image assets',async()=>{
 assert.equal(gallery.length,8);assert.equal(new Set(gallery.map(a=>a.id)).size,8);
 assert.equal(gallery.filter(a=>a.kind==='camera').length,3);assert.equal(gallery.filter(a=>a.kind==='lens').length,5);
 for(const artwork of gallery){assert.ok(!artwork.src.includes('://'));const bytes=await readFile(new URL('../public/'+artwork.src,import.meta.url));assert.ok(await processing.readRasterSize(new Blob([bytes])),artwork.src);}
});
