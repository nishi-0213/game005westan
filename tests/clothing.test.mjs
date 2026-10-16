import test from 'node:test';
import assert from 'node:assert/strict';
import { initialClothing, armorForPart, equippedMassKg, carriedMassKg, carryCapacity, initialItems, countItems } from '../src/items.ts';
import { attackDamage } from '../src/combat.ts';
import { Storage } from '../src/storage.ts';
import { Walls } from '../src/walls.ts';

test('initial clothes weigh 2.3kg and protect only their covered body parts',()=>{
 const worker={clothing:initialClothing(),weapon:'unarmed',armor:0,inventory:{type:'wood',quantity:10}};
 assert.deepEqual(worker.clothing,{head:'hat',torso:'jacket',legs:'trousers'});
 assert.deepEqual(['head','torso','arms','legs'].map(part=>armorForPart(worker,part)),[1,2,0,1]);assert.equal(equippedMassKg(worker),2.3);assert.equal(carriedMassKg(worker),12.3);
 assert.equal(carryCapacity(worker,'wood'),17);
 worker.weapon='rifle';assert.equal(carriedMassKg(worker),17.3);assert.equal(carryCapacity(worker,'wood'),12);
 assert.equal(attackDamage(50,2,armorForPart(worker,'torso')),50);
 assert.equal(attackDamage(30,4,armorForPart(worker,'torso')),30);
 worker.clothing.outerwear='ballisticVest';worker.clothing.arms='gloves';
 assert.equal(armorForPart(worker,'torso'),5);assert.equal(carriedMassKg({...worker,inventory:null}),17.5);assert.equal(carryCapacity(worker,'wood'),2);
 assert.equal(attackDamage(30,4,armorForPart(worker,'torso')),15);
 assert.notEqual(initialClothing(),initialClothing());
});
test('clothing stacks participate in storage and item counts',()=>{
 const counts=countItems(initialItems());assert.equal(counts.ballisticVest,1);assert.equal(counts.gloves,1);
 const walls=new Walls(32),storage=new Storage(walls),box=walls.plan({column:3,row:3},'wood','storage');walls.complete(box);
 assert.equal(storage.deposit(box,'ballisticVest',1),1);assert.equal(storage.deposit(box,'gloves',1),1);
 assert.equal(storage.totals().ballisticVest,1);assert.equal(storage.sources('gloves')[0].quantity,1);
});

test('clothing layers use uploaded PNGs in consistent back-to-front order including gloves',async()=>{
 const {clothingShapes}=await import('../src/clothing-shapes.ts');
 const {clothingLayers}=await import('../src/clothing-layers.ts');
 assert.equal(clothingShapes(initialClothing()).length,0);
 const full={...initialClothing(),outerwear:'ballisticVest',arms:'gloves'},layers=clothingLayers(full);
 assert.deepEqual(layers.map(layer=>layer.slot),['legs','torso','arms','outerwear','head']);
 assert.deepEqual(layers.map(layer=>layer.sprite),['trousers','jacket','gloves','ballisticVest','hat']);
 assert.equal(clothingShapes(full).length,2);assert.equal(clothingShapes({}).length,0);
 assert.deepEqual(clothingLayers({}),[]);
});
