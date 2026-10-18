import {performance} from 'node:perf_hooks';
import {Walls} from '../src/walls.ts';
import {Construction} from '../src/construction.ts';
import {Harvesting} from '../src/harvesting.ts';
import {Hauling} from '../src/hauling.ts';
import {Storage} from '../src/storage.ts';
import {Combat} from '../src/combat.ts';
import {Hunting} from '../src/hunting.ts';
import {createDeer} from '../src/wildlife.ts';
import {createMovement} from '../src/movement.ts';
import {advancePathMovement} from '../src/pathfinding.ts';
import {updateWork} from '../src/work-priorities.ts';
import {PathSearchSchedule} from '../src/path-schedule.ts';
// Deterministic CPU-only comparison: moving prey and prey screened by walls.
for(const scenario of ['moving','screened'])for(const count of [10,30]){
const walls=new Walls(128),items=[],construction=new Construction(walls,items,t=>walls.complete(t)),harvest=new Harvesting([],items,walls),haul=new Hauling(items,new Storage(walls)),combat=new Combat(construction,harvest,haul,()=>.999),animals=[createDeer({column:110,row:60},1)],hunting=new Hunting(combat,()=>animals),schedule=new PathSearchSchedule();
if(scenario==='screened')for(let row=59;row<=61;row++)for(let column=109;column<=111;column++)if(column!==110||row!==60)walls.complete(walls.plan({column,row},'wood','wall'));
animals[0].hunt=true;
const workers=Array.from({length:count},(_,i)=>({movement:createMovement({column:15+i%6,row:50+Math.floor(i/6)}),kind:'human',faction:'player',mode:'automatic',weapon:'rifle',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,needs:{satiety:100},hp:100,eatJob:null,priorities:{nursing:4,construction:4,harvesting:4,hauling:4,butchery:4,cooking:4,hunting:1,free:4}}));
let approachCalls=0,fireChecks=0;const approach=combat.attackApproach.bind(combat),fire=combat.canFireFrom.bind(combat);combat.attackApproach=(...args)=>{approachCalls++;return approach(...args)};combat.canFireFrom=(...args)=>{fireChecks++;return fire(...args)};
const start=performance.now(),ticks=[];for(let step=0;step<(scenario==='screened'?120:360);step++){const t=performance.now();schedule.advance();if(scenario==='moving')animals[0].movement.tile={column:110,row:60+Math.floor(step/30)%8};for(const w of workers){schedule.assign(w.movement);updateWork(w,construction,harvest,1/60,()=>.5,1/60,haul,undefined,undefined,hunting);advancePathMovement(w.movement,1/60,128,walls.isBlocked,walls.cannotStop);}ticks.push(performance.now()-t);}
ticks.sort((a,b)=>a-b);console.log(JSON.stringify({scenario,count,ms:Math.round(performance.now()-start),maxTickMs:+ticks.at(-1).toFixed(2),p95TickMs:+ticks[Math.floor(ticks.length*.95)].toFixed(2),approachCalls,fireChecks,hunting:workers.filter(w=>w.attackJob?.hunting).length}));
}
