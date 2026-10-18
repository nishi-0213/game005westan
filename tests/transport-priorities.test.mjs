import test from 'node:test';
import assert from 'node:assert/strict';
import { Walls } from '../src/walls.ts';
import { Storage } from '../src/storage.ts';
import { Hauling } from '../src/hauling.ts';
import { Construction } from './helpers/construction.mjs';
import { Harvesting } from '../src/harvesting.ts';
import { createMovement } from '../src/movement.ts';
import { advancePathMovement } from '../src/pathfinding.ts';
import { updateWork } from '../src/work-priorities.ts';
function scene(priorities){
 const walls=new Walls(10),items=[],storage=new Storage(walls);const box=walls.plan({column:6,row:6},'wood','storage');walls.complete(box);storage.deposit(box,'wood',40);
 const plan=walls.plan({column:3,row:2},'wood');const construction=new Construction(walls,items,t=>walls.complete(t));construction.storage=storage;
 const node={column:2,row:3,type:'tree',collect:false,collected:false,workSeconds:0};const harvesting=new Harvesting([node],items,walls);const hauling=new Hauling(items,storage);
 const worker={movement:createMovement({column:2,row:2}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,priorities};
 const tick=(w=worker,count=1)=>{for(let i=0;i<count;i++){updateWork(w,construction,harvesting,.1,()=>0,.1,hauling);advancePathMovement(w.movement,.1,10,walls.isBlocked,walls.cannotStop);}};
 return {walls,items,storage,box,plan,node,construction,harvesting,hauling,worker,tick};
}
test('transport, harvesting and actual building use independent priorities',()=>{
 for(const [priorities,expected] of [[{construction:1,harvesting:2,hauling:4,free:4},'build'],[{construction:2,harvesting:2,hauling:1,free:4},'transport'],[{construction:2,harvesting:1,hauling:2,free:4},'harvest']]){
  const s=scene(priorities);s.node.collect=true;const ready=s.walls.plan({column:4,row:2},'wood');ready.delivered=10;s.tick();
  if(expected==='harvest')assert.ok(s.worker.harvestJob);else assert.equal(s.worker.job.phase,expected==='build'?'build':'gather');
 }
});
test('a transport specialist supplies a plan but leaves construction to another pawn',()=>{
 const s=scene({construction:4,harvesting:4,hauling:1,free:2});s.tick(s.worker,200);assert.equal(s.plan.delivered,2);assert.equal(s.plan.workSeconds,0);assert.equal(s.plan.state,'planned');assert.equal(s.construction.claims.has(s.plan),false);
 const builder={...s.worker,movement:createMovement({column:2,row:2}),job:null,haulJob:null,priorities:{construction:1,harvesting:4,hauling:4,free:2}};
 s.tick(builder,20);assert.equal(s.plan.state,'completed');assert.equal(s.storage.totals().wood,38);
});
test('active ground hauling reaches storage before switching to construction delivery',()=>{
 const s=scene({construction:3,harvesting:3,hauling:1,free:4});const stack={column:3,row:3,type:'stone',quantity:2,collect:true};s.items.push(stack);s.hauling.update(s.worker);assert.ok(s.worker.haulJob);
 for(let i=0;i<100&&s.box.stored.stone<2;i++){s.tick();assert.equal(s.plan.delivered,0);}assert.equal(s.box.stored.stone,2);s.tick(s.worker,150);assert.equal(s.plan.state,'completed');
});
test('raising free priority interrupts transport without losing delivered or carried resources',()=>{
 const s=scene({construction:4,harvesting:4,hauling:1,free:3});for(let i=0;i<100&&s.plan.delivered<1;i++)s.tick();assert.equal(s.plan.delivered,1);const carried=s.worker.inventory.quantity;s.worker.priorities.hauling=2;s.worker.priorities.free=1;s.tick();assert.equal(s.worker.job,null);assert.equal(s.plan.delivered,1);assert.equal(s.worker.inventory.quantity,carried);s.worker.priorities.free=3;s.tick(s.worker,100);assert.equal(s.plan.delivered,2);
});
