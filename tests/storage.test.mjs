import test from 'node:test';
import assert from 'node:assert/strict';
import { Walls, BUILD_RECIPES } from '../src/walls.ts';
import { Storage } from '../src/storage.ts';
import { Hauling } from '../src/hauling.ts';
import { Construction } from '../src/construction.ts';
import { Harvesting } from '../src/harvesting.ts';
import { updateWork } from '../src/work-priorities.ts';
import { createMovement } from '../src/movement.ts';
import { advancePathMovement } from '../src/pathfinding.ts';
import { nearbyItems } from '../src/items.ts';
function scene(items=[]){
 const walls=new Walls(12),storage=new Storage(walls),hauling=new Hauling(items,storage),construction=new Construction(walls,items,t=>walls.complete(t));construction.storage=storage;
 const harvesting=new Harvesting([],items,walls);
 const worker={movement:createMovement({column:2,row:2}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,priorities:{construction:3,harvesting:3,free:3}};
 const tick=(count=1)=>{for(let i=0;i<count;i++){updateWork(worker,construction,harvesting,.1,()=>0,.1,hauling);advancePathMovement(worker.movement,.1,12,walls.isBlocked,walls.cannotStop);}};
 const box=(tile={column:5,row:5})=>{const b=walls.plan(tile,'wood','storage');walls.complete(b);return b;};
 return {walls,storage,hauling,construction,worker,tick,box,items};
}
test('storage recipe is wood30/3seconds; totals exclude ground, plans and carried inventory',()=>{
 const s=scene([{column:3,row:3,type:'wood',quantity:100}]);const planned=s.walls.plan({column:7,row:7},'stone','storage');assert.equal(planned.material,'wood');assert.deepEqual(BUILD_RECIPES.storage,{materialCount:30,seconds:3});assert.deepEqual(s.storage.totals(),{wood:0,stone:0,strawberry:0,ration:0,rifle:0,knife:0,meat:0,humanCorpse:0,deerCorpse:0,wolfCorpse:0,hat:0,jacket:0,trousers:0,ballisticVest:0,gloves:0});const box=s.box();s.storage.deposit(box,'wood',2000);assert.deepEqual(s.storage.totals(),{wood:2000,stone:0,strawberry:0,ration:0,rifle:0,knife:0,meat:0,humanCorpse:0,deerCorpse:0,wolfCorpse:0,hat:0,jacket:0,trousers:0,ballisticVest:0,gloves:0});assert.equal(s.walls.isBlocked(box),true);
});
test('ignored items are not hauled; marked items arrive with no losses under20kg',()=>{
 const stack={column:3,row:2,type:'stone',quantity:8};const s=scene([stack]);const box=s.box();s.tick(20);assert.equal(stack.quantity,8);stack.collect=true;let max=0;for(let i=0;i<300;i++){s.tick();max=Math.max(max,(s.worker.inventory?.quantity??0)*4);}assert.equal(max,20);assert.equal(stack.quantity,0);assert.equal(box.stored.stone,8);assert.equal(s.worker.inventory,null);
});
test('filters prevent new deposits and can be changed while hauling; contents remain available for building',()=>{
 const stack={column:3,row:2,type:'wood',quantity:20,collect:true};const s=scene([stack]);const box=s.box();box.accepted.wood=false;s.tick(20);assert.equal(stack.quantity,20);box.accepted.wood=true;s.tick(200);assert.equal(box.stored.wood,20);box.accepted.wood=false;const plan=s.walls.plan({column:6,row:6},'wood');s.tick(200);assert.equal(plan.state,'completed');assert.equal(box.stored.wood+(s.worker.inventory?.quantity??0),18);
});
test('construction uses a reachable nearest box and ignores unmarked ground resources',()=>{
 const s=scene([{column:2,row:2,type:'wood',quantity:100}]);const plan=s.walls.plan({column:3,row:3},'wood');s.tick(30);assert.equal(plan.delivered,0);const far=s.box({column:9,row:9}),near=s.box({column:4,row:2});s.storage.deposit(far,'wood',50);s.storage.deposit(near,'wood',20);s.worker.priorities.construction=1;s.tick(100);assert.equal(plan.state,'completed');assert.equal(far.stored.wood,50);assert.equal(s.items[0].quantity,100);
});
test('unmarked supplies wait until marked; the first box and area preserve all resources',()=>{
 const stack={column:3,row:2,type:'wood',quantity:100};const s=scene([stack]);const box=s.walls.plan({column:4,row:3},'wood','storage');s.tick(50);assert.equal(box.delivered,0);
 const area=s.walls.plan({column:5,row:4},'wood','storageArea');s.walls.complete(area);assert.deepEqual(BUILD_RECIPES.storageArea,{materialCount:0,seconds:0});assert.equal(s.walls.isBlocked(area),false);assert.equal(s.walls.cannotStop(area),false);
 stack.collect=true;s.tick(500);assert.equal(box.state,'completed');assert.equal(box.delivered,30);assert.equal(box.workSeconds,3);assert.equal(s.storage.totals().wood,70);assert.equal(stack.quantity,0);
});
test('one area stores a single type and at most100 units; withdrawing all permits a different type',()=>{
 const s=scene();const area=s.walls.plan({column:4,row:4},'wood','storageArea');s.walls.complete(area);assert.equal(s.storage.deposit(area,'wood',150),100);assert.equal(s.storage.deposit(area,'stone',3),0);assert.equal(s.storage.deposit(area,'wood',1),0);s.storage.sources('wood')[0].quantity=0;assert.equal(s.storage.deposit(area,'stone',8),8);assert.equal(s.storage.deposit(area,'wood',12),0);
});
test('hauling stops at area capacity and leaves excess on the ground',()=>{
 const stack={column:3,row:2,type:'wood',quantity:140,collect:true};const s=scene([stack]);const area=s.walls.plan({column:5,row:4},'wood','storageArea');s.walls.complete(area);s.tick(500);assert.equal(area.stored.wood,100);assert.equal(stack.quantity,40);assert.equal(s.worker.inventory,null);
});
test('one worker claims each stack and drafting releases its claim without consuming items',()=>{
 const stack={column:8,row:8,type:'wood',quantity:30,collect:true};const s=scene([stack]);s.box();s.hauling.update(s.worker);assert.ok(s.worker.haulJob);const other={...s.worker,movement:createMovement({column:3,row:3}),haulJob:null};assert.equal(s.hauling.findWork(other),null);s.worker.mode='drafted';s.hauling.update(s.worker);assert.equal(stack.quantity,30);assert.ok(s.hauling.findWork(other));
});
test('turning acquisition off before pickup cancels hauling; resuming after drafting conserves carried items',()=>{
 const stack={column:8,row:8,type:'wood',quantity:20,collect:true};const s=scene([stack]);const box=s.box();s.tick();stack.collect=false;s.tick(100);assert.equal(stack.quantity,20);stack.collect=true;for(let i=0;i<100&&!s.worker.inventory;i++)s.tick();assert.equal(s.worker.inventory.quantity,20);s.worker.mode='drafted';s.tick(20);assert.equal(box.stored.wood,0);s.worker.mode='automatic';s.tick(200);assert.equal(box.stored.wood,20);
});
test('item double selection uses the same10x10 boundaries and same type',()=>{
 const target={column:10,row:10,type:'wood',quantity:1};const inside={column:5,row:14,type:'wood',quantity:1};const outside={column:15,row:10,type:'wood',quantity:1};assert.deepEqual(nearbyItems([target,inside,outside,{...inside,type:'stone'},{...inside,quantity:0}],target),[target,inside]);
});
test('simultaneous deliveries cannot overfill one area or lose surplus carried items',()=>{
 const stacks=[{column:3,row:2,type:'wood',quantity:20,collect:true},{column:3,row:3,type:'wood',quantity:20,collect:true}];const s=scene(stacks);const area=s.walls.plan({column:5,row:5},'wood','storageArea');s.walls.complete(area);s.storage.deposit(area,'wood',80);const other={...s.worker,movement:createMovement({column:2,row:3})};
 s.hauling.update(s.worker);s.hauling.update(other);
 for(let i=0;i<100;i++)for(const w of [s.worker,other]){advancePathMovement(w.movement,.1,12,s.walls.isBlocked,s.walls.cannotStop);s.hauling.update(w);}
 assert.equal(area.stored.wood,100);assert.equal(stacks.reduce((n,i)=>n+i.quantity,0)+(s.worker.inventory?.quantity??0)+(other.inventory?.quantity??0),20);
});

test('stored item source identity persists across selection and quantity updates and clears on removal',()=>{
 const s=scene([]),box=s.box();s.storage.deposit(box,'knife',2);
 const a=s.storage.sources('knife')[0];assert.equal(s.storage.sources('knife')[0],a);assert.equal(s.storage.isSource(a),true);
 s.storage.deposit(box,'knife',1);assert.equal(a.quantity,3);a.quantity=0;assert.equal(s.storage.sources('knife').length,0);
 s.storage.deposit(box,'knife',1);s.walls.erase(box);assert.equal(a.quantity,0);
});


test('construction compares collected ground materials and stored supplies by reachable path distance',()=>{
 for(const nearer of ['ground','stored']){
  const ground={column:nearer==='ground'?3:9,row:2,type:'wood',quantity:20,collect:true};
  const s=scene([ground]),box=s.box({column:nearer==='stored'?4:9,row:nearer==='stored'?2:9});s.storage.deposit(box,'wood',20);
  s.walls.plan({column:6,row:5},'wood');s.construction.update(s.worker,0);
  assert.equal(s.worker.job.phase,'gather');
  assert.equal(s.worker.job.source===ground,nearer==='ground');
 }
});
test('collected ground resources can build without any storage and are consumed once',()=>{
 const stack={column:3,row:2,type:'wood',quantity:2,collect:true},s=scene([stack]);
 const plan=s.walls.plan({column:5,row:3},'wood');
 for(let i=0;i<100&&plan.state!=='completed';i++){
  s.construction.update(s.worker,.1);advancePathMovement(s.worker.movement,.1,12,s.walls.isBlocked,s.walls.cannotStop);
 }
 assert.equal(plan.state,'completed');assert.equal(plan.delivered,2);assert.equal(stack.quantity,0);assert.equal(s.worker.inventory,null);
});
test('unreachable collected ground supplies do not prevent using reachable storage',()=>{
 const ground={column:1,row:1,type:'wood',quantity:20,collect:true},s=scene([ground]);
 for(const tile of [{column:0,row:1},{column:1,row:0},{column:2,row:1},{column:1,row:2}])s.walls.complete(s.walls.plan(tile,'wood'));
 const box=s.box({column:8,row:8});s.storage.deposit(box,'wood',20);s.walls.plan({column:5,row:5},'wood');
 s.construction.update(s.worker,0);assert.equal(s.worker.job.phase,'gather');assert.notEqual(s.worker.job.source,ground);
});
test('unmarking ground resources releases an in-flight construction pickup without consuming them',()=>{
 const ground={column:5,row:2,type:'wood',quantity:20,collect:true},s=scene([ground]);
 const plan=s.walls.plan({column:6,row:5},'wood');s.construction.update(s.worker,0);assert.equal(s.worker.job.source,ground);
 ground.collect=false;s.construction.update(s.worker,.1);assert.equal(s.worker.job,null);assert.equal(s.construction.claims.has(plan),false);assert.equal(ground.quantity,20);assert.equal(s.worker.inventory,null);
});
