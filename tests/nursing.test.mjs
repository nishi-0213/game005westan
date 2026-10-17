import test from 'node:test';
import assert from 'node:assert/strict';
import {Nursing,NURSING_SECONDS,isNursing} from '../src/nursing.ts';
import {Walls} from '../src/walls.ts';
import {Construction} from '../src/construction.ts';
import {Harvesting} from '../src/harvesting.ts';
import {Hauling} from '../src/hauling.ts';
import {Storage} from '../src/storage.ts';
import {createMovement} from '../src/movement.ts';
import {advancePathMovement} from '../src/pathfinding.ts';
import {initialBodyHp} from '../src/health.ts';
import {addCondition,updateConditions,conditionRemaining} from '../src/body-conditions.ts';
import {updateWork,INITIAL_PRIORITIES,currentAction} from '../src/work-priorities.ts';
import {updateMood} from '../src/mood.ts';
function scene(){
 const walls=new Walls(16),items=[],construction=new Construction(walls,items,t=>walls.complete(t)),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,new Storage(walls)),patients=[];
 const nursing=new Nursing(construction,harvesting,hauling,()=>patients);
 const pawn=(column,row)=>{const p={kind:'human',faction:'player',movement:createMovement({column,row}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,needs:{satiety:100,happiness:50},bodyHp:initialBodyHp(),priorities:{...INITIAL_PRIORITIES[0]},eatJob:null};patients.push(p);return p;};
 const move=(p,seconds)=>advancePathMovement(p.movement,seconds,16,walls.isBlocked,walls.cannotStop);
 return {walls,construction,harvesting,hauling,nursing,pawn,move};
}
test('manual nursing treats one bleeding condition per30game minutes, vital parts first, leaving bruises and HP unchanged',()=>{
 const s=scene(),n=s.pawn(2,2),p=s.pawn(3,2);addCondition(p,'bleeding','arms');addCondition(p,'bruise','torso');addCondition(p,'bleeding','head');updateMood(p,0);
 assert.equal(s.nursing.request(n,p),true);assert.equal(n.nurseJob.manual,true);assert.equal(n.nurseJob.condition.part,'head');assert.equal(s.nursing.claims.get(p),n);
 s.nursing.update(n,NURSING_SECONDS-.01);assert.equal(p.conditions.length,3);assert.equal(currentAction(n),'看護');assert.equal(isNursing(n),true);s.nursing.update(n,.01);assert.equal(p.conditions.length,2);assert.equal(n.nurseJob.condition.part,'arms');assert.equal(currentAction(n),'看護へ移動中');
 s.nursing.update(n,NURSING_SECONDS);assert.deepEqual(p.conditions.map(c=>c.kind),['bruise']);assert.equal(n.nurseJob,null);assert.equal(s.nursing.claims.size,0);assert.deepEqual(p.bodyHp,initialBodyHp());updateMood(p,0);assert.equal(p.needs.happiness,40);
});
test('self nursing works manually and automatically and prevents duplicate nurses from reserving the same patient',()=>{
 for(const manual of [true,false]){const s=scene(),p=s.pawn(2,2),other=s.pawn(3,2);addCondition(p,'bleeding','legs');
  if(manual)assert.equal(s.nursing.request(p,p),true);else s.nursing.update(p,0);
  assert.equal(s.nursing.canRequest(other,p),false);s.nursing.update(p,NURSING_SECONDS);assert.deepEqual(p.conditions,[]);assert.equal(p.nurseJob,null);
 }
});
test('nurses walk to a patient before treating and abort when the route or patient is no longer valid',()=>{
 const s=scene(),n=s.pawn(2,2),p=s.pawn(8,2);addCondition(p,'bleeding','torso');assert.equal(s.nursing.request(n,p),true);
 s.nursing.update(n,1);assert.equal(n.nurseJob.seconds,0);s.move(n,2);s.nursing.update(n,1);assert.equal(n.nurseJob.seconds,1);
 p.dead=true;s.nursing.update(n,1);assert.equal(n.nurseJob,null);assert.equal(s.nursing.claims.size,0);
 const t=scene(),a=t.pawn(2,2),b=t.pawn(8,2);addCondition(b,'bleeding','head');for(let row=0;row<16;row++){const w=t.walls.plan({column:5,row},'wood');t.walls.complete(w);}assert.equal(t.nursing.canRequest(a,b),false);
});
test('automatic nursing follows its priority before same-priority work and yields to higher-priority free behavior',()=>{
 const s=scene(),n=s.pawn(2,2),p=s.pawn(3,2);addCondition(p,'bleeding','head');
 const tick=dt=>updateWork(n,s.construction,s.harvesting,dt,()=>.5,dt,s.hauling,undefined,undefined,undefined,undefined,s.nursing);
 tick(.1);assert.equal(n.workTask,'nurse');assert.ok(n.nurseJob);assert.equal(n.freeActive,false);
 n.priorities.free=1;n.priorities.nursing=4;tick(.1);assert.equal(n.nurseJob,null);assert.equal(n.freeActive,true);assert.equal(s.nursing.claims.size,0);
});
test('nursing cancellation releases claims and never treats drafted, dead, sleeping or healthy actors',()=>{
 const s=scene(),n=s.pawn(2,2),p=s.pawn(3,2);assert.equal(s.nursing.request(n,p),false);addCondition(p,'bleeding','head');s.nursing.request(n,p);s.nursing.cancel(n);assert.equal(s.nursing.claims.size,0);
 n.mode='drafted';assert.equal(s.nursing.request(n,p),false);s.nursing.update(n,10);assert.equal(p.conditions.length,1);
 n.mode='automatic';s.nursing.request(n,p);n.sleep={phase:'sleeping'};s.nursing.update(n,10);assert.equal(n.nurseJob,null);assert.equal(p.conditions.length,1);
});
test('bed recovery scales effective remaining duration to0.8 and restores normal scale on leaving, without increasing bleeding damage per hour',()=>{
 const s=scene(),p=s.pawn(2,2);const bed=s.walls.plan({column:6,row:6},'wood','bed');s.walls.complete(bed);
 addCondition(p,'bruise','arms');addCondition(p,'bleeding','torso');const bruise=p.conditions[0],bleed=p.conditions[1],original=bruise.seconds;
 p.sleep={phase:'sleeping',bed};assert.equal(conditionRemaining(p,bruise),original*.8);updateConditions(p,4);assert.equal(p.bodyHp.torso,95);assert.equal(bruise.seconds,original-5);
 p.sleep=undefined;assert.equal(conditionRemaining(p,bruise),original-5);updateConditions(p,4);assert.equal(bruise.seconds,original-9);assert.equal(p.bodyHp.torso,90);
 p.sleep={phase:'sleeping'};assert.equal(conditionRemaining(p,bruise),bruise.seconds);
 p.sleep={phase:'sleeping',bed};bleed.seconds=1;const hp=p.bodyHp.torso;updateConditions(p,4);assert.equal(p.bodyHp.torso,hp-1);assert.equal(p.conditions.includes(bleed),false);
});

test('automatic nursing chooses another patient with vital bleeding before its own limb bleeding',()=>{
 const s=scene(),n=s.pawn(2,2),p=s.pawn(6,2);addCondition(n,'bleeding','arms');addCondition(p,'bleeding','torso');assert.equal(s.nursing.findWork(n).patient,p);
});
