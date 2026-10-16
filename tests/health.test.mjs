import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBodyHp, healthHp, damageBodyPart, damageAllBodyParts } from '../src/health.ts';
import { initialClothing, armorForPart } from '../src/items.ts';

test('overview HP follows the lower of head and torso, independently of arms and legs',()=>{
 const p={hp:100,bodyHp:initialBodyHp()};damageBodyPart(p,'arms',100);damageBodyPart(p,'legs',100);
 assert.equal(healthHp(p),100);assert.equal(p.hp,100);
 damageBodyPart(p,'head',20);assert.equal(p.hp,80);damageBodyPart(p,'torso',30);assert.equal(p.hp,70);
 damageBodyPart(p,'head',100);assert.equal(p.hp,0);assert.equal(p.bodyHp.torso,70);
});
test('starvation damage is identical for every body part and ignores armor',()=>{
 const p={hp:80,bodyHp:{head:90,torso:80,arms:3,legs:70}};damageAllBodyParts(p,5);
 assert.deepEqual(p.bodyHp,{head:85,torso:75,arms:0,legs:65});assert.equal(p.hp,75);
 damageAllBodyParts(p,75);assert.equal(p.bodyHp.torso,0);assert.equal(p.hp,0);assert.equal(p.bodyHp.head,10);
});
test('body armor adds only clothing covering the hit part, including layered torso protection',()=>{
 const p={armor:0,clothing:initialClothing()};assert.deepEqual(['head','torso','arms','legs'].map(part=>armorForPart(p,part)),[1,2,0,1]);
 p.clothing.outerwear='ballisticVest';p.clothing.arms='gloves';
 assert.deepEqual(['head','torso','arms','legs'].map(part=>armorForPart(p,part)),[1,5,1,1]);
});
