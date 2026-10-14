import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePawnNames, formatPawnName } from '../src/pawn-names.ts';
import { SURNAMES, GIVEN_NAMES, NICKNAMES } from '../src/data/pawn-name-pool.ts';
import { INITIAL_PRIORITIES, nextPriority, updateWork, currentAction } from '../src/work-priorities.ts';
import { Construction } from '../src/construction.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Walls } from '../src/walls.ts';
import { createMovement } from '../src/movement.ts';

function scene(priorities={construction:3,harvesting:3}){
 const walls=new Walls(8),items=[];const plan=walls.plan({column:3,row:2},'wood');plan.delivered=10;
 const node={type:'tree',column:3,row:3,collect:true,collected:false,workSeconds:0};
 const worker={movement:createMovement({column:2,row:2}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,priorities};
 return {worker,plan,node,construction:new Construction(walls,items,t=>walls.complete(t)),harvesting:new Harvesting([node],items,walls)};
}

test('all initial priorities are 3 and clicking loops across all four values',()=>{
 assert.deepEqual(INITIAL_PRIORITIES,Array.from({length:3},()=>({construction:3,harvesting:3,hauling:3,butchery:3,free:3})));
 let value=1;const seen=[];for(let i=0;i<5;i++){seen.push(value);value=nextPriority(value);}assert.deepEqual(seen,[1,2,3,4,1]);
});

test('random names use the separate pools and do not repeat their components',()=>{
 const names=generatePawnNames(3,()=>0);
 assert.equal(new Set(names.map(n=>n.surname)).size,3);assert.equal(new Set(names.map(n=>n.givenName)).size,3);assert.equal(new Set(names.map(n=>n.nickname)).size,3);
 for(const name of names){assert.ok(SURNAMES.includes(name.surname));assert.ok(GIVEN_NAMES.includes(name.givenName));assert.ok(NICKNAMES.includes(name.nickname));assert.ok(formatPawnName(name).includes(name.nickname));}
 assert.notDeepEqual(names,generatePawnNames(3,()=>.9));
});

test('same priorities choose collection, while a smaller construction value chooses building',()=>{
 for(const [priorities,task] of [[{construction:3,harvesting:3},'harvest'],[{construction:1,harvesting:4},'build']]){
  const s=scene(priorities);updateWork(s.worker,s.construction,s.harvesting,0);
  assert.equal(Boolean(s.worker.harvestJob),task==='harvest');assert.equal(Boolean(s.worker.job),task==='build');
 }
});

test('changing priorities interrupts work and keeps the construction progress',()=>{
 const s=scene({construction:1,harvesting:4});updateWork(s.worker,s.construction,s.harvesting,0);updateWork(s.worker,s.construction,s.harvesting,.25);assert.equal(s.plan.workSeconds,.25);
 s.worker.priorities={construction:4,harvesting:1};updateWork(s.worker,s.construction,s.harvesting,0);assert.equal(s.worker.job,null);assert.ok(s.worker.harvestJob);assert.equal(s.plan.workSeconds,.25);
 s.worker.priorities={construction:1,harvesting:4};updateWork(s.worker,s.construction,s.harvesting,0);assert.equal(s.worker.harvestJob,null);assert.ok(s.worker.job);assert.equal(s.plan.workSeconds,.25);
});

test('lower-priority work does not start during the higher-priority retry interval',()=>{
 const s=scene({construction:1,harvesting:4});s.worker.retrySeconds=.25;updateWork(s.worker,s.construction,s.harvesting,.05);assert.equal(s.worker.harvestJob,null);
 updateWork(s.worker,s.construction,s.harvesting,.25);assert.ok(s.worker.job);
});

test('unavailable preferred work falls back to the other task',()=>{
 const s=scene({construction:4,harvesting:1});s.node.collect=false;updateWork(s.worker,s.construction,s.harvesting,0);assert.ok(s.worker.job);
 const t=scene({construction:1,harvesting:4});t.plan.state='completed';updateWork(t.worker,t.construction,t.harvesting,0);assert.ok(t.worker.harvestJob);
});

test('an overlapping object is cleared before construction even when construction has the higher priority',()=>{
 const walls=new Walls(8),items=[];const node={type:'tree',column:3,row:2,collect:true,collected:false,workSeconds:0};const plan=walls.plan(node,'wood');plan.delivered=10;
 const construction=new Construction(walls,items,t=>walls.complete(t),()=>!node.collected);const harvesting=new Harvesting([node],items,walls);
 const worker={movement:createMovement({column:2,row:2}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,priorities:{construction:1,harvesting:4}};
 updateWork(worker,construction,harvesting,0);assert.equal(worker.job,null);assert.ok(worker.harvestJob);
 updateWork(worker,construction,harvesting,3.9);assert.equal(node.collected,false);assert.equal(plan.workSeconds,0);
 updateWork(worker,construction,harvesting,.2);assert.equal(node.collected,true);assert.equal(plan.workSeconds,0);
 updateWork(worker,construction,harvesting,0);assert.ok(worker.job);updateWork(worker,construction,harvesting,1);assert.equal(plan.state,'completed');
});

test('free behavior waits five seconds and chooses a different nearby reachable destination',()=>{
 const s=scene({construction:3,harvesting:3,free:1});
 updateWork(s.worker,s.construction,s.harvesting,4.9,()=>0);assert.equal(currentAction(s.worker),'自由');assert.deepEqual(s.worker.movement.destination,s.worker.movement.tile);
 updateWork(s.worker,s.construction,s.harvesting,.1,()=>0);assert.notDeepEqual(s.worker.movement.destination,s.worker.movement.tile);
 assert.ok(Math.abs(s.worker.movement.destination.column-2)<=3&&Math.abs(s.worker.movement.destination.row-2)<=3);
 assert.equal(s.worker.job,null);assert.equal(s.worker.harvestJob,null);
});

test('free destinations avoid walls and completed barricades',()=>{
 const s=scene({construction:3,harvesting:3,free:1});
 for(let r=0;r<6;r++)for(let c=0;c<6;c++){if(c===2&&r===2||c===3&&r===2||c===3&&r===3)continue;const item=s.construction.walls.plan({column:c,row:r},'wood',(c+r)%2?'wall':'barricade');s.construction.walls.complete(item);}
 updateWork(s.worker,s.construction,s.harvesting,5,()=>.9);const goal=s.worker.movement.destination;
 assert.equal(s.construction.walls.isBlocked(goal),false);assert.equal(s.construction.walls.cannotStop(goal),false);
});

test('current action distinguishes construction, gathering, free and drafted modes',()=>{
 const s=scene({construction:1,harvesting:3,free:4});updateWork(s.worker,s.construction,s.harvesting,0);assert.equal(currentAction(s.worker),'建築中');
 s.worker.priorities={construction:4,harvesting:1,free:3};updateWork(s.worker,s.construction,s.harvesting,0);assert.equal(currentAction(s.worker),'収集中');
 s.worker.priorities={construction:4,harvesting:3,free:1};updateWork(s.worker,s.construction,s.harvesting,0);assert.equal(currentAction(s.worker),'自由');
 s.worker.mode='drafted';updateWork(s.worker,s.construction,s.harvesting,10);assert.equal(currentAction(s.worker),'徴兵');assert.equal(s.worker.freeSeconds,0);
});

test('free timers use elapsed wall-clock time even when animation time is capped',()=>{
 const s=scene({construction:3,harvesting:3,free:1});
 updateWork(s.worker,s.construction,s.harvesting,.1,()=>0,5);
 assert.notDeepEqual(s.worker.movement.destination,s.worker.movement.tile);
});

test('right-click priority rotation wraps in reverse',()=>{
 let value=1;const seen=[];for(let i=0;i<5;i++){seen.push(value);value=nextPriority(value,-1);}assert.deepEqual(seen,[1,4,3,2,1]);
});
