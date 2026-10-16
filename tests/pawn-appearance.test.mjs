import test from 'node:test';
import assert from 'node:assert/strict';
import { randomPawnAppearance, recolorPawnLayers, splitPawnLayers } from '../src/pawn-appearance.ts';

test('appearance is sampled once from three independent random choices and remains bounded',()=>{
 let calls=0;const appearance=randomPawnAppearance(()=>{calls++;return .999});
 assert.equal(calls,3);assert.deepEqual(appearance,{skinRed:1,skinDark:.65,eyeSaturation:1});
 assert.deepEqual(randomPawnAppearance(()=>0),{skinRed:0,skinDark:0,eyeSaturation:.2});
 assert.equal(new Set(Array.from({length:6},(_,i)=>JSON.stringify(randomPawnAppearance(()=>i/6)))).size,6);
});
test('skin red and black adjustments preserve outlines, transparency, neutral details and source pixels',()=>{
 const body=new Uint8ClampedArray([255,217,209,255,255,167,150,255,211,167,167,255,0,0,0,255,255,255,255,255,255,217,209,0]);
 const original=body.slice(),eyes=new Uint8ClampedArray(body.length),layers={width:6,height:1,body,eyes};
 const plain=recolorPawnLayers(layers,{skinRed:0,skinDark:0,eyeSaturation:1});assert.deepEqual(plain.body,body);
 const red=recolorPawnLayers(layers,{skinRed:1,skinDark:0,eyeSaturation:1});assert.equal(red.body[0],255);assert.ok(red.body[1]<217);assert.ok(red.body[2]<209);
 const dark=recolorPawnLayers(layers,{skinRed:1,skinDark:.65,eyeSaturation:1});assert.ok(dark.body[0]<red.body[0]);assert.ok(dark.body[1]<red.body[1]);
 assert.ok(dark.body[0]>dark.body[8]);assert.deepEqual(dark.body.slice(12),original.slice(12));
 assert.deepEqual(body,original);assert.notEqual(dark.body,body);assert.deepEqual(dark.eyes,eyes);
});
test('eye saturation changes only the eye layer, preserving blue hue, highlights and alpha',()=>{
 const layers={width:3,height:1,body:new Uint8ClampedArray(12),eyes:new Uint8ClampedArray([0,0,255,255,255,255,255,255,0,0,0,0])};
 const vivid=recolorPawnLayers(layers,{skinRed:0,skinDark:0,eyeSaturation:1});assert.deepEqual(vivid.eyes,layers.eyes);
 const muted=recolorPawnLayers(layers,{skinRed:0,skinDark:0,eyeSaturation:.2});assert.deepEqual([...muted.eyes.slice(0,4)],[102,102,153,255]);
 assert.deepEqual(muted.eyes.slice(4),layers.eyes.slice(4));assert.deepEqual(muted.body,layers.body);
});
test('compatibility split extracts only the original eye positions and replaces them with skin on the body',()=>{
 const pixels=new Uint8ClampedArray(32*32*4);for(let i=0;i<pixels.length;i+=4)pixels.set([255,217,209,255],i);
 const eye=(10*32+11)*4,highlight=(10*32+12)*4;pixels.set([64,64,64,255],eye);pixels.set([255,255,255,255],highlight);
 const original=pixels.slice(),layers=splitPawnLayers(pixels,32,32);assert.deepEqual([...layers.eyes.slice(eye,eye+4)],[0,0,255,255]);
 assert.deepEqual([...layers.eyes.slice(highlight,highlight+4)],[255,255,255,255]);assert.deepEqual([...layers.body.slice(eye,eye+4)],[255,217,209,255]);
 assert.equal(layers.eyes[3],0);assert.deepEqual(pixels,original);assert.throws(()=>splitPawnLayers(pixels,16,16));
});
