import test from 'node:test';
import assert from 'node:assert/strict';
import { Walls } from '../src/walls.ts';
import { Construction } from '../src/construction.ts';
import { Harvesting } from '../src/harvesting.ts';
import { createMovement } from '../src/movement.ts';
import { updateWork } from '../src/work-priorities.ts';
import { demolishStructure } from '../src/demolition.ts';
import { countItems } from '../src/items.ts';
function scene(kind='wall',material='wood'){
 const walls=new Walls(8),items=[],target=walls.plan({column:3,row:3},material,kind);walls.complete(target);target.demolition=true;
 const construction=new Construction(walls,items,t=>walls.complete(t));construction.demolish=t=>Boolean(demolishStructure(walls,items,t));const harvesting=new Harvesting([],items,walls);
 const worker={movement:createMovement({column:2,row:3}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,priorities:{construction:1,harvesting:3,hauling:3,free:4}};
 const tick=seconds=>updateWork(worker,construction,harvesting,seconds);
 return {walls,items,target,construction,worker,tick};
}
test('marked wood and stone walls are demolished as construction and refund exactly half once',()=>{
 for(const material of ['wood','stone']){const s=scene('wall',material);s.tick(0);assert.equal(s.worker.job.phase,'demolish');s.tick(.9);assert.equal(s.walls.isBlocked(s.target),true);s.tick(.1);assert.equal(s.walls.isBlocked(s.target),false);assert.equal(countItems(s.items)[material],1);assert.equal(demolishStructure(s.walls,s.items,s.target),null);assert.equal(countItems(s.items)[material],1);}
});
test('box demolition refunds15wood and returns all stored contents',()=>{
 const s=scene('storage');s.target.stored={wood:40,stone:23,strawberry:0,ration:0,rifle:0,knife:0,meat:0,humanCorpse:0,deerCorpse:0,wolfCorpse:0};s.tick(0);s.tick(3);assert.deepEqual(countItems(s.items),{wood:55,stone:23,strawberry:0,ration:0,rifle:0,knife:0,meat:0,humanCorpse:0,deerCorpse:0,wolfCorpse:0});assert.equal(s.walls.items.size,0);
});
test('drafting pauses demolition and a second builder resumes the saved progress',()=>{
 const s=scene();s.tick(0);s.tick(.4);s.worker.mode='drafted';s.tick(2);assert.equal(s.target.demolitionSeconds,.4);const other={...s.worker,movement:createMovement({column:2,row:3}),mode:'automatic',job:null};s.construction.update(other,0,'build');assert.equal(other.job.phase,'demolish');s.construction.update(other,.6,'build');assert.equal(s.target.state,'cancelled');
});
test('transport does not demolish and one construction worker reserves each target',()=>{
 const s=scene();s.construction.update(s.worker,0,'transport');assert.equal(s.worker.job,null);s.tick(.3);const other={...s.worker,job:null};assert.equal(s.construction.nearestPlan(other,undefined,'build'),null);s.worker.priorities={construction:4,harvesting:3,hauling:1,free:2};s.tick(1);assert.equal(s.target.demolitionSeconds,undefined);assert.equal(s.worker.job,null);
});
test('unmarked, planned or unsupported buildings cannot be demolished',()=>{
 const s=scene();s.target.demolition=false;assert.equal(demolishStructure(s.walls,s.items,s.target),null);s.target.demolition=true;s.target.state='planned';assert.equal(demolishStructure(s.walls,s.items,s.target),null);s.target.state='completed';s.target.kind='storageArea';assert.equal(demolishStructure(s.walls,s.items,s.target),null);assert.deepEqual(s.items,[]);
});
