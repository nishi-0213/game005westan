import type { Builder, Construction } from './construction';
import type { Harvesting } from './harvesting';
import type { Hauling } from './hauling';
import type { BodyCondition } from './body-conditions';
import type { Health } from './health';
import type { Tile } from './movement';
import { setRoute, stopAtNextSafeTile } from './movement.ts';
import { findNearest } from './pathfinding.ts';
import { canPlan } from './path-schedule.ts';
import { canGiveOrders } from './mood.ts';
export const NURSING_SECONDS=2;
export type NursingActor=Builder & Health & {kind?:string;faction?:string;conditions?:BodyCondition[];needs?:{happiness?:number};decisionSeconds?:number;workTask?:string};
export interface NursingJob {patient:NursingActor;condition:BodyCondition;seconds:number;manual:boolean;goal:Tile}
const bleeding=(p:NursingActor)=>(p.conditions??[]).filter(c=>c.kind==='bleeding'&&c.seconds>0);
const urgency=(c:BodyCondition)=>c.part==='head'||c.part==='torso'?0:1;
export class Nursing {
  readonly claims=new Map<NursingActor,NursingActor>();
  onInterrupt?:(worker:NursingActor)=>void;
  readonly construction:Construction;readonly harvesting:Harvesting;readonly hauling:Hauling;readonly patients:()=>readonly NursingActor[];
  constructor(construction:Construction,harvesting:Harvesting,hauling:Hauling,patients:()=>readonly NursingActor[]){this.construction=construction;this.harvesting=harvesting;this.hauling=hauling;this.patients=patients;}
  private eligible(worker:NursingActor,patient:NursingActor):boolean {
    return !worker.dead&&!patient.dead&&patient.kind==='human'&&(patient.faction??'player')===(worker.faction??'player')&&bleeding(patient).length>0&&(!this.claims.has(patient)||this.claims.get(patient)===worker);
  }
  private approach(worker:NursingActor,patient:NursingActor){
    const from=worker.movement.nextTile??worker.movement.tile,walls=this.construction.walls;
    if(worker===patient)return {goal:{...from},path:{tiles:[],distance:0}};
    const candidates=[];
    const center=patient.movement.tile;
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(!dc&&!dr)continue;
      const goal={column:center.column+dc,row:center.row+dr};
      const blocked=worker.movement.terrainBlocked??walls.isBlocked;
      if(dc&&dr&&(blocked({column:center.column,row:goal.row})||blocked({column:goal.column,row:center.row})))continue;
      candidates.push({target:patient,goal});
    }
    return findNearest(from,walls.mapSize,walls.isBlocked,walls.cannotStop,candidates,worker.movement);
  }
  findWork(worker:NursingActor){
    if(worker.dead||worker.mode!=='automatic'||!canPlan(worker.movement))return null;
    const patients=this.patients().filter(p=>this.eligible(worker,p)).sort((a,b)=>Math.min(...bleeding(a).map(urgency))-Math.min(...bleeding(b).map(urgency)));
    let best:{patient:NursingActor;goal:Tile;path:{tiles:Tile[];distance:number};priority:number}|null=null;
    for(const patient of patients){
      const priority=Math.min(...bleeding(patient).map(urgency));if(best&&priority>best.priority)break;
      const approach=this.approach(worker,patient);if(approach&&(!best||approach.path.distance<best.path.distance))best={patient,...approach,priority};
    }
    return best;
  }
  cancel(worker:NursingActor):void {
    const job=worker.nurseJob;if(!job)return;
    if(this.claims.get(job.patient)===worker)this.claims.delete(job.patient);
    worker.nurseJob=null;worker.decisionSeconds=0;if(worker.workTask==='nurse')worker.workTask=undefined;
    stopAtNextSafeTile(worker.movement,this.construction.walls.cannotStop);
  }
  canRequest(worker:NursingActor,patient:NursingActor):boolean {
    return worker.mode==='automatic'&&canGiveOrders(worker)&&this.eligible(worker,patient)&&Boolean(this.approach(worker,patient));
  }
  request(worker:NursingActor,patient:NursingActor):boolean {
    if(!this.canRequest(worker,patient))return false;
    return this.start(worker,patient,true);
  }
  private start(worker:NursingActor,patient:NursingActor,manual:boolean):boolean {
    const approach=this.approach(worker,patient);if(!approach)return false;
    this.cancel(worker);this.onInterrupt?.(worker);
    this.harvesting.cancel(worker as Parameters<Harvesting['cancel']>[0]);this.hauling.cancel(worker as Parameters<Hauling['cancel']>[0]);this.construction.cancel(worker);
    const condition=bleeding(patient).sort((a,b)=>urgency(a)-urgency(b))[0];if(!condition)return false;
    this.claims.set(patient,worker);worker.nurseJob={patient,condition,manual,seconds:0,goal:approach.goal};worker.workTask='nurse';
    if(worker!==patient)setRoute(worker.movement,approach.path.tiles);
    else stopAtNextSafeTile(worker.movement,this.construction.walls.cannotStop);
    return true;
  }
  update(worker:NursingActor,seconds:number):void {
    if(worker.dead||worker.mode!=='automatic'||worker.sleep||worker.dropRequested){this.cancel(worker);return;}
    if(!worker.nurseJob){const work=this.findWork(worker);if(!work||!this.start(worker,work.patient,false))return;}
    const job=worker.nurseJob!;
    if(!this.eligible(worker,job.patient)||this.claims.get(job.patient)!==worker){this.cancel(worker);return;}
    if(!job.patient.conditions?.includes(job.condition)||job.condition.seconds<=0){
      const next=bleeding(job.patient).sort((a,b)=>urgency(a)-urgency(b))[0];if(!next){this.cancel(worker);return;}job.condition=next;job.seconds=0;
    }
    const from=worker.movement.tile,to=job.patient.movement.tile;
    const blocked=worker.movement.terrainBlocked??this.construction.walls.isBlocked;
    const dx=Math.abs(from.column-to.column),dy=Math.abs(from.row-to.row);
    const adjacent=worker===job.patient||Math.max(dx,dy)===1&&(!dx||!dy||!blocked({column:from.column,row:to.row})&&!blocked({column:to.column,row:from.row}));
    if(!adjacent){
      job.seconds=0;
      if(canPlan(worker.movement)&&!worker.movement.nextTile){const approach=this.approach(worker,job.patient);if(!approach){this.cancel(worker);return;}job.goal=approach.goal;setRoute(worker.movement,approach.path.tiles);}
      return;
    }
    if(worker.movement.nextTile||from.column!==worker.movement.destination.column||from.row!==worker.movement.destination.row)return;
    job.seconds+=Math.max(0,seconds);
    if(job.seconds+1e-9<NURSING_SECONDS)return;
    job.patient.conditions=job.patient.conditions!.filter(c=>c!==job.condition);
    const next=bleeding(job.patient).sort((a,b)=>urgency(a)-urgency(b))[0];
    if(next){job.condition=next;job.seconds=0;}else this.cancel(worker);
  }
}
