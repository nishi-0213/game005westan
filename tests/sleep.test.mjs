import test from 'node:test';
import assert from 'node:assert/strict';
import {Sleeping,GROUND_SLEEP_RECOVERY,BED_SLEEP_RECOVERY} from '../src/sleep.ts';
import {Walls,footprint,BUILD_RECIPES} from '../src/walls.ts';
import {Construction} from '../src/construction.ts';
import {Storage} from '../src/storage.ts';
import {Harvesting} from '../src/harvesting.ts';
import {Hauling} from '../src/hauling.ts';
import {initialNeeds,updateNeeds,requestEat} from '../src/needs.ts';
import {createMovement} from '../src/movement.ts';
import {advancePathMovement,findPath} from '../src/pathfinding.ts';
import {PawnOccupancy} from '../src/pawn-occupancy.ts';
import {Wildlife,createDeer,createWolf,deerAction} from '../src/wildlife.ts';
function scene(){
 const walls=new Walls(12),items=[],construction=new Construction(walls,items,t=>walls.complete(t)),storage=new Storage(walls);
 construction.storage=storage;const sleeping=new Sleeping(construction),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,storage);
 const worker={movement:createMovement({column:2,row:2}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,eatJob:null,needs:initialNeeds(),hp:100};
 sleeping.onInterrupt=p=>{construction.cancel(p);harvesting.cancel(p);hauling.cancel(p);};
 const tick=(dt=.05,p=worker)=>{const resting=sleeping.update(p,dt,true);updateNeeds(p,construction,harvesting,hauling,dt,!resting,undefined,undefined,!resting);if(p.dead)sleeping.cancel(p);else if(p.sleep?.phase!=='sleeping')advancePathMovement(p.movement,dt,12,walls.isBlocked,walls.cannotStop);return resting;};
 const bed=(column=4,row=2,orientation=0)=>{const b=walls.plan({column,row},'wood','bed',orientation);walls.complete(b);return b;};
 return {walls,items,construction,sleeping,worker,tick,bed,harvesting,hauling};
}
test('beds occupy1x2 or2x1, cost5wood/3seconds and forbid normal stopping and passage',()=>{
 const s=scene(),b=s.bed();assert.deepEqual(BUILD_RECIPES.bed,{materialCount:5,seconds:3});assert.deepEqual(footprint(b),[{column:4,row:2},{column:4,row:3}]);assert.ok(footprint(b).every(s.walls.isBlocked));
 assert.equal(findPath(s.worker.movement.tile,b,12,s.walls.isBlocked,s.walls.cannotStop),null);
 const rotated=s.bed(7,7,1);assert.deepEqual(footprint(rotated),[{column:7,row:7},{column:8,row:7}]);
});
test('wakefulness falls at1percent per second and a drafted pawn does not seek a bed below20',()=>{
 const s=scene();s.bed();s.worker.mode='drafted';s.tick(81);assert.equal(s.worker.needs.wakefulness,19);assert.equal(s.worker.sleep,undefined);assert.deepEqual(s.worker.movement.tile,{column:2,row:2});
});
test('at0 a drafted pawn falls asleep in place, recovers100 in8game hours and wakes at100',()=>{
 const s=scene();s.worker.mode='drafted';s.worker.needs.wakefulness=.1;s.tick(.1);assert.equal(s.worker.sleep.phase,'sleeping');assert.equal(s.worker.needs.wakefulness,0);assert.equal(GROUND_SLEEP_RECOVERY,6.25);
 s.tick(15.9);assert.equal(s.worker.sleep.phase,'sleeping');assert.ok(s.worker.needs.wakefulness<100);s.tick(.1);assert.equal(s.worker.needs.wakefulness,100);assert.equal(s.worker.sleep,undefined);
});
test('automatic pawns use the nearest reachable bed below20, rest on it and exit after recovery',()=>{
 const s=scene(),far=s.bed(8,8),near=s.bed();s.worker.needs.wakefulness=20;s.tick(0);assert.equal(s.worker.sleep,undefined);s.tick(.01);assert.equal(s.worker.sleep.bed,near);assert.notEqual(s.worker.sleep.bed,far);
 for(let i=0;i<100&&s.worker.sleep.phase!=='sleeping';i++)s.tick();assert.equal(s.worker.sleep.phase,'sleeping');assert.ok(footprint(near).some(t=>t.column===s.worker.movement.tile.column&&t.row===s.worker.movement.tile.row));assert.equal(s.sleeping.claims.get(near),s.worker);assert.equal(BED_SLEEP_RECOVERY,100/12);
 const before=s.worker.needs.wakefulness;s.tick(1);assert.ok(Math.abs(s.worker.needs.wakefulness-before-100/12)<1e-8);
 for(let i=0;i<300&&s.worker.sleep;i++)s.tick();assert.equal(s.worker.sleep,undefined);assert.equal(s.sleeping.claims.size,0);assert.equal(s.walls.isBlocked(s.worker.movement.tile),false);
});
test('one bed has one sleeper; drafting during approach releases its reservation',()=>{
 const s=scene(),b=s.bed();s.worker.needs.wakefulness=10;s.tick(0);const other={...s.worker,movement:createMovement({column:1,row:1}),sleep:undefined,needs:{...initialNeeds(),wakefulness:10}};
 assert.equal(s.sleeping.update(other,0,true),false);assert.equal(other.sleep,undefined);s.worker.mode='drafted';s.tick(0);assert.equal(s.worker.sleep,undefined);assert.equal(s.sleeping.claims.size,0);assert.equal(s.sleeping.update(other,.3,true),true);assert.equal(other.sleep.bed,b);
});
test('unreachable beds are skipped; occupancy also prevents using an occupied bed',()=>{
 const s=scene(),b=s.bed(8,2);for(let row=0;row<12;row++){const w=s.walls.plan({column:6,row},'wood');s.walls.complete(w);}s.worker.needs.wakefulness=10;assert.equal(s.sleeping.update(s.worker,0,true),false);
 const t=scene(),bed=t.bed(),occupancy=new PawnOccupancy();occupancy.track(t.worker.movement);occupancy.track(createMovement({...bed}));t.worker.needs.wakefulness=10;assert.equal(t.sleeping.update(t.worker,0,true),false);
});
test('destroying a bed converts sleep to ground recovery; death releases the reservation',()=>{
 const s=scene(),b=s.bed();s.worker.needs.wakefulness=10;for(let i=0;i<100&&s.worker.sleep?.phase!=='sleeping';i++)s.tick();assert.equal(s.sleeping.claims.size,1);
 s.walls.erase(b);const before=s.worker.needs.wakefulness;s.tick(1);assert.equal(s.worker.sleep.bed,undefined);assert.equal(s.sleeping.claims.size,0);assert.ok(Math.abs(s.worker.needs.wakefulness-before-GROUND_SLEEP_RECOVERY)<1e-9);
 const t=scene();t.bed();t.worker.needs.wakefulness=10;t.tick(0);t.worker.dead=true;t.tick(0);assert.equal(t.sleeping.claims.size,0);assert.equal(t.worker.sleep,undefined);
});
test('sleep preserves hunger and starvation damage, rejects manual meals, and interrupts work',()=>{
 const s=scene(),plan=s.walls.plan({column:3,row:2},'wood');plan.delivered=10;s.construction.update(s.worker,0);assert.ok(s.worker.job);s.worker.needs.wakefulness=0;s.worker.needs.satiety=0;s.worker.needs.health=0;s.tick(0);assert.equal(s.worker.job,null);assert.equal(s.construction.claims.size,0);
 const food={column:2,row:2,type:'strawberry',quantity:5,collect:true};s.items.push(food);assert.equal(requestEat(s.worker,food,s.construction,s.harvesting,s.hauling),false);s.tick(1);assert.equal(s.worker.hp,90);assert.equal(food.quantity,5);
});
test('bed construction consumes exactly5wood and preserves its3second progress across interruption',()=>{
 const s=scene(),plan=s.walls.plan({column:3,row:2},'wood','bed');s.worker.inventory={type:'wood',quantity:5};
 for(let i=0;i<10&&plan.delivered<5;i++)s.construction.update(s.worker,0);
 assert.equal(plan.delivered,5);assert.equal(s.worker.inventory,null);s.construction.update(s.worker,1);assert.equal(plan.workSeconds,1);
 s.construction.cancel(s.worker);assert.equal(plan.state,'planned');s.construction.update(s.worker,0);s.construction.update(s.worker,1.9);assert.equal(plan.state,'planned');s.construction.update(s.worker,.1);assert.equal(plan.state,'completed');
});

// Exercise each animal's real AI update with the same Sleeping instance used by humans.
for(const create of [createDeer,createWolf]){
 test(`${create.name}: animal AI shares human sleep, stops eating/roaming, and wakes after8game hours`,()=>{
  const s=scene(),animal=create({column:2,row:2},1),wildlife=new Wildlife(s.construction,s.harvesting,s.hauling,()=>.5);
  wildlife.sleeping=s.sleeping;const update=dt=>animal.kind==='deer'?wildlife.updateDeer(animal,dt):wildlife.updateWolf(animal,dt);
  s.bed();assert.equal(animal.needs.wakefulness,100);update(1);assert.equal(animal.needs.wakefulness,99);
  animal.needs.wakefulness=0;animal.needs.satiety=10;s.items.push({column:2,row:2,type:'ration',quantity:10,collect:true});
  update(0);assert.equal(animal.sleep.phase,'sleeping');assert.equal(animal.sleep.bed,undefined);assert.equal(deerAction(animal),'就寝中');const position={...animal.movement.tile};
  update(8);assert.equal(animal.needs.wakefulness,50);assert.equal(animal.needs.satiety,2);assert.equal(animal.eatJob,null);assert.equal(s.items[0].quantity,10);assert.deepEqual(animal.movement.destination,position);
  update(7.9);assert.equal(animal.sleep.phase,'sleeping');update(.1);assert.equal(animal.needs.wakefulness,100);assert.equal(animal.sleep,undefined);assert.notEqual(deerAction(animal),'就寝中');
 });
 test(`${create.name}: starvation continues during sleep and death stops recovery`,()=>{
  const s=scene(),animal=create({column:2,row:2},1),wildlife=new Wildlife(s.construction,s.harvesting,s.hauling,()=>.5);wildlife.sleeping=s.sleeping;
  const update=dt=>animal.kind==='deer'?wildlife.updateDeer(animal,dt):wildlife.updateWolf(animal,dt);
  animal.needs.wakefulness=0;animal.needs.satiety=0;animal.needs.health=0;animal.hp=10;update(0);update(1);
  assert.equal(animal.dead,true);assert.equal(animal.sleep,undefined);const last=animal.needs.wakefulness;update(10);assert.equal(animal.needs.wakefulness,last);assert.equal(deerAction(animal),'死亡');
 });
}
test('a bed destroyed while approaching triggers immediate reselection of another reachable bed',()=>{
 const s=scene(),first=s.bed(),alternate=s.bed(7,2);s.worker.needs.wakefulness=10;s.tick(0);assert.equal(s.worker.sleep.bed,first);s.tick(.1);s.walls.erase(first);s.tick(0);assert.equal(s.worker.sleep.bed,alternate);assert.equal(s.sleeping.claims.has(first),false);assert.equal(s.sleeping.claims.get(alternate),s.worker);
});
