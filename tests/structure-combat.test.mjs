import test from 'node:test';import assert from 'node:assert/strict';
import {Combat,WEAPONS} from '../src/combat.ts';import {Walls} from '../src/walls.ts';import {Construction} from './helpers/construction.mjs';import {Harvesting} from '../src/harvesting.ts';import {Hauling} from '../src/hauling.ts';import {Storage} from '../src/storage.ts';import {createMovement} from '../src/movement.ts';import {initialNeeds} from '../src/needs.ts';import {destroyStructure} from '../src/demolition.ts';import {createWolf} from '../src/wildlife.ts';import {countItems} from '../src/items.ts';
const tile=(column,row)=>({column,row});
function scene(kind='wall'){const walls=new Walls(16),items=[],construction=new Construction(walls,items,t=>walls.complete(t)),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,new Storage(walls)),combat=new Combat(construction,harvesting,hauling,()=>0),structure=walls.plan(tile(6,5),'wood',kind);walls.complete(structure);combat.onDestroyStructure=w=>destroyStructure(walls,items,w);
const pawn={kind:'human',faction:'player',mode:'drafted',weapon:'rifle',movement:createMovement(tile(2,5)),needs:initialNeeds(),hp:100,eatJob:null,inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0};return{walls,items,construction,harvesting,hauling,combat,structure,pawn};}
test('all completed building kinds have100HP, can be targeted and are destroyed once at0HP',()=>{
for(const weapon of ['unarmed','knife','rifle'])for(const kind of ['wall','door','barricade','storage','storageArea','butcher','cooker','torch','bed','table','chair']){const s=scene(kind),target=s.combat.structureTarget(s.structure);s.pawn.weapon=weapon;if(weapon!=='rifle')s.pawn.movement=createMovement(tile(5,6));const {damage,interval}=WEAPONS[weapon];assert.equal(s.structure.hp,100);assert.equal(s.combat.structureTarget(s.structure),target);assert.equal(s.combat.requestAttack(s.pawn,target),true);s.combat.update(s.pawn,interval);assert.equal(s.structure.hp,100-damage);s.combat.update(s.pawn,interval*(Math.ceil(100/damage)-1));assert.equal(s.structure.hp,0);assert.equal(s.walls.at(s.structure),undefined);assert.equal(s.pawn.attackJob,null);assert.equal(target.dead,true);}
});
test('targeted walls and doors receive bullets, while another intervening wall still blocks the shot',()=>{
for(const kind of ['wall','door']){const s=scene(kind),target=s.combat.structureTarget(s.structure);assert.equal(s.combat.canFireFrom('rifle',s.pawn.movement.tile,target.movement.tile,s.structure),true);const blocker=s.walls.plan(tile(4,5),'wood');s.walls.complete(blocker);assert.equal(s.combat.canFireFrom('rifle',s.pawn.movement.tile,target.movement.tile,s.structure),false);}
});
test('animals cannot attack buildings and planned buildings are not valid attack targets',()=>{
const s=scene(),target=s.combat.structureTarget(s.structure),wolf=createWolf(tile(5,5),1);assert.equal(s.combat.requestPredation(wolf,target),false);wolf.faction='player';wolf.mode='drafted';assert.equal(s.combat.requestAttack(wolf,target),false);const plan=s.walls.plan(tile(8,5),'wood');assert.equal(s.combat.requestAttack(s.pawn,s.combat.structureTarget(plan)),false);
});
test('structure destruction refunds half materials, preserves stored item counts and cancels other attackers',()=>{
const s=scene('storage');s.structure.stored.wood=20;s.structure.stored.meat=10;const target=s.combat.structureTarget(s.structure),other={...s.pawn,movement:createMovement(tile(2,6))};s.combat.requestAttack(s.pawn,target);s.combat.requestAttack(other,target);s.combat.update(s.pawn,7.5);s.combat.update(other,7.5);assert.equal(other.attackJob,null);const counts=countItems(s.items);assert.equal(counts.wood,35);assert.equal(counts.meat,10);
});

test('multi-tile furniture can be hit at its far edge by melee or rifle without approaching the anchor',()=>{
const s=scene('table'),target=s.combat.structureTarget(s.structure);s.pawn.weapon='knife';s.pawn.movement=createMovement(tile(8,5));let event;s.combat.onAttack=e=>event=e;assert.equal(s.combat.requestAttack(s.pawn,target),true);assert.deepEqual(s.pawn.movement.destination,tile(8,5));s.combat.update(s.pawn,.1);assert.equal(s.structure.hp,50);assert.deepEqual(event.to,tile(7,5));
assert.equal(s.combat.canFireFrom('rifle',tile(23,5),target.movement.tile,s.structure),true);const wall=s.walls.plan(tile(10,5),'wood');s.walls.complete(wall);assert.equal(s.combat.canFireFrom('rifle',tile(23,5),target.movement.tile,s.structure),false);
});
test('missed rifle shots damage their actual building impact, preserve the intended target, and ignore plans',()=>{
for(const kind of ['wall','door','chair','table','planned','stoneFloor','woodFloor']){
 const s=scene('chair'),target=s.combat.structureTarget(s.structure),impact=s.walls.plan(tile(7,5),'wood',kind==='planned'?'wall':kind);if(kind!=='planned')s.walls.complete(impact);
 let draws=[.9,0,0],event;s.combat.random=()=>draws.shift()??0;s.combat.onAttack=e=>event=e;s.combat.requestAttack(s.pawn,target);s.combat.update(s.pawn,.4);
 if(kind==='stoneFloor'||kind==='woodFloor'){assert.equal(impact.hp,undefined);assert.equal(impact.state,'completed');assert.equal(event.impactStructure,undefined);assert.equal(event.damage,0);assert.equal(s.combat.requestAttack(s.pawn,s.combat.structureTarget(impact)),false);continue;}
 assert.equal(event.hit,false);assert.equal(s.structure.hp,100);assert.equal(impact.hp,kind==='planned'?100:70);assert.equal(event.impactStructure,kind==='planned'?undefined:impact);assert.equal(event.damage,kind==='planned'?0:30);
 if(kind!=='planned'){draws=[.9,0,0,.9,0,0,.9,0,0];s.combat.update(s.pawn,1.2);assert.equal(s.walls.at(impact),undefined);assert.equal(s.structure.hp,100);}
}
});
