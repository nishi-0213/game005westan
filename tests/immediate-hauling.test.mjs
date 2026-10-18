import test from 'node:test';
import assert from 'node:assert/strict';
import { Hauling } from '../src/hauling.ts';
import { Construction } from './helpers/construction.mjs';
import { Storage } from '../src/storage.ts';
import { Walls } from '../src/walls.ts';
import { createMovement } from '../src/movement.ts';
import { advancePathMovement } from '../src/pathfinding.ts';
import { countItems } from '../src/items.ts';
function scene(quantity=45,type='wood'){
 const walls=new Walls(12),source={column:3,row:3,type,quantity,collect:false},items=[source],storage=new Storage(walls),hauling=new Hauling(items,storage),construction=new Construction(walls,items,t=>walls.complete(t));
 const worker={movement:createMovement({column:2,row:3}),mode:'automatic',weapon:'unarmed',inventory:null,job:null,retrySeconds:0};
 const box=walls.plan({column:6,row:5},'wood','storage');walls.complete(box);
 const tick=()=>{hauling.update(worker);advancePathMovement(worker.movement,.1,12,walls.isBlocked,walls.cannotStop)};
 return{walls,source,items,storage,hauling,construction,worker,box,tick};
}
test('immediate hauling completes ignored stacks over repeated weight-limited trips without changing the collect flag',()=>{
 const s=scene();assert.ok(s.hauling.request(s.worker,s.source));let max=0;
 for(let i=0;i<400&&s.worker.forcedHaulSource;i++){s.tick();max=Math.max(max,s.worker.inventory?.quantity??0)}
 assert.equal(s.box.stored.wood,45);assert.equal(s.source.quantity,0);assert.equal(s.source.collect,false);assert.equal(max,20);assert.equal(s.worker.forcedHaulSource,null);assert.equal(s.hauling.claims.size,0);
});
test('equipped weapons limit immediate stone hauling to3items and existing inventory is stored first',()=>{
 const s=scene(8,'stone');s.worker.weapon='rifle';s.worker.inventory={type:'wood',quantity:10};assert.ok(s.hauling.request(s.worker,s.source));let max=0;
 for(let i=0;i<400&&s.worker.forcedHaulSource;i++){s.tick();if(s.worker.inventory?.type==='stone')max=Math.max(max,s.worker.inventory.quantity)}
 assert.equal(max,3);assert.equal(s.box.stored.stone,8);assert.equal(s.box.stored.wood,10);assert.equal(s.worker.inventory,null);
});
test('missing or rejecting storage, drafted/dead actors and other workers claims reject commands',()=>{
 const s=scene();s.box.accepted.wood=false;assert.equal(s.hauling.request(s.worker,s.source),false);assert.equal(s.source.quantity,45);
 s.box.accepted.wood=true;s.worker.mode='drafted';assert.equal(s.hauling.request(s.worker,s.source),false);s.worker.mode='automatic';s.worker.dead=true;assert.equal(s.hauling.request(s.worker,s.source),false);s.worker.dead=false;
 s.hauling.claims.set(s.source,{});assert.equal(s.hauling.request(s.worker,s.source),false);
});
test('cancelled commands release source reservations while preserving carried items',()=>{
 const s=scene();s.hauling.request(s.worker,s.source);for(let i=0;i<40&&!s.worker.inventory;i++)s.tick();assert.ok(s.worker.inventory);
 s.hauling.cancel(s.worker);assert.equal(s.hauling.claims.size,0);assert.equal(s.worker.forcedHaulSource,null);assert.equal(countItems(s.items).wood+s.worker.inventory.quantity,45);
});
test('the drop command drops equipped rifle and carried materials once, then returns to unarmed',()=>{
 const s=scene();s.worker.weapon='rifle';s.worker.inventory={type:'stone',quantity:3};s.construction.requestDrop(s.worker);s.construction.update(s.worker,.1);
 assert.equal(s.worker.weapon,'unarmed');assert.equal(s.worker.inventory,null);assert.equal(countItems(s.items).rifle,1);assert.equal(countItems(s.items).stone,3);
 s.construction.update(s.worker,.1);assert.equal(countItems(s.items).rifle,1);
 const t=scene();t.worker.weapon='rifle';t.construction.requestDrop(t.worker);assert.equal(t.worker.dropRequested,true);t.construction.update(t.worker,.1);assert.equal(countItems(t.items).rifle,1);
});
