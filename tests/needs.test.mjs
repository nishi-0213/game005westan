import test from 'node:test';
import assert from 'node:assert/strict';
import { initialNeeds, requestEat, updateNeeds, killPawn } from '../src/needs.ts';
import { Walls } from '../src/walls.ts';
import { Storage } from '../src/storage.ts';
import { Construction } from '../src/construction.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Hauling } from '../src/hauling.ts';
import { createMovement } from '../src/movement.ts';
import { advancePathMovement } from '../src/pathfinding.ts';
import { currentAction, updateWork } from '../src/work-priorities.ts';
import { ITEM_APPEARANCE } from '../src/items.ts';
function scene(){const walls=new Walls(10),items=[],storage=new Storage(walls),construction=new Construction(walls,items,t=>walls.complete(t));construction.storage=storage;const harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,storage);const worker={movement:createMovement({column:2,row:2}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,eatJob:null,needs:initialNeeds(),priorities:{construction:3,harvesting:3,hauling:3,free:3}};const tick=seconds=>updateNeeds(worker,construction,harvesting,hauling,seconds);return{walls,items,storage,construction,harvesting,hauling,worker,tick};}
test('satiety falls0.5percent per second; strawberry mass is0.2kg',()=>{const s=scene();s.tick(10);assert.equal(s.worker.needs.satiety,95);assert.equal(ITEM_APPEARANCE.strawberry.massKg,.2);});
test('at40percent a pawn eats enough held berries in one second to become full, but not above40',()=>{const s=scene();s.worker.inventory={type:'strawberry',quantity:7};s.worker.needs.satiety=40.01;s.tick(0);assert.equal(s.worker.inventory.quantity,7);s.worker.needs.satiety=40;s.tick(0);s.tick(.9);assert.equal(s.worker.inventory.quantity,7);s.tick(.1);assert.equal(s.worker.needs.satiety,100);assert.equal(s.worker.inventory,null);});
test('hungry pawns route to food in storage, eat until full, and retain unrelated carried materials',()=>{const s=scene();const box=s.walls.plan({column:5,row:5},'wood','storage');s.walls.complete(box);s.storage.deposit(box,'strawberry',5);s.worker.inventory={type:'wood',quantity:20};s.worker.needs.satiety=20;assert.equal(s.tick(0),true);for(let i=0;i<100&&s.worker.needs.satiety<=20;i++){advancePathMovement(s.worker.movement,.1,10,s.walls.isBlocked,s.walls.cannotStop);s.tick(.1);}assert.ok(s.worker.needs.satiety>20);assert.equal(box.stored.strawberry,0);assert.deepEqual(s.worker.inventory,{type:'wood',quantity:20});});
test('marked ground food is edible; ignored or unreachable food does not get consumed',()=>{const s=scene();const item={column:3,row:2,type:'strawberry',quantity:1};s.items.push(item);s.worker.needs.satiety=20;assert.equal(s.tick(0),false);item.collect=true;assert.equal(s.tick(0),true);for(let i=0;i<20;i++){advancePathMovement(s.worker.movement,.1,10,s.walls.isBlocked,s.walls.cannotStop);s.tick(.1);}assert.equal(item.quantity,0);assert.ok(s.worker.needs.satiety>20);const t=scene();t.items.push({column:7,row:2,type:'strawberry',quantity:1,collect:true});for(let row=0;row<10;row++){const wall=t.walls.plan({column:4,row},'wood');t.walls.complete(wall);}t.worker.needs.satiety=20;assert.equal(t.tick(0),false);});
test('starvation directly drains HP at30per game day and eating stops the drain',()=>{const s=scene();s.worker.needs.satiety=1;s.tick(6);assert.equal(s.worker.needs.satiety,0);assert.equal(s.worker.hp,98.75);s.tick(5);assert.equal(s.worker.hp,97.1875);s.worker.inventory={type:'strawberry',quantity:1};s.tick(0);s.tick(1);assert.equal(s.worker.needs.satiety,10);assert.equal(s.worker.hp,96.875);s.tick(1);assert.equal(s.worker.hp,96.875);});
test('death releases jobs, freezes movement, prevents autonomous work and remains permanent',()=>{const s=scene();const plan=s.walls.plan({column:3,row:2},'wood');plan.delivered=10;s.construction.update(s.worker,0);assert.ok(s.worker.job);s.worker.needs.satiety=0;s.worker.hp=.625;s.tick(1);assert.equal(s.worker.dead,undefined);assert.equal(s.worker.hp,.3125);s.tick(1);assert.equal(s.worker.dead,true);assert.equal(s.worker.hp,0);assert.equal(currentAction(s.worker),'死亡');assert.equal(s.worker.job,null);assert.equal(s.construction.claims.size,0);assert.equal(s.worker.movement.nextTile,null);s.worker.inventory={type:'strawberry',quantity:2};s.tick(100);updateWork(s.worker,s.construction,s.harvesting,10);assert.equal(s.worker.inventory.quantity,2);assert.equal(s.worker.job,null);assert.equal(s.worker.hp,0);});
test('multiple hungry pawns cannot consume the same last berry twice',()=>{const s=scene();const item={column:2,row:2,type:'strawberry',quantity:1,collect:true};s.items.push(item);s.worker.needs.satiety=20;const other={...s.worker,movement:createMovement({column:2,row:2}),needs:{satiety:20},eatJob:null};s.tick(0);updateNeeds(other,s.construction,s.harvesting,s.hauling,0);s.tick(1);updateNeeds(other,s.construction,s.harvesting,s.hauling,1);assert.equal(item.quantity,0);assert.ok(Math.abs(s.worker.needs.satiety+other.needs.satiety-49)<.0001);});

test('manual eating consumes enough requested ignored berries in one second above the hunger threshold',()=>{
 const s=scene();const target={column:3,row:2,type:'strawberry',quantity:5,collect:false};s.items.push(target);s.worker.mode='drafted';s.worker.needs.satiety=70;
 assert.equal(requestEat(s.worker,target,s.construction,s.harvesting,s.hauling),true);
 for(let i=0;i<20&&s.worker.eatJob;i++){advancePathMovement(s.worker.movement,.1,10,s.walls.isBlocked,s.walls.cannotStop);s.tick(.1);}
 assert.equal(target.quantity,1);assert.equal(s.worker.needs.satiety,100);assert.equal(s.worker.mode,'drafted');
 assert.equal(requestEat(s.worker,target,s.construction,s.harvesting,s.hauling),true);s.tick(1);assert.equal(target.quantity,0);assert.equal(s.worker.needs.satiety,100);
 s.worker.dead=true;assert.equal(requestEat(s.worker,target,s.construction,s.harvesting,s.hauling),false);assert.equal(target.quantity,0);
});

test('drafted pawns do not automatically eat held, ground or stored food and still become hungry',()=>{
for(const location of ['held','ground','stored']){const s=scene();s.worker.mode='drafted';s.worker.needs.satiety=10;
if(location==='held')s.worker.inventory={type:'meat',quantity:10};else if(location==='ground')s.items.push({column:3,row:2,type:'meat',quantity:10,collect:true});else{const b=s.walls.plan({column:4,row:2},'wood','storage');s.walls.complete(b);s.storage.deposit(b,'meat',10);}
assert.equal(s.tick(1),false);assert.equal(s.worker.needs.satiety,9.5);assert.equal(s.worker.eatJob,null);assert.deepEqual(s.worker.movement.destination,{column:2,row:2});if(location==='held')assert.equal(s.worker.inventory.quantity,10);if(location==='ground')assert.equal(s.items[0].quantity,10);if(location==='stored')assert.equal(s.storage.totals().meat,10);}
});
test('drafting interrupts an automatic meal but explicit eating commands still work',()=>{
const s=scene(),food={column:3,row:2,type:'meat',quantity:10,collect:true};s.items.push(food);s.worker.needs.satiety=10;s.tick(0);assert.ok(s.worker.eatJob);s.worker.mode='drafted';s.tick(0);assert.equal(s.worker.eatJob,null);assert.equal(food.quantity,10);assert.equal(requestEat(s.worker,food,s.construction,s.harvesting,s.hauling),true);
for(let i=0;i<30&&s.worker.eatJob;i++){advancePathMovement(s.worker.movement,.1,10,s.walls.isBlocked,s.walls.cannotStop);s.tick(.1);}assert.equal(s.worker.needs.satiety,100);assert.equal(s.worker.mode,'drafted');assert.equal(food.quantity,5);
});

test('portable rations weigh1kg and provide30nutrition from stored food in a one-second meal',()=>{
const s=scene(),box=s.walls.plan({column:3,row:2},'wood','storage');s.walls.complete(box);s.storage.deposit(box,'ration',40);s.worker.needs.satiety=20;
for(let i=0;i<50&&s.worker.needs.satiety<=20;i++){s.tick(.1);advancePathMovement(s.worker.movement,.1,10,s.walls.isBlocked,s.walls.cannotStop);}
assert.equal(s.worker.needs.satiety,100);assert.equal(box.stored.ration,37);assert.equal(ITEM_APPEARANCE.ration.massKg,1);assert.equal(ITEM_APPEARANCE.ration.nutrition,30);
});

for(const kind of ['human','deer','wolf'])for(const progress of [.01,.5,.99])test(`${kind} death at segment progress${progress} snaps to source and clears movement`,()=>{
 const s=scene(),p=s.worker;p.kind=kind;
 const source={column:3,row:4};Object.assign(p.movement,{tile:{...source},nextTile:{column:4,row:5},progress,destination:{column:6,row:7},route:[{column:5,row:6},{column:6,row:7}]});
 killPawn(p,s.construction,s.harvesting,s.hauling);
 assert.deepEqual(p.deadPosition,source);assert.deepEqual(p.movement.tile,source);assert.deepEqual(p.movement.destination,source);assert.equal(p.movement.nextTile,null);assert.equal(p.movement.progress,0);assert.deepEqual(p.movement.route,[]);
 advancePathMovement(p.movement,10,10,s.walls.isBlocked,s.walls.cannotStop);assert.deepEqual(p.movement.tile,source);
});
