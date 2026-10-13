import assert from 'node:assert/strict';
import test from 'node:test';
import { initialEnvironment, nearbySameType } from '../src/environment.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Walls } from '../src/walls.ts';
import { Construction } from '../src/construction.ts';
import { createMovement, advanceMovement } from '../src/movement.ts';

const object=(type,column,row)=>({type,column,row,collect:true,collected:false,workSeconds:0});
const pawn=()=>({movement:createMovement({column:2,row:2}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0});

test('random environmental placement produces unique trees/rocks and preserves the central spawn area',()=>{
 let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 const objects=initialEnvironment(32,random);
 assert.equal(objects.filter(o=>o.type==='tree').length,24);
 assert.equal(objects.filter(o=>o.type==='wildStrawberry').length,16);
 const rocks=objects.filter(o=>o.type==='rock');assert.ok(rocks.length>=12&&rocks.length<=32);
 const groups=new Map();for(const rock of rocks){if(!groups.has(rock.clusterId))groups.set(rock.clusterId,[]);groups.get(rock.clusterId).push(rock);}
 assert.equal(groups.size,4);
 for(const chain of groups.values()){
  assert.ok(chain.length>=3&&chain.length<=8);
  for(let i=1;i<chain.length;i++)assert.equal(Math.max(Math.abs(chain[i].column-chain[i-1].column),Math.abs(chain[i].row-chain[i-1].row)),1);
  const dx=chain.slice(1).map((r,i)=>r.column-chain[i].column),dy=chain.slice(1).map((r,i)=>r.row-chain[i].row);
  assert.ok(new Set(dx).size===1||new Set(dy).size===1);
 }
 assert.equal(new Set(objects.map(o=>`${o.column},${o.row}`)).size,objects.length);
 assert.ok(objects.every(o=>o.column<14||o.column>18||o.row<14||o.row>18));
 assert.ok(objects.every(o=>!o.collect&&!o.collected));
});

test('double-click selection uses exactly a 10x10 same-type area',()=>{
 const center=object('tree',10,10);const objects=[center,object('tree',5,5),object('tree',14,14),object('tree',15,10),object('tree',4,10),object('rock',10,11)];
 const removed=object('tree',9,9);removed.collected=true;objects.push(removed);
 assert.deepEqual(nearbySameType(objects,center),objects.slice(0,3));
});

for(const [type,seconds,quantity,material] of [['tree',4,12,'wood'],['rock',5,8,'stone'],['wildStrawberry',1,5,'strawberry']]){
 test(`${type} produces ${quantity} ground items only after ${seconds} seconds`,()=>{
  const target=object(type,3,2),items=[],walls=new Walls(8),engine=new Harvesting([target],items,walls),worker=pawn();
  engine.update(worker,0);assert.ok(worker.harvestJob);
  engine.update(worker,seconds-.1);assert.equal(items.length,0);assert.equal(target.collected,false);
  engine.update(worker,.2);assert.equal(target.collected,true);assert.deepEqual(items,[{type:material,quantity,column:3,row:2,...(material==='strawberry'?{collect:true}:{})}]);assert.equal(worker.inventory,null);
  engine.update(worker,20);assert.equal(items[0].quantity,quantity);
 });
}

test('ignore/drafted settings stop collection while preserving partial work',()=>{
 const target=object('tree',3,2),items=[],engine=new Harvesting([target],items,new Walls(8)),worker=pawn();
 target.collect=false;engine.update(worker,5);assert.equal(worker.harvestJob,null);
 target.collect=true;worker.mode='drafted';engine.update(worker,5);assert.equal(worker.harvestJob,null);
 worker.mode='automatic';worker.harvestRetrySeconds=0;engine.update(worker,0);engine.update(worker,1);
 target.collect=false;engine.update(worker,2);assert.equal(worker.harvestJob,null);assert.equal(target.workSeconds,1);assert.equal(items.length,0);
});

test('nearest reachable object is claimed and another worker cannot duplicate the harvest',()=>{
 const far=object('tree',7,7),near=object('rock',3,2),engine=new Harvesting([far,near],[],new Walls(8)),first=pawn(),second=pawn();
 engine.update(first,0);assert.equal(first.harvestJob.target,near);engine.update(second,0);assert.equal(second.harvestJob.target,far);
});

test('unreachable collection targets do not count as executable work',()=>{
 const walls=new Walls(8);for(let r=0;r<8;r++){walls.plan({column:3,row:r},'stone');walls.complete({column:3,row:r});}
 const engine=new Harvesting([object('tree',5,2)],[],walls);assert.equal(engine.hasAvailableWork(pawn()),false);
});

test('collection preempts construction and construction resumes its saved progress afterwards',()=>{
 const walls=new Walls(8),items=[],target=object('tree',3,3),worker=pawn();target.collect=false;
 const build=walls.plan({column:3,row:2},'wood');build.delivered=10;const construction=new Construction(walls,items,t=>walls.complete(t));const harvesting=new Harvesting([target],items,walls);
 construction.update(worker,0);construction.update(worker,.25);assert.equal(build.workSeconds,.25);
 target.collect=true;
 const tick=(seconds)=>{
  if(worker.harvestJob||harvesting.hasAvailableWork(worker)){if(worker.job)construction.cancel(worker);harvesting.update(worker,seconds);}
  else{construction.update(worker,seconds);harvesting.update(worker,seconds);}
  advanceMovement(worker.movement,seconds,walls.isBlocked,walls.cannotStop);
 };
 tick(0);assert.equal(worker.job,null);assert.ok(worker.harvestJob);
 tick(2);assert.equal(build.workSeconds,.25);assert.equal(target.collected,false);
 tick(2);assert.equal(target.collected,true);tick(0);assert.ok(worker.job);tick(.75);assert.equal(build.state,'completed');
});
