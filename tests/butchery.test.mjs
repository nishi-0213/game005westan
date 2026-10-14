import test from 'node:test';
import assert from 'node:assert/strict';
import { Butchery, adjustButcherCount, corpseItemType } from '../src/butchery.ts';
import { Walls, footprint, BUILD_RECIPES } from '../src/walls.ts';
import { Construction } from '../src/construction.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Hauling } from '../src/hauling.ts';
import { Storage } from '../src/storage.ts';
import { createMovement } from '../src/movement.ts';
import { advancePathMovement } from '../src/pathfinding.ts';
import { PawnOccupancy } from '../src/pawn-occupancy.ts';
import { updateWork } from '../src/work-priorities.ts';
import { createDeer } from '../src/wildlife.ts';
import { initialNeeds, requestEat, updateNeeds } from '../src/needs.ts';
import { ITEM_APPEARANCE, carryCapacity } from '../src/items.ts';
const tile=(column,row)=>({column,row});
function scene(){
 const walls=new Walls(16),items=[],storage=new Storage(walls),construction=new Construction(walls,items,t=>walls.complete(t));construction.storage=storage;
 const hauling=new Hauling(items,storage),harvesting=new Harvesting([],items,walls),bodies=[],workers=[],occupancy=new PawnOccupancy();
 const engine=new Butchery(construction,hauling,()=>bodies,()=>workers);engine.onPickup=c=>occupancy.untrack(c.movement);engine.onDrop=c=>occupancy.track(c.movement);construction.onCancel=w=>engine.cancel(w);
 const worker=(column=2,row=2)=>{const w={movement:createMovement(tile(column,row)),mode:'automatic',weapon:'unarmed',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,priorities:{construction:3,harvesting:3,hauling:2,butchery:1,free:4},needs:initialNeeds(),eatJob:null,hp:100};workers.push(w);occupancy.track(w.movement);return w};
 const corpse=(column=4,row=4,kind='deer',collect=true)=>{const c=createDeer(tile(column,row),bodies.length+1);c.kind=kind;c.dead=true;c.hp=0;c.deadPosition=tile(column,row);c.collectCorpse=collect;bodies.push(c);occupancy.track(c.movement);return c};
 const station=(column=8,row=8,orientation=0)=>{const b=walls.plan(tile(column,row),'wood','butcher',orientation);walls.complete(b);return b};
 const tick=(seconds=.1)=>{for(const w of workers){updateWork(w,construction,harvesting,seconds,()=>.5,seconds,hauling,undefined,engine);advancePathMovement(w.movement,seconds,16,walls.isBlocked,walls.cannotStop)}};
 return{walls,items,storage,construction,hauling,harvesting,bodies,workers,occupancy,engine,worker,corpse,station,tick};
}
test('rotated1by3footprints are reserved atomically and block all3cells when completed',()=>{
 const walls=new Walls(8),a=walls.plan(tile(3,3),'wood','butcher');assert.deepEqual(footprint(a),[tile(3,2),tile(3,3),tile(3,4)]);
 assert.equal(walls.plan(tile(3,4),'wood'),null);assert.equal(walls.plan(tile(0,0),'wood','butcher'),null);walls.complete(a);assert.ok(footprint(a).every(t=>walls.isBlocked(t)));
 const b=walls.plan(tile(5,6),'wood','butcher',1);assert.deepEqual(footprint(b),[tile(4,6),tile(5,6),tile(6,6)]);assert.equal(walls.removePlan(tile(6,6)),b);assert.equal(walls.at(tile(4,6)),undefined);
 assert.deepEqual(BUILD_RECIPES.butcher,{materialCount:30,seconds:3});
});
test('human and deer corpses produce10meat only after5seconds at a station and one reservation is consumed',()=>{
 for(const kind of ['human','deer']){
  const s=scene(),w=s.worker(),c=s.corpse(4,4,kind),b=s.station();b.butcher.remaining=1;
  for(let i=0;i<150&&!b.butcher.corpse;i++)s.tick();assert.equal(b.butcher.corpse,c);assert.deepEqual(c.corpseStation,b);assert.equal(c.corpseCarrier,undefined);
  for(let i=0;i<100&&w.butcherJob?.phase!=='process';i++)s.tick();const start=b.butcher.seconds;
  for(let i=0;i<100&&!c.consumed;i++){s.tick();if(b.butcher.seconds<5&&!c.consumed)assert.equal(s.items.filter(i=>i.type==='meat').length,0)}
  assert.equal(c.consumed,true);assert.equal(b.butcher.remaining,0);assert.equal(s.items.find(i=>i.type==='meat').quantity,10);assert.equal(s.items.find(i=>i.type==='meat').collect,true);
  assert.ok(start>=0);assert.equal(s.engine.claims.size,0);
 }
});
test('ignored bodies stay put; marked bodies can be stored and later withdrawn for a butcher bill',()=>{
 const s=scene(),w=s.worker(),c=s.corpse(4,4,'deer',false),b=s.station(),box=s.walls.plan(tile(6,3),'wood','storage');s.walls.complete(box);
 for(let i=0;i<50;i++)s.tick();assert.equal(c.corpseStorage,undefined);assert.deepEqual(c.movement.tile,tile(4,4));
 c.collectCorpse=true;for(let i=0;i<150&&!c.corpseStorage;i++)s.tick();assert.equal(c.corpseStorage,box);assert.equal(s.storage.totals().deerCorpse,1);assert.equal(s.occupancy.occupied(tile(4,4)),false);
 b.butcher.remaining=1;for(let i=0;i<200&&!c.consumed;i++)s.tick();assert.equal(c.consumed,true);assert.equal(box.stored.deerCorpse,0);assert.equal(box.storedCorpses.length,0);
});
test('until mode stops at the target in10item batches and unlimited mode continues while bodies remain',()=>{
 const s=scene();s.worker();const b=s.station();const bodies=[s.corpse(4,3),s.corpse(4,5),s.corpse(6,5)];b.butcher.mode='until';b.butcher.target=15;
 for(let i=0;i<450;i++)s.tick();assert.equal(s.engine.meatStock(),20);assert.equal(bodies.filter(c=>c.consumed).length,2);
 b.butcher.mode='forever';for(let i=0;i<200&&!bodies.every(c=>c.consumed);i++)s.tick();assert.ok(bodies.every(c=>c.consumed));assert.equal(s.engine.meatStock(),30);
});
test('bill counts clamp0to99 and processing progress survives an interruption',()=>{
 const s=scene(),w=s.worker(),c=s.corpse(),b=s.station();adjustButcherCount(b.butcher,-1);assert.equal(b.butcher.remaining,0);adjustButcherCount(b.butcher,999);assert.equal(b.butcher.remaining,99);b.butcher.remaining=1;
 for(let i=0;i<200&&b.butcher.seconds<1;i++)s.tick();const saved=b.butcher.seconds;assert.ok(saved>=1);s.construction.cancel(w);w.mode='drafted';for(let i=0;i<20;i++)s.tick();assert.equal(b.butcher.seconds,saved);
 w.mode='automatic';for(let i=0;i<150&&!c.consumed;i++)s.tick();assert.equal(c.consumed,true);
});
test('two workers never acquire the same body or process the same station at once',()=>{
 const s=scene();s.worker();s.worker(2,3);const c=s.corpse(),b=s.station();b.butcher.remaining=1;
 for(let i=0;i<180&&!c.consumed;i++){s.tick();assert.ok(s.workers.filter(w=>w.carryingCorpse===c).length<=1);assert.ok(s.workers.filter(w=>w.butcherJob?.station===b).length<=1)}
 assert.equal(s.items.find(i=>i.type==='meat').quantity,10);
});
test('interrupted transport releases claims and puts the corpse on a separate reachable cell',()=>{
 const s=scene(),w=s.worker(),c=s.corpse(),b=s.station();b.butcher.remaining=1;
 for(let i=0;i<100&&!w.carryingCorpse;i++)s.tick();assert.equal(w.carryingCorpse,c);s.construction.cancel(w);
 assert.equal(w.carryingCorpse,null);assert.equal(c.corpseCarrier,undefined);assert.notDeepEqual(c.movement.tile,w.movement.tile);assert.equal(s.engine.corpseClaims.size,0);
});
test('corpse storage follows type filters and area one-type capacity; corpse weights exceed20kg but are moved one at a time',()=>{
 const s=scene();s.worker();const a=s.corpse(4,4,'human'),b=s.corpse(4,5,'deer');const area=s.walls.plan(tile(7,3),'wood','storageArea');s.walls.complete(area);area.accepted.deerCorpse=false;
 for(let i=0;i<150;i++)s.tick();assert.equal(area.stored.humanCorpse,1);assert.equal(a.corpseStorage,area);assert.equal(b.corpseStorage,undefined);assert.equal(s.storage.accepts(area,'deerCorpse'),false);
 assert.equal(ITEM_APPEARANCE.humanCorpse.massKg,50);assert.equal(ITEM_APPEARANCE.deerCorpse.massKg,120);assert.equal(corpseItemType(a),'humanCorpse');
});
test('meat weighs1kg and restores40percent per item, including manual eating and held/ground/storage automatic food',()=>{
 assert.equal(ITEM_APPEARANCE.meat.massKg,1);
 for(const location of ['held','ground','stored']){
  const s=scene(),w=s.worker();w.needs.satiety=20;
  if(location==='held')w.inventory={type:'meat',quantity:3};
  else if(location==='ground')s.items.push({...w.movement.tile,type:'meat',quantity:3,collect:true});
  else{const box=s.walls.plan(tile(3,2),'wood','storage');s.walls.complete(box);s.storage.deposit(box,'meat',3)}
  for(let i=0;i<60&&w.needs.satiety<=20;i++){updateNeeds(w,s.construction,s.harvesting,s.hauling,.1);advancePathMovement(w.movement,.1,16,s.walls.isBlocked,s.walls.cannotStop)}
  assert.ok(w.needs.satiety>90);
 }
 const s=scene(),w=s.worker(),food={...w.movement.tile,type:'meat',quantity:3,collect:false};s.items.push(food);w.needs.satiety=30;assert.ok(requestEat(w,food,s.construction,s.harvesting,s.hauling));updateNeeds(w,s.construction,s.harvesting,s.hauling,1);assert.equal(food.quantity,1);assert.equal(w.needs.satiety,100);
});

test('heavy items have a minimum transport batch of1 even with an equipped weapon',()=>{
 for(const weapon of ['unarmed','rifle'])for(const type of ['humanCorpse','deerCorpse'])assert.equal(carryCapacity({weapon},type),1);
 assert.equal(carryCapacity({weapon:'rifle'},'wood'),15);
});

test('immediate corpse hauling accepts ignored bodies and stored bodies are usable for later processing',()=>{
 const s=scene(),w=s.worker(),c=s.corpse(4,4,'human',false),b=s.station(),box=s.walls.plan(tile(6,3),'wood','storage');s.walls.complete(box);
 assert.ok(s.engine.request(w,c));
 for(let i=0;i<150&&!c.corpseStorage;i++){s.engine.update(w,.1,'transport');advancePathMovement(w.movement,.1,16,s.walls.isBlocked,s.walls.cannotStop)}
 assert.equal(c.corpseStorage,box);assert.equal(c.collectCorpse,false);assert.equal(w.forcedCorpse,null);
 b.butcher.remaining=1;for(let i=0;i<220&&!c.consumed;i++)s.tick();assert.equal(c.consumed,true);assert.equal(box.stored.humanCorpse,0);
});
