import {createDeer,createWolf} from '../src/wildlife.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {updateMood,moodEffects,rememberMood,canGiveOrders} from '../src/mood.ts';
const pawn=()=>({kind:'human',needs:{satiety:100,wakefulness:100,happiness:50}});
test('happiness starts at50, combines need modifiers, and only values below25 prohibit player orders',()=>{
 const p=pawn();updateMood(p,0);assert.equal(p.needs.happiness,50);p.needs.satiety=20;p.needs.wakefulness=20;updateMood(p,0);assert.equal(p.needs.happiness,35);assert.equal(moodEffects(p).length,2);
 assert.equal(canGiveOrders({needs:{happiness:25}}),true);assert.equal(canGiveOrders({needs:{happiness:24.99}}),false);p.needs.satiety=0;updateMood(p,0);assert.equal(p.needs.happiness,20);assert.equal(moodEffects(p).some(e=>e.label==='お腹が空いた'),false);
 for(const create of [createDeer,createWolf]){const animal=create({column:1,row:1},1);rememberMood(animal,'killedHuman');updateMood(animal,60);assert.equal(animal.needs.happiness,undefined);assert.equal(animal.moodMemories,undefined);}
});
test('standing meals refresh one5hour memory; human kills stack and each expires after72hours',()=>{
 const p=pawn();rememberMood(p,'standingMeal');assert.equal(p.needs.happiness,47);updateMood(p,9);rememberMood(p,'standingMeal');assert.equal(p.moodMemories.length,1);updateMood(p,9.99);assert.equal(p.needs.happiness,47);updateMood(p,.01);assert.equal(p.needs.happiness,50);
 rememberMood(p,'killedHuman');updateMood(p,1);rememberMood(p,'killedHuman');assert.equal(p.needs.happiness,0);assert.deepEqual(moodEffects(p),[{label:'人を無力化した',amount:-60,count:2}]);updateMood(p,143);assert.equal(p.needs.happiness,20);assert.equal(canGiveOrders(p),false);updateMood(p,1);assert.equal(p.needs.happiness,50);assert.equal(canGiveOrders(p),true);
});

test('hunger mood applies through40percent, stops above40and is replaced by starvation at0',()=>{
 const p=pawn();
 for(const [satiety,hungry,starving] of [[40.01,false,false],[40,true,false],[30,true,false],[.01,true,false],[0,false,true]]){
  p.needs.satiety=satiety;const effects=moodEffects(p);
  assert.equal(effects.some(effect=>effect.label==='お腹が空いた'),hungry);
  assert.equal(effects.some(effect=>effect.label==='飢餓'),starving);
 }
});
