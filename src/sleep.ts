import { canPlan } from './path-schedule.ts';
import type {EatingWorker} from './needs';
import type {Construction} from './construction';
import type {Wall} from './walls';
import {footprint} from './walls.ts';
import type {Tile} from './movement';
import {setRoute,stopAtNextSafeTile} from './movement.ts';
import {findPaths,findNearest} from './pathfinding.ts';
import {GAME_MINUTES_PER_SECOND} from './game-time.ts';
import {SATIETY_LOSS_PER_SECOND} from './needs.ts';
export interface SleepState {phase:'approach'|'settle'|'sleeping'|'exit';goal:Tile;bed?:Wall;scheduled?:boolean}
export type SleepWorker=EatingWorker & {sleep?:SleepState;sleepRetrySeconds?:number;fleeGoal?:Tile};
export const GROUND_SLEEP_RECOVERY=100/(8*60/GAME_MINUTES_PER_SECOND);
export const BED_SLEEP_RECOVERY=100/(6*60/GAME_MINUTES_PER_SECOND);
const same=(a:Tile,b:Tile)=>a.column===b.column&&a.row===b.row;
const stationary=(p:SleepWorker)=>!p.movement.nextTile&&same(p.movement.tile,p.movement.destination);
export class Sleeping {
  readonly claims=new Map<Wall,SleepWorker>();
  readonly construction:Construction;
  onInterrupt?:(worker:SleepWorker)=>void;
  constructor(construction:Construction){this.construction=construction;}
  private interrupt(p:SleepWorker):void {this.onInterrupt?.(p);p.eatJob=null;p.dropRequested=false;}
  private release(p:SleepWorker):void {if(p.sleep?.bed&&this.claims.get(p.sleep.bed)===p)this.claims.delete(p.sleep.bed);}
  cancel(p:SleepWorker):void {this.release(p);p.sleep=undefined;}
  private floor(p:SleepWorker):void {
    this.release(p);this.interrupt(p);stopAtNextSafeTile(p.movement,this.construction.walls.cannotStop);
    p.sleep={phase:stationary(p)?'sleeping':'settle',goal:{...p.movement.destination}};
  }
  private nearestBed(p:SleepWorker){
    const walls=this.construction.walls;
    const beds=[...walls.items.values()].filter(b=>b.kind==='bed'&&b.state==='completed'&&!this.claims.has(b)&&!footprint(b).some(t=>p.movement.stopBlocked?.(t)));
    if(!beds.length)return null;
    const candidates=[];
    for(const bed of beds)for(const cell of footprint(bed))for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(!dc&&!dr)continue;const goal={column:cell.column+dc,row:cell.row+dr};
      if(walls.at(goal)!==bed)candidates.push({target:bed,goal});
    }
    const nearest=findNearest(p.movement.nextTile??p.movement.tile,walls.mapSize,walls.isBlocked,walls.cannotStop,candidates,p.movement);
    return nearest?{bed:nearest.target,goal:nearest.goal,tiles:nearest.path.tiles,distance:nearest.path.distance}:null;
  }

  private exit(p:SleepWorker):boolean {
    if(!canPlan(p.movement))return false;
    const walls=this.construction.walls;
    const paths=findPaths(p.movement.tile,walls.mapSize,walls.isBlocked,walls.cannotStop,p.movement);
    for(const path of paths.values())if(setRoute(p.movement,path.tiles)){
      this.release(p);p.sleep={phase:'exit',goal:{...p.movement.destination}};return true;
    }
    return false;
  }
  update(p:SleepWorker,seconds:number,useBeds:boolean,scheduled=false):boolean {
    if(p.dead){this.cancel(p);return false;}
    const elapsed=Math.max(0,seconds),walls=this.construction.walls;
    // An exhausted pawn must be able to reach safety before collapsing again.
    if(p.fleeGoal){p.needs.wakefulness=Math.max(0,(p.needs.wakefulness??100)-elapsed*SATIETY_LOSS_PER_SECOND);return false;}
    const forced=scheduled&&p.mode==='automatic';
    let state=p.sleep;
    if(state?.scheduled&&!forced&&!p.receivingNursing){
      if(state.bed&&state.phase==='sleeping'){this.exit(p);return true;}
      this.cancel(p);stopAtNextSafeTile(p.movement,walls.cannotStop);state=undefined;
    }
    if(forced&&state)state.scheduled=true;
    if(state?.bed&&(state.bed.state!=='completed'||walls.at(state.bed)!==state.bed)){
      this.release(p);
      if(state.phase==='sleeping')state.bed=undefined;
      else{p.sleep=undefined;state=undefined;p.sleepRetrySeconds=0;stopAtNextSafeTile(p.movement,walls.cannotStop);}
    }
    if(state?.phase==='exit'){
      if(stationary(p))p.sleep=undefined;
      return Boolean(p.sleep);
    }
    if(state?.phase==='sleeping'){
      p.needs.wakefulness=Math.min(100,(p.needs.wakefulness??100)+elapsed*(state.bed?BED_SLEEP_RECOVERY:GROUND_SLEEP_RECOVERY));
      if(p.needs.wakefulness>=100-1e-9&&!forced){
        p.needs.wakefulness=100;
        if(p.receivingNursing)return true;
        if(state.bed){this.exit(p);}else p.sleep=undefined;
      }
      return true;
    }
    p.needs.wakefulness=Math.max(0,(p.needs.wakefulness??100)-elapsed*SATIETY_LOSS_PER_SECOND);
    if(p.needs.wakefulness<=0){if(state?.phase!=='settle')this.floor(p);state=p.sleep;}
    // The first tick of an immediate collapse must also suspend the caller's AI.
    if(state?.phase==='sleeping'){if(forced)state.scheduled=true;return true;}
    if(state?.phase==='settle'){
      if(stationary(p))state.phase='sleeping';
      return true;
    }
    if(state?.phase==='approach'){
      if(p.mode==='drafted'||!same(p.movement.destination,state.goal)){this.cancel(p);if(p.mode==='drafted')stopAtNextSafeTile(p.movement,walls.cannotStop);return false;}
      if(!stationary(p))return true;
      if(!same(p.movement.tile,state.goal)){this.cancel(p);return false;}
      const cells=footprint(state.bed!);cells.sort((a,b)=>Math.hypot(a.column-p.movement.tile.column,a.row-p.movement.tile.row)-Math.hypot(b.column-p.movement.tile.column,b.row-p.movement.tile.row));
      const tile=cells[0],m=p.movement;
      m.tile={...tile};m.destination={...tile};m.nextTile=null;m.route=[];m.progress=0;m.changed?.();state.phase='sleeping';return true;
    }
    if(useBeds&&p.mode==='automatic'&&(forced||(p.needs.wakefulness??100)<20)){
      p.sleepRetrySeconds=(p.sleepRetrySeconds??0)-elapsed;
      if(p.sleepRetrySeconds<=0&&canPlan(p.movement)){p.sleepRetrySeconds=.25;const bed=this.nearestBed(p);if(bed){
        this.interrupt(p);this.claims.set(bed.bed,p);p.sleep={phase:'approach',goal:bed.goal,bed:bed.bed,scheduled:forced};setRoute(p.movement,bed.tiles);return true;
      }
      if(forced){this.floor(p);p.sleep!.scheduled=true;return true;}
      }
    }
    return forced;
  }
}
