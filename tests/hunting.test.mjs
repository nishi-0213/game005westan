import test from 'node:test';import assert from 'node:assert/strict';
import {Hunting} from '../src/hunting.ts';import {Combat} from '../src/combat.ts';import {Walls} from '../src/walls.ts';import {Construction} from './helpers/construction.mjs';import {Storage} from '../src/storage.ts';import {Hauling} from '../src/hauling.ts';import {Harvesting} from '../src/harvesting.ts';import {createMovement} from '../src/movement.ts';import {advancePathMovement} from '../src/pathfinding.ts';import {createDeer,createWolf} from '../src/wildlife.ts';import {initialNeeds} from '../src/needs.ts';import {INITIAL_PRIORITIES,updateWork} from '../src/work-priorities.ts';
const tile=(column,row)=>({column,row});
function scene(){const walls=new Walls(32),items=[],construction=new Construction(walls,items,t=>walls.complete(t)),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,new Storage(walls)),combat=new Combat(construction,harvesting,hauling,()=>0),deer=[createDeer(tile(20,15),1),createDeer(tile(18,15),2),createDeer(tile(16,15),3)],hunting=new Hunting(combat,()=>deer);
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
