import test from 'node:test';
import assert from 'node:assert/strict';
import { Walls } from '../src/walls.ts';
import { Construction } from '../src/construction.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Hauling } from '../src/hauling.ts';
import { Storage } from '../src/storage.ts';
import { createMovement } from '../src/movement.ts';
import { updateWork } from '../src/work-priorities.ts';
function scene(priorities){const walls=new Walls(32),items=[],construction=new Construction(walls,items,t=>walls.complete(t)),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,new Storage(walls));const worker={movement:createMovement({column:15,row:15}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,priorities};const tick=()=>updateWork(worker,construction,harvesting,1/60,()=>0,1/60,hauling);return{construction,harvesting,hauling,worker,tick};}
test('higher-priority free behavior does not explore lower-priority jobs on any frame',()=>{const s=scene({construction:3,harvesting:3,hauling:3,free:1});s.construction.nearestPlan=()=>assert.fail('unnecessary construction exploration');s.harvesting.hasAvailableWork=()=>assert.fail('unnecessary harvesting exploration');s.hauling.hasAvailableWork=()=>assert.fail('unnecessary hauling exploration');for(let i=0;i<120;i++)s.tick();assert.equal(s.worker.freeActive,true);});
test('ordinary idle workers scan jobs at most five times per second and react immediately to changed priorities',()=>{const s=scene({construction:3,harvesting:3,hauling:3,free:3});let scans=0;s.harvesting.hasAvailableWork=()=>{scans++;return false;};for(let i=0;i<60;i++)s.tick();assert.ok(scans<=5);const before=scans;s.worker.priorities.construction=1;s.tick();assert.equal(scans,before+1);});
test('an active preferred harvest advances every frame without exploring other jobs',()=>{const s=scene({construction:3,harvesting:1,hauling:3,free:4});const target={column:16,row:15,type:'tree',collect:true,collected:false,workSeconds:0};s.harvesting.objects.push(target);s.harvesting.update(s.worker,0);s.construction.nearestPlan=()=>assert.fail('unnecessary construction exploration');s.hauling.hasAvailableWork=()=>assert.fail('unnecessary hauling exploration');for(let i=0;i<60;i++)s.tick();assert.ok(Math.abs(target.workSeconds-1)<1e-8);});

test('idle workers with plans but no materials do not explore the map', () => {
  const s = scene({ construction: 3, harvesting: 3, hauling: 3, free: 3 });
  s.construction.storage = s.hauling.storage;
  s.construction.walls.plan({ column: 18, row: 15 }, 'wood');
  s.construction.walls.isBlocked = () => assert.fail('there is no material source to route to');
  for (let i = 0; i < 240; i++) s.tick();
  assert.equal(s.worker.freeActive, true);
  assert.equal(s.worker.job, null);
});

test('preferred active construction skips searches for lower-priority harvest and hauling jobs', () => {
  const s = scene({ construction: 1, harvesting: 3, hauling: 3, free: 4 });
  const plan = s.construction.walls.plan({ column: 16, row: 15 }, 'wood');
  plan.delivered = 10;
  s.construction.update(s.worker, 0);
  s.harvesting.hasAvailableWork = () => assert.fail('unnecessary harvest search');
  s.hauling.hasAvailableWork = () => assert.fail('unnecessary haul search');
  for (let i = 0; i < 30; i++) s.tick();
  assert.ok(Math.abs(plan.workSeconds - .5) < 1e-8);
});
