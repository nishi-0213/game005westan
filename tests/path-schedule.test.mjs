import test from 'node:test';
import assert from 'node:assert/strict';
import {PathSearchSchedule,canPlan} from '../src/path-schedule.ts';
import {createMovement} from '../src/movement.ts';
import {Walls} from '../src/walls.ts';
import {Construction} from '../src/construction.ts';
import {Harvesting} from '../src/harvesting.ts';
import {Storage} from '../src/storage.ts';
import {Hauling} from '../src/hauling.ts';
import {initialNeeds,updateNeeds,requestEat} from '../src/needs.ts';

test('100 stable pawn slots spread searches over60 steps, surviving removal and new arrivals',()=>{
 const schedule=new PathSearchSchedule(),movements=Array.from({length:100},()=>createMovement({column:0,row:0})),counts=new Array(100).fill(0);
 for(let frame=0;frame<120;frame++){
  schedule.advance();for(let id=0;id<100;id++){
   if(frame>=60&&id===2)continue;
   schedule.assign(movements[id]);assert.equal(canPlan(movements[id]),frame%60===id%60);if(canPlan(movements[id]))counts[id]++;
  }
 }
 assert.equal(counts[2],1);assert.equal(counts[5],2);assert.equal(counts[65],2);
 const newcomer=createMovement({column:1,row:1});
 for(let frame=120;frame<=160;frame++){schedule.advance();schedule.assign(newcomer);assert.equal(canPlan(newcomer),frame%60===100%60);}
});

test('failed food searches wait for the next slot while needs advance; manual food orders bypass the wait',()=>{
 const walls=new Walls(10),items=[{column:8,row:8,type:'ration',quantity:40,collect:true}],construction=new Construction(walls,items,t=>walls.complete(t)),storage=new Storage(walls),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,storage);construction.storage=storage;
 const worker={movement:createMovement({column:1,row:1}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,eatJob:null,needs:initialNeeds(),hp:100};worker.needs.satiety=10;
 for(let row=0;row<10;row++){const wall=walls.plan({column:4,row},'wood');walls.complete(wall);}
 let searches=0;const approach=construction.sourceApproach.bind(construction);construction.sourceApproach=(...args)=>{searches++;return approach(...args);};
 const schedule=new PathSearchSchedule();for(let id=0;id<5;id++)schedule.assign(createMovement({column:id,row:0}));
 for(let frame=0;frame<120;frame++){schedule.advance();schedule.assign(worker.movement);updateNeeds(worker,construction,harvesting,hauling,1/60);}
 assert.equal(searches,2);assert.ok(Math.abs(worker.needs.satiety-8)<1e-8);assert.equal(worker.eatJob,null);
 worker.movement.planningAllowed=false;const nearby={column:2,row:1,type:'strawberry',quantity:10,collect:false};items.push(nearby);
 assert.equal(requestEat(worker,nearby,construction,harvesting,hauling),true);assert.ok(worker.eatJob.manual);
});

test('ongoing movement and construction continue between planning slots',async()=>{
 const {advancePathMovement}=await import('../src/pathfinding.ts');const {setRoute}=await import('../src/movement.ts');const {updateWork}=await import('../src/work-priorities.ts');
 const movement=createMovement({column:0,row:0});setRoute(movement,[{column:1,row:0},{column:2,row:0},{column:3,row:0}]);movement.planningAllowed=false;
 const walls=new Walls(8);advancePathMovement(movement,.5,8,walls.isBlocked,walls.cannotStop);assert.deepEqual(movement.tile,{column:2,row:0});
 const construction=new Construction(walls,[],t=>walls.complete(t)),harvesting=new Harvesting([],[],walls),target=walls.plan({column:2,row:1},'wood');target.delivered=10;
 const worker={movement:createMovement({column:1,row:1}),mode:'automatic',inventory:null,job:{target,phase:'build',goal:{column:1,row:1}},retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,workTask:'build',decisionSeconds:0,priorities:{construction:1,harvesting:3,hauling:3,free:4}};worker.movement.planningAllowed=false;construction.claims.set(target,worker);
 for(let i=0;i<60;i++)updateWork(worker,construction,harvesting,1/60);
 assert.equal(target.state,'completed');
});
