import test from 'node:test';
import assert from 'node:assert/strict';
import { Walls } from '../src/walls.ts';
import { Storage } from '../src/storage.ts';
import { Construction } from '../src/construction.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Hauling } from '../src/hauling.ts';
import { Clearing } from '../src/clearing.ts';
import { createMovement } from '../src/movement.ts';
import { advancePathMovement } from '../src/pathfinding.ts';
import { updateWork } from '../src/work-priorities.ts';
import { countItems } from '../src/items.ts';
function scene(items,type='wall'){
 const walls=new Walls(10),storage=new Storage(walls),hauling=new Hauling(items,storage),clearing=new Clearing(items,hauling);hauling.clearing=clearing;
 const plan=walls.plan({column:3,row:3},'wood',type);plan.delivered=type==='wall'?10:0;
 const needsClearing=t=>items.some(i=>i.quantity>0&&i.column===t.column&&i.row===t.row)||clearing.isClearing(t);
 const construction=new Construction(walls,items,t=>walls.complete(t),needsClearing);construction.storage=storage;const harvesting=new Harvesting([],items,walls);
 const worker={movement:createMovement({column:2,row:3}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,priorities:{construction:1,harvesting:3,hauling:3,free:4}};
 const tick=(n=1,w=worker)=>{for(let i=0;i<n;i++){updateWork(w,construction,harvesting,.1,()=>0,.1,hauling,clearing);advancePathMovement(w.movement,.1,10,walls.isBlocked,walls.cannotStop);}};
 return{walls,items,plan,hauling,clearing,construction,worker,tick};
}
test('ignored items on a plan are relocated before building even with higher construction priority',()=>{
 const s=scene([{column:3,row:3,type:'wood',quantity:25,collect:false}]);const totals=countItems(s.items);s.tick();assert.ok(s.worker.clearJob);assert.equal(s.plan.workSeconds,0);
 for(let i=0;i<100&&s.plan.state!=='completed';i++){s.tick();if(s.items.some(i=>i.quantity>0&&i.column===3&&i.row===3)||s.clearing.isClearing(s.plan))assert.equal(s.plan.workSeconds,0);}
 assert.equal(s.plan.state,'completed');assert.deepEqual(countItems(s.items),totals);assert.ok(s.items.filter(i=>i.quantity>0).every(i=>i.column!==3||i.row!==3));assert.equal(s.worker.inventory,null);
});
test('stone relocation takes repeated20kg trips and preserves every item and acquisition flag',()=>{
 const s=scene([{column:3,row:3,type:'stone',quantity:8,collect:true}]);let max=0;for(let i=0;i<150;i++){s.tick();max=Math.max(max,(s.worker.inventory?.quantity??0)*4);}assert.equal(max,20);assert.equal(s.plan.state,'completed');assert.equal(countItems(s.items).stone,8);assert.ok(s.items.filter(i=>i.quantity>0).every(i=>i.collect));
});
test('existing carried material is dropped safely before lifting a different kind of obstructing item',()=>{
 const s=scene([{column:3,row:3,type:'stone',quantity:2}]);s.worker.inventory={type:'wood',quantity:7};s.tick(100);assert.equal(s.plan.state,'completed');assert.deepEqual(countItems(s.items),{wood:7,stone:2,strawberry:0,rifle:0,meat:0,humanCorpse:0,deerCorpse:0});
});
test('no safe reachable placement means no pickup and no construction',()=>{
 const s=scene([{column:3,row:3,type:'wood',quantity:5}]);for(let r=0;r<10;r++)for(let c=0;c<10;c++)if(c!==3||r!==3)s.walls.plan({column:c,row:r},'wood');s.tick(20);assert.equal(s.items[0].quantity,5);assert.equal(s.worker.inventory,null);assert.equal(s.plan.workSeconds,0);
});
test('a site remains blocked until the lifted items have actually been put down',()=>{
 const s=scene([{column:3,row:3,type:'wood',quantity:2}]);for(let i=0;i<20&&!s.worker.inventory;i++)s.tick();assert.equal(s.items[0].quantity,0);assert.equal(s.clearing.isClearing(s.plan),true);assert.equal(s.construction.nearestPlan(s.worker,undefined,'build'),null);s.tick(100);assert.equal(s.plan.state,'completed');
});
test('drafting releases relocation reservations without losing cargo',()=>{
 const s=scene([{column:3,row:3,type:'wood',quantity:20}]);for(let i=0;i<20&&!s.worker.inventory;i++)s.tick();s.worker.mode='drafted';s.tick();assert.equal(s.clearing.claims.size,0);assert.equal(s.worker.inventory.quantity,20);assert.equal(s.plan.workSeconds,0);
});
test('a changed placement destination is reselected while retaining cargo',()=>{
 const s=scene([{column:3,row:3,type:'wood',quantity:20}]);for(let i=0;i<20&&s.worker.clearJob?.phase!=='drop';i++)s.tick();const old=s.worker.clearJob.goal;s.walls.plan(old,'wood');s.tick(100);assert.equal(s.plan.state,'completed');assert.equal(countItems(s.items).wood+(s.worker.inventory?.quantity??0),20);assert.ok(!s.items.some(i=>i.quantity>0&&i.column===old.column&&i.row===old.row));
});
