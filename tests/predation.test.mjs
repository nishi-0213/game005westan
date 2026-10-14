import test from 'node:test';import assert from 'node:assert/strict';
import {Wildlife,createDeer,createWolf} from '../src/wildlife.ts';import {Combat} from '../src/combat.ts';import {CorpseEating} from '../src/corpse-eating.ts';import {Butchery,corpseItemType} from '../src/butchery.ts';import {Walls} from '../src/walls.ts';import {Construction} from '../src/construction.ts';import {Harvesting} from '../src/harvesting.ts';import {Hauling} from '../src/hauling.ts';import {Storage} from '../src/storage.ts';import {createMovement} from '../src/movement.ts';import {advancePathMovement} from '../src/pathfinding.ts';import {initialNeeds,updateNeeds,killPawn} from '../src/needs.ts';import {countItems,foodNutrition} from '../src/items.ts';
const tile=(column,row)=>({column,row});
function scene(){const walls=new Walls(16),items=[],storage=new Storage(walls),construction=new Construction(walls,items,t=>walls.complete(t)),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,storage),combat=new Combat(construction,harvesting,hauling,()=>0),wildlife=new Wildlife(construction,harvesting,hauling,()=>.5),players=[];
construction.storage=storage;const eating=new CorpseEating(construction,harvesting,hauling,()=>[...players,...wildlife.animals]);wildlife.combat=combat;wildlife.corpseEating=eating;wildlife.players=()=>players;
const human=(column=2,row=3)=>{const p={kind:'human',faction:'player',movement:createMovement(tile(column,row)),mode:'automatic',weapon:'unarmed',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,needs:initialNeeds(),hp:100,eatJob:null};players.push(p);return p};
const move=p=>advancePathMovement(p.movement,.1,16,walls.isBlocked,walls.cannotStop);const feed=p=>{eating.updateClaims();updateNeeds(p,construction,harvesting,hauling,.1,true,eating.automatic);move(p)};
return{walls,items,storage,construction,harvesting,hauling,combat,wildlife,players,eating,human,move,feed};}
test('hungry wolves hunt deer and consume the defeated body for100nutrition in1second',()=>{
const s=scene(),wolf=createWolf(tile(3,3),1),deer=createDeer(tile(4,3),2);s.wildlife.wolves.push(wolf);s.wildlife.deer.push(deer);deer.hp=20;s.wildlife.updateWolf(wolf,.1);assert.equal(wolf.attackJob,undefined);wolf.needs.satiety=20;
for(let i=0;i<100&&!deer.consumed;i++){s.eating.updateClaims();s.wildlife.updateWolf(wolf,.1);s.move(wolf);}assert.equal(deer.dead,true);assert.equal(deer.consumed,true);assert.equal(wolf.needs.satiety,100);assert.equal(countItems(s.items).meat,0);assert.equal(wolf.faction,'wild');
});
test('wolves prefer deer over a closer player and fall back to players when no reachable deer exists',()=>{
const s=scene(),wolf=createWolf(tile(1,3),1),deer=createDeer(tile(6,3),2),human=s.human(2,3);s.wildlife.wolves.push(wolf);s.wildlife.deer.push(deer);wolf.needs.satiety=20;s.wildlife.updateWolf(wolf,0);assert.equal(wolf.attackJob.target,deer);
s.combat.cancel(wolf);wolf.prey=undefined;wolf.decisionSeconds=0;for(let row=0;row<16;row++){const wall=s.walls.plan(tile(4,row),'wood',row===3?'door':'wall');s.walls.complete(wall);}s.wildlife.updateWolf(wolf,0);assert.equal(wolf.attackJob.target,human);
});
test('normal food is used first; only when none is available humans automatically consume a corpse',()=>{
const s=scene(),p=s.human(),body=createDeer(tile(4,3),2);s.wildlife.deer.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);p.needs.satiety=10;const food={...tile(3,3),type:'meat',quantity:10,collect:true};s.items.push(food);s.feed(p);assert.equal(p.eatJob.source.type,'meat');assert.equal(body.corpseEater,undefined);
p.eatJob=null;food.quantity=0;for(let i=0;i<50&&!body.consumed;i++)s.feed(p);assert.equal(body.consumed,true);assert.equal(p.needs.satiety,100);assert.equal(foodNutrition('deerCorpse'),100);
});
test('drafted humans ignore corpses automatically but explicit devouring is available',()=>{
const s=scene(),p=s.human(),body=createDeer(tile(3,3),2);s.wildlife.deer.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);p.mode='drafted';p.needs.satiety=10;s.feed(p);assert.equal(p.eatJob,null);assert.equal(body.consumed,undefined);assert.equal(s.eating.request(p,body),true);
for(let i=0;i<50&&!body.consumed;i++)s.feed(p);assert.equal(body.consumed,true);assert.equal(p.mode,'drafted');assert.equal(p.needs.satiety,100);
});
test('corpse reservations prevent double eating and hauling; cancellation leaves the body intact',()=>{
const s=scene(),a=s.human(),b=s.human(2,4),body=createDeer(tile(4,3),2);s.wildlife.deer.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);body.deadPosition={column:4.3,row:3.2};body.collectCorpse=true;
const butchery=new Butchery(s.construction,s.hauling,()=>s.wildlife.deer,()=>[a,b]);const box=s.walls.plan(tile(6,3),'wood','storage');s.walls.complete(box);assert.equal(s.eating.request(a,body),true);assert.equal(s.eating.canEat(b,body),false);assert.equal(butchery.findStorage(b),null);a.eatJob=null;s.eating.updateClaims();assert.equal(body.consumed,undefined);assert.equal(s.eating.request(b,body),true);
});
test('stored wolf corpses are consumed once and return inventory and equipment instead of meat',()=>{
const s=scene(),p=s.human(),body=createWolf(tile(3,3),2);s.wildlife.wolves.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);body.inventory={type:'wood',quantity:7};body.weapon='rifle';const box=s.walls.plan(tile(5,3),'wood','storage');s.walls.complete(box);s.storage.depositCorpse(box,body,'wolfCorpse');assert.equal(corpseItemType(body),'wolfCorpse');assert.equal(s.eating.request(p,body),true);
for(let i=0;i<60&&!body.consumed;i++)s.feed(p);assert.equal(body.consumed,true);assert.equal(box.stored.wolfCorpse,0);assert.equal(box.storedCorpses.length,0);const counts=countItems(s.items);assert.equal(counts.wood,7);assert.equal(counts.rifle,1);assert.equal(counts.meat,0);
});
test('wolf waves use1to2animals every2minutes independently from deer2to3per minute',()=>{
const s=scene(),wolfIds=new Set(),deerIds=new Set(),exiting=new Set();s.wildlife.update(.01);assert.equal(s.wildlife.wolves.length,2);assert.equal(s.wildlife.deer.length,3);
for(let i=0;i<1201;i++){for(const wolf of s.wildlife.wolves)wolf.needs.satiety=100;s.wildlife.update(.1);for(const wolf of s.wildlife.wolves){wolfIds.add(wolf.id);if(wolf.leaving)exiting.add(wolf.id);}for(const deer of s.wildlife.deer)deerIds.add(deer.id);}
assert.equal(wolfIds.size,4);assert.equal(deerIds.size,9);assert.equal(exiting.size,2);
});
test('wolves share starvation/death behavior and stop attacking when told to leave',()=>{
const s=scene(),wolf=createWolf(tile(2,3),1),target=s.human(3,3);s.wildlife.wolves.push(wolf);wolf.needs.satiety=20;s.wildlife.updateWolf(wolf,0);assert.equal(wolf.attackJob.target,target);s.wildlife.markForExit(wolf);assert.equal(wolf.attackJob,null);for(let i=0;i<60&&!wolf.departed;i++){s.wildlife.updateWolf(wolf,.1);s.move(wolf);}assert.equal(wolf.departed,true);
const dying=createWolf(tile(4,4),3);dying.needs.satiety=0;dying.needs.health=0;dying.hp=10;s.wildlife.updateWolf(dying,1);assert.equal(dying.dead,true);assert.equal(dying.hp,0);
});
test('wolves abandon a prey after its route is sealed and select another reachable target',()=>{
const s=scene(),wolf=createWolf(tile(1,3),1),deer=createDeer(tile(6,3),2),human=s.human(2,3);s.wildlife.wolves.push(wolf);s.wildlife.deer.push(deer);wolf.needs.satiety=20;s.wildlife.updateWolf(wolf,0);assert.equal(wolf.attackJob.target,deer);
for(let row=0;row<16;row++)s.walls.complete(s.walls.plan(tile(4,row),'wood'));
s.wildlife.updateWolf(wolf,.3);assert.equal(wolf.attackJob.target,human);assert.equal(wolf.prey,human);
});
test('wolves eat preexisting human and wolf corpses even when their collection flag is off',()=>{
for(const species of ['human','wolf']){const s=scene(),wolf=createWolf(tile(2,3),1),body=species==='human'?s.human(3,3):createWolf(tile(3,3),2);s.wildlife.wolves.push(wolf);if(species==='wolf')s.wildlife.wolves.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);body.collectCorpse=false;wolf.needs.satiety=10;
for(let i=0;i<40&&!body.consumed;i++){s.eating.updateClaims(.1);s.wildlife.updateWolf(wolf,.1);s.move(wolf);}assert.equal(body.consumed,true);assert.equal(wolf.needs.satiety,100);}
});
test('a sealed corpse eating route releases the claim and an alternative corpse can be chosen',()=>{
const s=scene(),p=s.human(1,3),a=createDeer(tile(6,3),1),b=createDeer(tile(2,4),2);s.wildlife.deer.push(a,b);for(const body of [a,b])killPawn(body,s.construction,s.harvesting,s.hauling);p.needs.satiety=10;assert.equal(s.eating.request(p,a,false),true);
for(let row=0;row<16;row++)s.walls.complete(s.walls.plan(tile(4,row),'wood'));s.eating.updateClaims(.3);assert.equal(p.eatJob,null);assert.equal(a.corpseEater,undefined);assert.equal(s.eating.automatic(p),true);assert.equal(b.corpseEater,p);
});
test('death drops equipped weapons nearby once and all attackers trigger a body motion even on misses',()=>{
for(const weapon of ['rifle','knife']){const s=scene(),p=s.human(3,3);p.weapon=weapon;killPawn(p,s.construction,s.harvesting,s.hauling);assert.equal(p.weapon,'unarmed');const item=s.items.find(i=>i.type===weapon);assert.equal(item.quantity,1);assert.ok(Math.max(Math.abs(item.column-3),Math.abs(item.row-3))===1);killPawn(p,s.construction,s.harvesting,s.hauling);assert.equal(countItems(s.items)[weapon],1);}
for(const kind of ['human','wolf']){const s=scene(),p=kind==='human'?s.human(2,3):createWolf(tile(2,3),1),target=s.human(3,3);if(kind==='human'){p.mode='drafted';assert.equal(s.combat.requestAttack(p,target),true);}else assert.equal(s.combat.requestPredation(p,target),true);s.combat.random=()=>1;s.combat.update(p,2.5);assert.equal(p.attackMotionSeconds,.25);assert.equal(target.hp,100);}
});
test('wolves cannot bite diagonally through a sealed wall corner',()=>{
const s=scene(),wolf=createWolf(tile(3,3),1),deer=createDeer(tile(4,4),2);for(const t of [tile(3,4),tile(4,3)])s.walls.complete(s.walls.plan(t,'wood'));assert.equal(s.combat.requestPredation(wolf,deer),true);assert.notDeepEqual(wolf.attackJob.goal,tile(3,3));s.combat.update(wolf,2.5);assert.equal(deer.hp,100);
});
