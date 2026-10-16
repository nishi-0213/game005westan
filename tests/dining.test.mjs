import test from 'node:test';
import assert from 'node:assert/strict';
import {Walls,footprint,BUILD_RECIPES} from '../src/walls.ts';
import {Construction} from '../src/construction.ts';
import {Harvesting} from '../src/harvesting.ts';
import {Hauling} from '../src/hauling.ts';
import {Storage} from '../src/storage.ts';
import {createMovement} from '../src/movement.ts';
import {advancePathMovement,findPath} from '../src/pathfinding.ts';
import {initialNeeds,updateNeeds,requestEat} from '../src/needs.ts';
import {findDiningSeat} from '../src/dining.ts';
import {PawnOccupancy} from '../src/pawn-occupancy.ts';
function scene(){
 const walls=new Walls(32),items=[],storage=new Storage(walls),construction=new Construction(walls,items,t=>walls.complete(t));construction.storage=storage;
 const harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,storage);
 const worker={movement:createMovement({column:2,row:2}),mode:'automatic',inventory:{type:'strawberry',quantity:10},job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,eatJob:null,needs:{...initialNeeds(),satiety:20},hp:100};
 const tick=(dt=0,p=worker,diet)=>{const result=updateNeeds(p,construction,harvesting,hauling,dt,true,undefined,diet);advancePathMovement(p.movement,dt,32,walls.isBlocked,walls.cannotStop);return result;};
 const build=(kind,column,row,material='wood',orientation=0)=>{const w=walls.plan({column,row},material,kind,orientation);walls.complete(w);return w;};
 const finish=()=>{for(let i=0;i<500&&worker.eatJob;i++)tick(.05);assert.equal(worker.eatJob,null);};
 return {walls,items,storage,construction,harvesting,hauling,worker,tick,build,finish};
}
test('table2x1 rotates1x2 and blocks movement; chair1x1 allows standing; both support stone/wood recipes',()=>{
 const s=scene(),t=s.build('table',5,4,'stone'),c=s.build('chair',5,5,'stone');
 assert.deepEqual(footprint(t),[{column:5,row:4},{column:6,row:4}]);assert.deepEqual(footprint(s.build('table',9,9,'wood',1)),[{column:9,row:9},{column:9,row:10}]);
 assert.deepEqual(BUILD_RECIPES.table,{materialCount:10,seconds:3});assert.deepEqual(BUILD_RECIPES.chair,{materialCount:3,seconds:1});
 assert.equal(t.material,'stone');assert.equal(c.material,'stone');assert.equal(s.walls.isBlocked(t),true);assert.equal(s.walls.isBlocked(c),false);assert.ok(findPath(s.worker.movement.tile,c,32,s.walls.isBlocked,s.walls.cannotStop));
});
test('eating walks to the nearest completed chair beside any part of a table and only then eats for1second',()=>{
 const s=scene();s.build('table',5,4);const near=s.build('chair',5,5);s.build('chair',6,5);s.tick();s.tick();assert.equal(s.worker.eatJob.seat.chair,near);assert.equal(s.worker.inventory.quantity,10);assert.deepEqual(s.worker.movement.destination,{column:5,row:5});
 for(let i=0;i<200&&(s.worker.movement.nextTile||s.worker.movement.tile.column!==5||s.worker.movement.tile.row!==5);i++){s.tick(.05);if(i>200)throw Error('not seated');}
 assert.equal(s.worker.inventory.quantity,10);s.worker.needs.satiety=10;s.tick(.9);assert.ok(s.worker.eatJob);s.tick(.1);assert.equal(s.worker.eatJob,null);assert.equal(s.worker.needs.satiety,100);
});
test('the20tile bound uses actual path distance, includes exactly20 and excludes detours beyond20',()=>{
 const s=scene();s.build('table',22,1);s.build('chair',22,2);assert.equal(findDiningSeat(s.walls,s.worker.movement).path.distance,20);
 s.worker.movement.tile={column:1,row:2};assert.equal(findDiningSeat(s.walls,s.worker.movement),null);
 const t=scene();t.build('table',4,1);t.build('chair',4,2);for(let row=0;row<30;row++)t.build('wall',3,row);assert.equal(findDiningSeat(t.walls,t.worker.movement),null);
});
test('absent, diagonal-only, unfinished, or unreachable seating falls back to eating in place',()=>{
 for(const condition of ['absent','diagonal','unfinished','unreachable']){
  const s=scene();if(condition!=='absent'){s.build('table',5,4);const c=s.build('chair',condition==='diagonal'?4:5,condition==='diagonal'?3:5);if(condition==='unfinished'){s.walls.erase(c);s.walls.plan(c,'wood','chair');}if(condition==='unreachable')for(let r=0;r<32;r++)s.build('wall',4,r);}
  s.tick();s.tick();assert.equal(s.worker.eatJob.seat,undefined);assert.deepEqual(s.worker.movement.destination,{column:2,row:2});s.finish();assert.equal(s.worker.needs.satiety,100);
 }
});
test('occupied and reserved chairs are skipped so two diners use distinct seats',()=>{
 const s=scene();s.build('table',5,4);s.build('chair',5,5);s.build('chair',6,5);const other={...s.worker,movement:createMovement({column:1,row:2}),inventory:{type:'strawberry',quantity:10},needs:{...initialNeeds(),satiety:20}};
 const occupancy=new PawnOccupancy();occupancy.track(s.worker.movement);occupancy.track(other.movement);s.tick();s.tick();s.tick(0,other);s.tick(0,other);assert.notDeepEqual(s.worker.eatJob.goal,other.eatJob.goal);
});
test('food is physically picked up from storage, work supplies are preserved on the ground and interrupted meals keep food',()=>{
 const s=scene();s.build('table',5,4);s.build('chair',5,5);const box=s.build('storage',3,2);s.storage.deposit(box,'ration',40);s.worker.inventory={type:'wood',quantity:15};s.worker.weapon='rifle';s.tick();s.tick();
 assert.ok(s.worker.eatJob.seat);assert.equal(box.stored.ration,36);assert.deepEqual(s.worker.inventory,{type:'ration',quantity:4});assert.equal(s.items.find(i=>i.type==='wood').quantity,15);assert.equal(s.worker.needs.satiety,20);
 s.worker.mode='drafted';s.tick();assert.equal(s.worker.eatJob,null);assert.deepEqual(s.worker.inventory,{type:'ration',quantity:4});assert.equal(box.stored.ration,36);
});
test('destroying a table during travel falls back to eating safely without losing the carried meal',()=>{
 const s=scene();const table=s.build('table',5,4);s.build('chair',5,5);s.tick();s.tick();s.tick(.1);s.walls.erase(table);s.finish();assert.equal(s.worker.needs.satiety,100);assert.ok(s.worker.movement.tile.column<5);
});
test('manual meals use seats too; animals keep eating in place',()=>{
 const s=scene();s.build('table',5,4);s.build('chair',5,5);s.worker.inventory=null;const food={type:'ration',quantity:10,column:2,row:2,collect:false};s.items.push(food);s.worker.mode='drafted';s.worker.needs.satiety=80;assert.equal(requestEat(s.worker,food,s.construction,s.harvesting,s.hauling),true);s.tick();assert.ok(s.worker.eatJob.seat);assert.equal(food.quantity,6);s.finish();assert.equal(s.worker.needs.satiety,100);
 const t=scene();t.build('table',5,4);t.build('chair',5,5);t.tick(0,t.worker,['strawberry','ration']);t.tick(0,t.worker,['strawberry','ration']);assert.equal(t.worker.eatJob.seat,undefined);assert.deepEqual(t.worker.movement.destination,{column:2,row:2});
});
for(const destroyed of ['chair','table'])test(`destroyed ${destroyed} during travel immediately reselects another reachable dining set`,()=>{
 const s=scene(),table=s.build('table',5,4),chair=s.build('chair',5,5);s.build('table',9,4);const alternate=s.build('chair',9,5);
 s.tick();s.tick();assert.equal(s.worker.eatJob.seat.chair,chair);s.tick(.1);s.walls.erase(destroyed==='chair'?chair:table);s.tick();assert.equal(s.worker.eatJob.seat.chair,alternate);assert.deepEqual(s.worker.movement.destination,{column:9,row:5});s.finish();assert.equal(s.worker.needs.satiety,100);assert.deepEqual(s.worker.movement.tile,{column:9,row:5});
});

for(const type of ['meat','humanCorpse','deerCorpse','wolfCorpse','ration','strawberry'])for(const seated of [false,true])test(`${type} meal only remembers raw food after completion, seated=${seated}`,()=>{
 const s=scene();s.worker.kind='human';s.worker.inventory=null;
 if(seated){s.build('table',5,4);s.build('chair',5,5);}
 const food={type,quantity:10,column:2,row:2,collect:false};s.items.push(food);
 assert.equal(requestEat(s.worker,food,s.construction,s.harvesting,s.hauling),true);
 s.tick();assert.equal(s.worker.moodMemories,undefined);s.finish();
 const memories=s.worker.moodMemories??[];
 assert.equal(memories.some(m=>m.kind==='rawFood'),!['ration','strawberry'].includes(type));
 assert.equal(memories.some(m=>m.kind==='standingMeal'),!seated||type.endsWith('Corpse'));
});

test('stomachache rolls on completed meals, not on starting or interrupting them',()=>{
 const original=Math.random;Math.random=()=>0;
 try{
  const s=scene();s.worker.kind='human';s.worker.bodyHp={head:100,torso:100,arms:100,legs:100};
  s.tick();s.tick(.5);assert.equal(s.worker.conditions,undefined);s.finish();assert.equal(s.worker.conditions.length,1);assert.equal(s.worker.conditions[0].kind,'stomachache');assert.equal(s.worker.conditions[0].part,'torso');
  const t=scene();t.worker.kind='human';t.worker.bodyHp={head:100,torso:100,arms:100,legs:100};t.tick();t.tick(.5);t.worker.mode='drafted';t.tick();assert.equal(t.worker.eatJob,null);assert.equal(t.worker.conditions,undefined);
 }finally{Math.random=original;}
});
