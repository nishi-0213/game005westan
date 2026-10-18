import test from 'node:test';import assert from 'node:assert/strict';
import {Hunting} from '../src/hunting.ts';import {Combat} from '../src/combat.ts';import {Walls} from '../src/walls.ts';import {Construction} from './helpers/construction.mjs';import {Storage} from '../src/storage.ts';import {Hauling} from '../src/hauling.ts';import {Harvesting} from '../src/harvesting.ts';import {createMovement} from '../src/movement.ts';import {advancePathMovement} from '../src/pathfinding.ts';import {createDeer,createWolf} from '../src/wildlife.ts';import {initialNeeds} from '../src/needs.ts';import {INITIAL_PRIORITIES,updateWork} from '../src/work-priorities.ts';
const tile=(column,row)=>({column,row});
function scene(size=32){const walls=new Walls(size),items=[],construction=new Construction(walls,items,t=>walls.complete(t)),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,new Storage(walls)),combat=new Combat(construction,harvesting,hauling,()=>0),deer=[createDeer(tile(20,15),1),createDeer(tile(18,15),2),createDeer(tile(16,15),3)],hunting=new Hunting(combat,()=>deer);
const worker={movement:createMovement(tile(15,15)),faction:'player',mode:'automatic',weapon:'knife',hp:100,needs:initialNeeds(),eatJob:null,inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,priorities:{...INITIAL_PRIORITIES[0],hunting:1}};
const tick=(seconds=.1)=>{updateWork(worker,construction,harvesting,seconds,()=>0,seconds,hauling,undefined,undefined,hunting);advancePathMovement(worker.movement,seconds,32,walls.isBlocked,walls.cannotStop);};return{walls,items,construction,harvesting,hauling,combat,deer,hunting,worker,tick};}
test('hunters pursue the closest marked deer until dead and acquire its body; unmarked deer stay untouched',()=>{
const s=scene();s.deer[0].hunt=true;s.deer[1].hunt=true;s.tick();assert.equal(s.worker.attackJob.target,s.deer[1]);assert.equal(s.worker.attackJob.hunting,true);
s.deer[1].movement.tile=tile(22,15);s.deer[1].movement.destination=tile(22,15);for(let i=0;i<100&&!s.deer[1].dead;i++)s.tick();assert.equal(s.deer[1].dead,true);assert.equal(s.deer[1].collectCorpse,true);assert.equal(s.deer[1].hunt,false);assert.equal(s.deer[2].hp,100);
});
test('unchecked targets, drafting and higher priority work interrupt hunting',()=>{
for(const change of ['uncheck','draft','free']){const s=scene();s.deer[1].hunt=true;s.tick();assert.ok(s.worker.attackJob?.hunting);
if(change==='uncheck')s.deer[1].hunt=false;if(change==='draft')s.worker.mode='drafted';if(change==='free'){s.worker.priorities.hunting=4;s.worker.priorities.free=1;}s.tick(.3);assert.equal(s.worker.attackJob,null);assert.equal(s.deer[1].hp,100);}
});
test('hunting skips unreachable targets and respects nonplayer doors in combat pursuit',()=>{
const s=scene();for(let row=0;row<32;row++){const wall=s.walls.plan(tile(17,row),'wood',row===15?'door':'wall');s.walls.complete(wall);}s.deer[1].hunt=true;
s.worker.faction='enemy1';assert.equal(s.hunting.hasAvailableWork(s.worker),false);assert.equal(s.combat.canReachAttack(s.worker,s.deer[1]),false);
s.worker.faction='player';assert.equal(s.hunting.hasAvailableWork(s.worker),true);
});
test('marked wolves are also valid automatic hunting targets',()=>{
 const s=scene();s.deer[0]=createWolf(tile(20,15),4);s.deer[0].hunt=true;s.tick();assert.ok(s.worker.attackJob?.hunting);assert.equal(s.worker.attackJob.target,s.deer[0]);
});
test('large-map hunters reuse the reachability route when beginning a hunt and share shooting-position candidates',()=>{
 const s=scene(128),target=s.deer[0];target.movement=createMovement(tile(80,80));target.hunt=true;s.worker.weapon='rifle';s.worker.movement=createMovement(tile(10,10));
 let calls=0;const approach=s.combat.attackApproach.bind(s.combat);s.combat.attackApproach=(...args)=>{calls++;return approach(...args)};
 assert.equal(s.hunting.hasAvailableWork(s.worker),true);s.hunting.update(s.worker,0);assert.equal(calls,1);assert.equal(s.worker.attackJob.target,target);
 const cached=s.combat.approachCandidates.get(target).get('rifle').candidates;
 const other={...s.worker,movement:createMovement(tile(11,10)),attackJob:null};assert.equal(s.combat.canReachAttack(other,target),true);assert.equal(s.combat.requestHunt(other,target),true);assert.equal(calls,2);assert.equal(s.combat.approachCandidates.get(target).get('rifle').candidates,cached);
 target.movement.tile=tile(81,80);assert.equal(s.combat.canReachAttack(other,target),true);assert.notEqual(s.combat.approachCandidates.get(target).get('rifle').candidates,cached);
 const moved=s.combat.approachCandidates.get(target).get('rifle').candidates;s.walls.complete(s.walls.plan(tile(50,50),'wood'));assert.equal(s.combat.canReachAttack(other,target),true);assert.notEqual(s.combat.approachCandidates.get(target).get('rifle').candidates,moved);
});
test('many rifle hunters reject fully screened prey without scanning firing positions for each pawn and notice an opened wall',()=>{
 const s=scene(128),target=s.deer[0];target.movement=createMovement(tile(80,80));target.hunt=true;
 for(let row=79;row<=81;row++)for(let column=79;column<=81;column++)if(column!==80||row!==80)s.walls.complete(s.walls.plan(tile(column,row),'wood'));
 let checks=0;const fire=s.combat.canFireFrom.bind(s.combat);s.combat.canFireFrom=(...args)=>{checks++;return fire(...args)};
 for(let i=0;i<30;i++){const worker={...s.worker,weapon:'rifle',movement:createMovement(tile(10+i,10))};assert.equal(s.hunting.hasAvailableWork(worker),false);}
 assert.equal(checks,30);s.walls.erase(s.walls.at(tile(79,80)));s.worker.weapon='rifle';s.worker.movement=createMovement(tile(10,80));assert.equal(s.hunting.hasAvailableWork(s.worker),true);
});
test('cached hunt paths respect new reservations and a moving prey retains a still-valid route',()=>{
 const s=scene(128),target=s.deer[0];target.movement=createMovement(tile(80,60));target.hunt=true;s.worker.weapon='rifle';s.worker.movement=createMovement(tile(10,60));
 assert.equal(s.combat.canReachAttack(s.worker,target),true);s.worker.movement.stopBlocked=()=>true;assert.equal(s.combat.requestHunt(s.worker,target),false);delete s.worker.movement.stopBlocked;
 assert.equal(s.combat.requestHunt(s.worker,target),true);const job=s.worker.attackJob,route=s.worker.movement.route;target.movement.tile=tile(79,60);job.retrySeconds=0;
 const approach=s.combat.attackApproach.bind(s.combat);let calls=0;s.combat.attackApproach=(...args)=>{calls++;return approach(...args)};
 s.combat.update(s.worker,.3);assert.equal(calls,0);assert.equal(s.worker.movement.route,route);assert.equal(job.targetPosition,'79,60');
 target.movement.tile=tile(81,60);job.retrySeconds=0;s.combat.update(s.worker,.3);assert.equal(calls,1);
});
