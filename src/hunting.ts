import type { AutonomousWorker } from './work-priorities';
import type { CombatPawn } from './combat';
import { Combat } from './combat.ts';
import type { Deer } from './wildlife';

export class Hunting {
  private choices=new WeakMap<AutonomousWorker,Deer>();
  readonly combat:Combat;
  readonly deer:()=>readonly Deer[];
  constructor(combat:Combat,deer:()=>readonly Deer[]){this.combat=combat;this.deer=deer;}
  private pawn(worker:AutonomousWorker):CombatPawn|null {
    const pawn=worker as AutonomousWorker & Partial<CombatPawn>;
    return pawn.faction==='player'&&!pawn.dead&&pawn.mode==='automatic'?pawn as CombatPawn:null;
  }
  active(worker:AutonomousWorker):boolean { return Boolean((worker as Partial<CombatPawn>).attackJob?.hunting); }
  hasAvailableWork(worker:AutonomousWorker):boolean {
    const pawn=this.pawn(worker);if(!pawn)return false;
    if(pawn.attackJob?.hunting&&!pawn.attackJob.target.dead&&!pawn.attackJob.target.departed&&pawn.attackJob.target.hunt)return true;
    const origin=pawn.movement.nextTile??pawn.movement.tile;
    const targets=this.deer().filter(deer=>deer.hunt&&!deer.dead&&!deer.departed).sort((a,b)=>
      Math.hypot(a.movement.tile.column-origin.column,a.movement.tile.row-origin.row)-Math.hypot(b.movement.tile.column-origin.column,b.movement.tile.row-origin.row));
    const target=targets.find(target=>this.combat.canReachAttack(pawn,target));
    if(target)this.choices.set(worker,target);else this.choices.delete(worker);
    return Boolean(target);
  }
  cancel(worker:AutonomousWorker):void {
    if(this.active(worker)){this.combat.cancel(worker as AutonomousWorker & CombatPawn);worker.decisionSeconds=0;}
    this.choices.delete(worker);
  }
  update(worker:AutonomousWorker,seconds:number):void {
    const pawn=this.pawn(worker);if(!pawn){this.cancel(worker);return;}
    if(!pawn.attackJob?.hunting){
      const target=this.choices.get(worker);
      if(!target||!this.combat.requestHunt(pawn,target)){worker.decisionSeconds=0;return;}
    }
    this.combat.update(pawn,seconds);
    if(!pawn.attackJob)worker.decisionSeconds=0;
  }
}
