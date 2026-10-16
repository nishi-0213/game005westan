import test from 'node:test';
import assert from 'node:assert/strict';
import { initialClothing, clothingArmor, totalArmor, equippedMassKg, carriedMassKg, carryCapacity, initialItems, countItems } from '../src/items.ts';
import { attackDamage } from '../src/combat.ts';
import { Storage } from '../src/storage.ts';
import { Walls } from '../src/walls.ts';

test('initial clothes have three slots, weigh 2.3kg and provide armor4',()=>{
 const worker={clothing:initialClothing(),weapon:'unarmed',armor:0,inventory:{type:'wood',quantity:10}};
 assert.deepEqual(worker.clothing,{head:'hat',torso:'jacket',legs:'trousers'});
 assert.equal(clothingArmor(worker),4);assert.equal(equippedMassKg(worker),2.3);assert.equal(carriedMassKg(worker),12.3);
 assert.equal(carryCapacity(worker,'wood'),17);
 worker.weapon='rifle';assert.equal(carriedMassKg(worker),17.3);assert.equal(carryCapacity(worker,'wood'),12);
 assert.equal(attackDamage(50,2,totalArmor(worker)),25);
 assert.equal(attackDamage(30,4,totalArmor(worker)),30);
 worker.clothing.outerwear='ballisticVest';worker.clothing.arms='gloves';
 assert.equal(totalArmor(worker),8);assert.equal(carriedMassKg({...worker,inventory:null}),17.5);assert.equal(carryCapacity(worker,'wood'),2);
 assert.equal(attackDamage(30,4,totalArmor(worker)),15);
 assert.notEqual(initialClothing(),initialClothing());
});
test('clothing stacks participate in storage and item counts',()=>{
 const counts=countItems(initialItems());assert.equal(counts.ballisticVest,1);assert.equal(counts.gloves,1);
 const walls=new Walls(32),storage=new Storage(walls),box=walls.plan({column:3,row:3},'wood','storage');walls.complete(box);
 assert.equal(storage.deposit(box,'ballisticVest',1),1);assert.equal(storage.deposit(box,'gloves',1),1);
 assert.equal(storage.totals().ballisticVest,1);assert.equal(storage.sources('gloves')[0].quantity,1);
});

test('portrait geometry contains each equipped slot and layers outerwear above the torso',async()=>{
 const {clothingShapes}=await import('../src/clothing-shapes.ts');
 const initial=initialClothing(),base=clothingShapes(initial);assert.equal(base.length,5);
 const full=clothingShapes({...initial,outerwear:'ballisticVest',arms:'gloves'});assert.equal(full.length,9);
 assert.ok(full.findIndex(shape=>shape.color===0x555e46)>full.findIndex(shape=>shape.color===0x6386a1));
 assert.equal(clothingShapes({}).length,0);assert.equal(clothingShapes({arms:'gloves'}).length,2);
});
