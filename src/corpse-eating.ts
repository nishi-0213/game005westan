import type { EatingWorker } from './needs';
import { requestEat } from './needs.ts';
import type { Construction } from './construction';
import type { Harvesting } from './harvesting';
import type { Hauling } from './hauling';
import type { Corpse } from './butchery';
import {corpseItemType} from './butchery.ts';
import type {MapItem} from './items';
import {returnItems} from './items.ts';
import {stopAtNextSafeTile} from './movement.ts';
import {rayTiles} from './shooting.ts';
import {findPaths} from './pathfinding.ts';

export class CorpseEating {
  readonly construction:Construction;readonly harvesting:Harvesting;readonly hauling:Hauling;readonly corpses:()=>readonly Corpse[];
  readonly claims=new Map<Corpse,{worker:EatingWorker;source:MapItem}>();
  onConsume?:(corpse:Corpse)=>void;
  isReserved?:(corpse:Corpse)=>boolean;
  constructor(construction:Construction,harvesting:Harvesting,hauling:Hauling,corpses:()=>readonly Corpse[]){this.construction=construction;this.harvesting=harvesting;this.hauling=hauling;this.corpses=corpses;}
  private reachabilitySeconds=0;
  updateClaims(seconds=0):void {
    this.reachabilitySeconds-=seconds;
    if(seconds>0&&this.reachabilitySeconds<=0){
      this.reachabilitySeconds=.25;
      for(const [corpse,{worker}]of this.claims)if(!this.approach(worker,corpse)){
        worker.eatJob=null;
        stopAtNextSafeTile(worker.movement,this.construction.walls.cannotStop);
      }
    }
    for(const [corpse,{worker,source}]of this.claims)if(worker.dead||worker.eatJob?.source!==source||corpse.consumed){corpse.corpseEater=undefined;this.claims.delete(corpse);}
  }
  private eligible(corpse:Corpse,worker:EatingWorker):boolean {
    return corpse!==worker&&Boolean(corpse.dead)&&!corpse.consumed&&!corpse.corpseCarrier&&!corpse.corpseStation&&(!corpse.corpseEater||corpse.corpseEater===worker)&&!this.isReserved?.(corpse);
  }
  private approach(worker:EatingWorker,corpse:Corpse){
    const walls=this.construction.walls,position=corpse.corpseStorage??corpse.movement.tile;
    const paths=findPaths(worker.movement.nextTile??worker.movement.tile,walls.mapSize,walls.isBlocked,walls.cannotStop,worker.movement);
    let best:{goal:{column:number;row:number};distance:number}|null=null;
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(!dc&&!dr)continue;const goal={column:position.column+dc,row:position.row+dr};
      if(goal.column<0||goal.row<0||goal.column>=walls.mapSize||goal.row>=walls.mapSize)continue;
      const blocked=worker.movement.terrainBlocked??walls.isBlocked;
      if(rayTiles(goal,position).slice(1).some(cell=>!(cell.column===position.column&&cell.row===position.row)&&blocked(cell)))continue;
      const path=paths.get(goal.row*walls.mapSize+goal.column);
      if(path&&(!best||path.distance<best.distance))best={goal,distance:path.distance};
    }
    return best;
  }
  canEat(worker:EatingWorker,corpse:Corpse):boolean {this.updateClaims();return !worker.dead&&this.eligible(corpse,worker)&&Boolean(this.approach(worker,corpse));}
  request(worker:EatingWorker,corpse:Corpse,manual=true):boolean {
    this.updateClaims();if(!this.eligible(corpse,worker)||worker.dead)return false;
    const approach=this.approach(worker,corpse);if(!approach)return false;
    const position=corpse.corpseStorage??corpse.movement.tile,type=corpseItemType(corpse);
    const source:MapItem={...approach.goal,type,
      get quantity(){const current=corpse.corpseStorage??corpse.movement.tile;return !corpse.consumed&&!corpse.corpseCarrier&&!corpse.corpseStation&&corpse.corpseEater===worker&&current.column===position.column&&current.row===position.row?1:0;},
      set quantity(value:number){if(value<=0){
        const drop=worker.movement.tile;
        if(corpse.inventory)returnItems(thisEngine.construction.items,drop,corpse.inventory.type,corpse.inventory.quantity);
        if(corpse.weapon&&corpse.weapon!=='unarmed')returnItems(thisEngine.construction.items,drop,corpse.weapon,1);
        thisEngine.hauling.storage.withdrawCorpse(corpse,type);corpse.inventory=null;corpse.weapon='unarmed';corpse.consumed=true;corpse.corpseEater=undefined;thisEngine.claims.delete(corpse);thisEngine.onConsume?.(corpse);
      }},};
    const thisEngine=this;
    // Reserve before requestEat reads the live quantity.
    corpse.corpseEater=worker;
    if(!requestEat(worker,source,this.construction,this.harvesting,this.hauling,manual)){corpse.corpseEater=undefined;return false;}
    worker.eatJob!.manual=manual;this.claims.set(corpse,{worker,source});return true;
  }
  automatic=(worker:EatingWorker):boolean=>{
    if(worker.mode!=='automatic'||worker.dead)return false;this.updateClaims();
    let best:Corpse|null=null,distance=Infinity;
    for(const corpse of this.corpses())if(this.eligible(corpse,worker)){const approach=this.approach(worker,corpse);if(approach&&approach.distance<distance){best=corpse;distance=approach.distance;}}
    return best?this.request(worker,best,false):false;
  };
}
