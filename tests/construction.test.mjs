import assert from 'node:assert/strict';
import test from 'node:test';
import { Construction } from '../src/construction.ts';
import { Walls } from '../src/walls.ts';
import { createMovement, advanceMovement } from '../src/movement.ts';
import { findPath } from '../src/pathfinding.ts';

const pawn = (column=2,row=2) => ({movement:createMovement({column,row}),mode:'automatic',inventory:null,job:null,retrySeconds:0});
function scene(items=[],size=8) {
 const walls=new Walls(size);const engine=new Construction(walls,items,tile=>walls.complete(tile));
 const tick=(builders,seconds=.05)=>{for(const builder of builders){engine.update(builder,seconds);advanceMovement(builder.movement,seconds,walls.isBlocked,walls.cannotStop);}};
 return {walls,engine,tick};
}

test('a wall gathers the right stack, deposits units singly, then builds for a full second',()=>{
 const items=[{type:'wood',quantity:100,column:3,row:2},{type:'stone',quantity:200,column:4,row:2}];
 const {walls,tick}=scene(items);const target=walls.plan({column:5,row:2},'wood');const builder=pawn();
 let sawPickup=false,sawBuilding=false;
 for(let i=0;i<200&&target.state==='planned';i++){
  const before=target.delivered;tick([builder]);assert.ok(target.delivered-before<=1);
  if(builder.inventory){sawPickup=true;assert.equal(builder.inventory.type,'wood');assert.ok(builder.inventory.quantity<=20);}
  if(target.workSeconds>0){sawBuilding=true;assert.equal(target.delivered,2);}
  if(target.workSeconds<1)assert.equal(target.state,'planned');
 }
 assert.equal(target.state,'completed');assert.equal(target.workSeconds,1);assert.equal(target.delivered,2);
 assert.equal(builder.inventory.quantity,18);assert.equal(items[0].quantity,80);assert.equal(items[1].quantity,200);
 assert.ok(sawPickup&&sawBuilding);
});

test('a barricade consumes five materials and one second',()=>{
 const {walls,tick}=scene([{type:'stone',quantity:20,column:3,row:2}]);const builder=pawn();
 const target=walls.plan({column:5,row:2},'stone','barricade');
 for(let i=0;i<150&&target.state==='planned';i++)tick([builder]);
 assert.equal(target.state,'completed');assert.equal(target.delivered,5);assert.equal(target.workSeconds,1);
 assert.equal(builder.inventory,null);assert.equal(walls.isBlocked(target),false);assert.equal(walls.cannotStop(target),true);
});

test('an insufficient stack is delivered partially and construction waits for the remainder',()=>{
 const items=[{type:'wood',quantity:1,column:3,row:2}];const {walls,tick}=scene(items);const builder=pawn();const target=walls.plan({column:5,row:2},'wood');
 for(let i=0;i<100;i++)tick([builder]);
 assert.equal(target.delivered,1);assert.equal(target.workSeconds,0);assert.equal(target.state,'planned');
 items.push({type:'wood',quantity:1,column:4,row:2});
 for(let i=0;i<150&&target.state==='planned';i++)tick([builder]);
 assert.equal(target.state,'completed');assert.equal(target.delivered,2);
});

test('nearest material is selected by shortest traversable route rather than straight-line distance',()=>{
 const items=[{type:'wood',quantity:10,column:4,row:2},{type:'wood',quantity:10,column:2,row:5}];
 const {walls,engine}=scene(items);const builder=pawn();
 for(let r=0;r<6;r++){const tile={column:3,row:r};walls.plan(tile,'stone');walls.complete(tile);}
 walls.plan({column:1,row:3},'wood');engine.update(builder,.05);
 assert.equal(builder.job.source,items[1]);
});

test('a nearer unreachable plan is ignored in favor of a reachable plan',()=>{
 const {walls,engine}=scene([{type:'wood',quantity:20,column:2,row:3}]);const builder=pawn();
 for(let r=0;r<8;r++){const tile={column:3,row:r};walls.plan(tile,'stone');walls.complete(tile);}
 walls.plan({column:4,row:2},'wood');const reachable=walls.plan({column:0,row:6},'wood');engine.update(builder,.05);
 assert.equal(builder.job.target,reachable);
});

test('multiple builders reserve distinct targets and do not duplicate material consumption',()=>{
 const {walls,engine,tick}=scene([{type:'wood',quantity:10,column:1,row:2},{type:'wood',quantity:10,column:5,row:2}]);
 const first=walls.plan({column:1,row:4},'wood');const second=walls.plan({column:5,row:4},'wood');const builders=[pawn(1,1),pawn(5,1)];
 for(const b of builders)engine.update(b,.05);
 assert.notEqual(builders[0].job.target,builders[1].job.target);
 for(let i=0;i<180;i++)tick(builders);
 assert.equal(first.state,'completed');assert.equal(second.state,'completed');assert.equal(first.delivered+second.delivered,4);
});

test('drafted pawns do no work and switching to drafted releases the reservation',()=>{
 const {walls,engine,tick}=scene([{type:'wood',quantity:10,column:3,row:2}]);const builder=pawn();builder.mode='drafted';walls.plan({column:5,row:2},'wood');
 tick([builder]);assert.equal(builder.job,null);
 builder.mode='automatic';tick([builder]);assert.equal(engine.claims.size,1);
 builder.mode='drafted';tick([builder]);assert.equal(engine.claims.size,0);assert.equal(builder.job,null);
});

test('shortest routes go around walls, cross barricades, and reject no-stop destinations',()=>{
 const walls=new Walls(8);walls.plan({column:3,row:2},'wood');walls.complete({column:3,row:2});
 const path=findPath({column:2,row:2},{column:5,row:2},8,walls.isBlocked,walls.cannotStop);
 assert.ok(path);assert.ok(!path.tiles.some(t=>t.column===3&&t.row===2));
 walls.plan({column:4,row:2},'stone','barricade');walls.complete({column:4,row:2});
 assert.equal(findPath({column:2,row:2},{column:4,row:2},8,walls.isBlocked,walls.cannotStop),null);
 assert.ok(findPath({column:2,row:2},{column:5,row:2},8,walls.isBlocked,walls.cannotStop));
});

test('one builder switches material types without losing the leftover stack',()=>{
 const items=[{type:'wood',quantity:100,column:3,row:2},{type:'stone',quantity:200,column:4,row:2}];
 const {walls,tick}=scene(items);const builder=pawn();const wood=walls.plan({column:2,row:4},'wood');const stone=walls.plan({column:6,row:4},'stone');
 for(let i=0;i<300&&(wood.state==='planned'||stone.state==='planned');i++)tick([builder]);
 assert.equal(wood.state,'completed');assert.equal(stone.state,'completed');
 const woodRemaining=items.filter(i=>i.type==='wood').reduce((n,i)=>n+i.quantity,0)+(builder.inventory?.type==='wood'?builder.inventory.quantity:0);
 const stoneRemaining=items.filter(i=>i.type==='stone').reduce((n,i)=>n+i.quantity,0)+(builder.inventory?.type==='stone'?builder.inventory.quantity:0);
 assert.equal(woodRemaining,98);assert.equal(stoneRemaining,198);
});

test('construction target is reselected by arrival time after collecting materials',()=>{
 const {walls,engine,tick}=scene([{type:'wood',quantity:100,column:6,row:2}]);const builder=pawn();
 const initial=walls.plan({column:2,row:4},'wood');const afterPickup=walls.plan({column:6,row:4},'wood');
 engine.update(builder,.05);assert.equal(builder.job.target,initial);
 for(let i=0;i<60&&!builder.inventory;i++)tick([builder]);
 assert.ok(builder.inventory);assert.equal(builder.job.target,afterPickup);
});

test('drafting interrupts construction without losing materials or work, then resumes from the remaining time',()=>{
 const {walls,engine}=scene();const builder=pawn();const target=walls.plan({column:3,row:2},'wood');target.delivered=2;
 engine.update(builder,0);engine.update(builder,.4);assert.equal(target.workSeconds,.4);
 builder.mode='drafted';engine.cancel(builder);engine.update(builder,2);
 assert.equal(target.workSeconds,.4);assert.equal(target.delivered,2);assert.equal(target.state,'planned');
 builder.mode='automatic';engine.update(builder,0);engine.update(builder,.59);
 assert.equal(target.state,'planned');assert.ok(target.workSeconds>.98);
 engine.update(builder,.02);assert.equal(target.state,'completed');assert.equal(target.workSeconds,1);assert.equal(target.delivered,2);
});

test('a different automatic pawn can finish progress saved by an interrupted builder',()=>{
 const {walls,engine}=scene();const first=pawn();const second=pawn();const target=walls.plan({column:3,row:2},'stone');target.delivered=2;
 engine.update(first,0);engine.update(first,.25);first.mode='drafted';engine.cancel(first);
 engine.update(second,0);assert.equal(second.job.phase,'build');assert.equal(target.workSeconds,.25);
 engine.update(second,.75);assert.equal(target.state,'completed');assert.equal(target.workSeconds,1);assert.equal(target.delivered,2);
});

test('removing a plan stops its assigned builder and prevents completion',()=>{
 const {walls,engine,tick}=scene([{type:'wood',quantity:100,column:3,row:2}]);const builder=pawn();const target=walls.plan({column:5,row:2},'wood');
 engine.update(builder,.05);assert.equal(builder.job.target,target);
 assert.equal(walls.removePlan(target),target);tick([builder]);
 assert.equal(builder.job,null);assert.equal(engine.claims.size,0);assert.equal(target.state,'cancelled');
 for(let i=0;i<50;i++)tick([builder]);assert.equal(walls.items.has('5,2'),false);assert.equal(target.workSeconds,0);
});

test('pickup obeys the 20kg limit for wood and stone',()=>{
 for(const [type,limit] of [['wood',20],['stone',5]]){
  const items=[{type,quantity:100,column:3,row:2}];const {walls,tick}=scene(items);walls.plan({column:5,row:2},type);const builder=pawn();
  for(let i=0;i<100&&!builder.inventory;i++)tick([builder]);
  assert.equal(builder.inventory.quantity,limit);assert.equal(items[0].quantity,100-limit);
 }
});

test('dropping puts held materials on the ground at the next safe tile and releases the job',()=>{
 const items=[];const {engine,tick}=scene(items);const builder=pawn();builder.mode='drafted';builder.inventory={type:'wood',quantity:20};
 builder.movement.destination={column:5,row:2};advanceMovement(builder.movement,.125);
 engine.requestDrop(builder);assert.equal(builder.dropRequested,true);assert.equal(items.length,0);
 tick([builder],.125);tick([builder],.01);
 assert.equal(builder.inventory,null);assert.equal(builder.dropRequested,false);
 assert.deepEqual(items,[{column:3,row:2,type:'wood',quantity:20}]);
});

test('only the owning builder advances a single plan, and interruption allows handover',()=>{
 const {walls,engine}=scene();const target=walls.plan({column:3,row:2},'wood');target.delivered=2;const first=pawn(),second=pawn();
 engine.update(first,0);engine.update(second,0);assert.equal(second.job,null);
 engine.update(first,.25);engine.update(second,.25);assert.equal(target.workSeconds,.25);
 first.mode='drafted';engine.cancel(first);engine.update(second,.25);assert.equal(engine.claims.get(target),second);
 engine.update(first,.25);engine.update(second,.25);assert.equal(target.workSeconds,.5);
});

test('immediate construction keeps the selected plan across multiple supply trips, accepts drafted orders and releases its claim',()=>{
 const {walls,engine,tick}=scene([{type:'stone',quantity:30,column:1,row:2}]);
 const near=walls.plan({column:3,row:2},'stone'),target=walls.plan({column:6,row:2},'stone');
 const builder=pawn(),other=pawn(2,3);builder.mode='drafted';builder.movement.planningAllowed=false;
 assert.equal(engine.request(builder,target),true);assert.equal(engine.canRequest(other,target),false);
 for(let i=0;i<1000&&target.state==='planned';i++)tick([builder]);
 assert.equal(target.state,'completed');assert.equal(near.delivered,0);assert.equal(builder.forcedConstruction,undefined);assert.equal(engine.claims.has(target),false);
 assert.equal(engine.request(builder,near),true);engine.cancel(builder);assert.equal(builder.forcedConstruction,undefined);assert.equal(engine.claims.has(near),false);
});

test('a full load supplies nearby matching plans before starting construction',()=>{
 const items=[{type:'wood',quantity:100,column:2,row:2}],{walls,tick}=scene(items),builder=pawn();
 const first=walls.plan({column:3,row:2},'wood'),second=walls.plan({column:4,row:2},'wood');
 for(let i=0;i<100&&second.delivered<2;i++){tick([builder]);if(second.delivered<2)assert.equal(first.workSeconds,0);}
 assert.equal(first.delivered,2);assert.equal(second.delivered,2);assert.equal(items[0].quantity,80);assert.equal(builder.inventory.quantity,16);
 for(let i=0;i<200;i++)tick([builder]);assert.equal(first.state,'completed');assert.equal(second.state,'completed');
});

test('batch delivery excludes different kinds and materials and respects claims',()=>{
 const {walls,engine}=scene(),builder=pawn();builder.inventory={type:'wood',quantity:20};
 const first=walls.plan({column:3,row:2},'wood');first.delivered=2;
 walls.plan({column:4,row:2},'wood','barricade');walls.plan({column:3,row:3},'stone');
 const claimed=walls.plan({column:4,row:3},'wood');engine.claims.set(claimed,pawn());
 assert.equal(engine.assignDelivery(builder,'all',first),false);
});

test('builders deliver and finish construction from all four diagonal tiles with cardinal access blocked',()=>{
 for(const kind of ['wall','woodFloor','stoneFloor'])for(const [dc,dr] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
  const {walls,tick}=scene([],9),target=walls.plan({column:4,row:4},kind==='stoneFloor'?'stone':'wood',kind);
  for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])walls.complete(walls.plan({column:4+dx,row:4+dy},'stone'));
  const builder=pawn(4+dc,4+dr);builder.inventory={type:target.material,quantity:kind==='wall'?2:1};
  for(let i=0;i<80&&target.state==='planned';i++)tick([builder]);
  assert.equal(target.state,'completed');assert.deepEqual(builder.movement.tile,{column:4+dc,row:4+dr});assert.equal(builder.inventory,null);
 }
});

test('immediate construction releases a material-starved order instead of reserving the plan forever',()=>{
 const {walls,engine}=scene(),builder=pawn(),target=walls.plan({column:3,row:2},'wood');
 assert.equal(engine.request(builder,target),true);engine.update(builder,0);
 assert.equal(builder.forcedConstruction,undefined);assert.equal(builder.job,null);assert.equal(engine.claims.has(target),false);assert.equal(target.state,'planned');
});
