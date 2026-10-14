import type { Builder, Construction } from './construction';
import type { Hauling } from './hauling';
import type { Wall } from './walls';
import type { MapItem } from './items';
import { carryCapacity, foodNutrition, returnItems } from './items.ts';
import type { Tile } from './movement';
import { setRoute, stopAtNextSafeTile } from './movement.ts';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';

export const COOK_SECONDS=5;
export const COOK_NUTRITION=100;
export const RATION_YIELD=4;
export interface CookingState {
  mode:'count'|'until'|'forever'; remaining:number;target:number;seconds:number;
  meat:number;strawberry:number;
}
export interface CookingJob {station:Wall;phase:'pickup'|'carry'|'process';goal:Tile;source?:MapItem}
const ingredient=(type:string):type is 'meat'|'strawberry'=>type==='meat'||type==='strawberry';
const same=(a:Tile,b:Tile)=>a.column===b.column&&a.row===b.row;
export function stagedNutrition(state:CookingState):number{return state.meat*20+state.strawberry*10;}
export class Cooking {
  readonly claims=new Map<Wall,Builder>();
  readonly construction:Construction;readonly hauling:Hauling;readonly workers:()=>readonly Builder[];
  constructor(construction:Construction,hauling:Hauling,workers:()=>readonly Builder[]){this.construction=construction;this.hauling=hauling;this.workers=workers;}
  rationStock():number {
    return this.construction.items.reduce((n,item)=>n+(item.type==='ration'?item.quantity:0),0)+(this.construction.storage?.totals().ration??0)+this.workers().filter(w=>!w.dead).reduce((n,w)=>n+(w.inventory?.type==='ration'?w.inventory.quantity:0),0);
  }
  wantsWork(station:Wall):boolean {
    const state=station.cooking;
    return station.state==='completed'&&this.construction.walls.at(station)===station&&Boolean(state&&(state.mode==='forever'||state.mode==='count'&&state.remaining>0||state.mode==='until'&&this.rationStock()<state.target));
  }
  private stations(worker:Builder):Wall[]{return [...this.construction.walls.items.values()].filter(s=>s.kind==='cooker'&&this.wantsWork(s)&&(!this.claims.has(s)||this.claims.get(s)===worker));}
  private paths(worker:Builder){const walls=this.construction.walls;return findPaths(worker.movement.nextTile??worker.movement.tile,walls.mapSize,walls.isBlocked,walls.cannotStop,worker.movement);}
  findTransport(worker:Builder):{station:Wall;goal:Tile;path:Path;source?:MapItem}|null {
    const stations=this.stations(worker).filter(s=>stagedNutrition(s.cooking!)<COOK_NUTRITION);
    if(!stations.length)return null;
    const from=worker.movement.nextTile??worker.movement.tile,paths=this.paths(worker);
    const held=worker.inventory;
    const sources=[...this.construction.items.filter(i=>ingredient(i.type)&&i.collect&&i.quantity>0),...(['meat','strawberry'] as const).flatMap(type=>this.construction.storage?.sources(type)??[])];
    let best:{station:Wall;goal:Tile;path:Path;source?:MapItem}|null=null;
    for(const station of stations){
      const approach=this.construction.approach(from,station,paths);if(!approach)continue;
      if(held&&held.quantity>0&&ingredient(held.type)){
        if(!best||approach.path.distance<best.path.distance)best={station,...approach};continue;
      }
      for(const source of sources){
        const reachable=this.construction.sourceApproach(from,source,paths)??(!this.construction.walls.isBlocked(source)?this.hauling.approach(from,source,paths):null);
        if(reachable&&(!best||reachable.path.distance<best.path.distance))best={station,source,...reachable};
      }
    }
    return best;
  }
  findProcessing(worker:Builder):{station:Wall;goal:Tile;path:Path}|null {
    const stations=this.stations(worker).filter(s=>stagedNutrition(s.cooking!)>=COOK_NUTRITION);if(!stations.length)return null;
    const from=worker.movement.nextTile??worker.movement.tile,paths=this.paths(worker);
    let best:{station:Wall;goal:Tile;path:Path}|null=null;
    for(const station of stations){const approach=this.construction.approach(from,station,paths);if(approach&&(!best||approach.path.distance<best.path.distance))best={station,...approach};}return best;
  }
  cancel(worker:Builder):void {
    const job=worker.cookJob;
    if(job&&this.claims.get(job.station)===worker)this.claims.delete(job.station);
    worker.cookJob=null;
    stopAtNextSafeTile(worker.movement,this.construction.walls.cannotStop);
  }
  update(worker:Builder,seconds:number,work:'transport'|'process'):void {
    if(worker.dead||worker.mode!=='automatic'||worker.dropRequested){this.cancel(worker);return;}
    const active=worker.cookJob;
    if(active&&(!this.wantsWork(active.station)||this.claims.get(active.station)!==worker||(work==='process')!==(active.phase==='process'))){this.cancel(worker);return;}
    const m=worker.movement;if(m.nextTile||!same(m.tile,m.destination))return;
    if(!active){
      const found=work==='process'?this.findProcessing(worker):this.findTransport(worker);if(!found)return;
      this.claims.set(found.station,worker);
      const source=(found as {source?:MapItem}).source;
      worker.cookJob={station:found.station,goal:found.goal,source,phase:work==='process'?'process':source?'pickup':'carry'};
      setRoute(m,found.path.tiles);return;
    }
    if(!same(m.tile,active.goal)){this.cancel(worker);return;}
    const state=active.station.cooking!;
    if(active.phase==='pickup'){
      const source=active.source!;
      if(source.quantity<=0||!ingredient(source.type)||!this.construction.storage?.isSource(source)&&!source.collect){this.cancel(worker);return;}
      const approach=this.construction.approach(m.tile,active.station,this.paths(worker));if(!approach){this.cancel(worker);return;}
      if(worker.inventory){returnItems(this.construction.items,m.tile,worker.inventory.type,worker.inventory.quantity);worker.inventory=null;}
      const quantity=Math.min(source.quantity,carryCapacity(worker,source.type),Math.floor((COOK_NUTRITION-stagedNutrition(state))/foodNutrition(source.type)));
      if(quantity<=0){this.cancel(worker);return;}
      source.quantity-=quantity;worker.inventory={type:source.type,quantity};
      active.phase='carry';active.goal=approach.goal;setRoute(m,approach.path.tiles);return;
    }
    if(active.phase==='carry'){
      const held=worker.inventory;if(!held||!ingredient(held.type)){this.cancel(worker);return;}
      const quantity=Math.min(held.quantity,Math.floor((COOK_NUTRITION-stagedNutrition(state))/foodNutrition(held.type)));
      state[held.type]+=quantity;held.quantity-=quantity;if(!held.quantity)worker.inventory=null;
      this.cancel(worker);return;
    }
    if(stagedNutrition(state)<COOK_NUTRITION){this.cancel(worker);return;}
    state.seconds=Math.min(COOK_SECONDS,state.seconds+Math.max(0,seconds));if(state.seconds<COOK_SECONDS-1e-9)return;
    let needed=COOK_NUTRITION;
    for(const type of ['meat','strawberry'] as const){const count=Math.min(state[type],Math.floor(needed/foodNutrition(type)));state[type]-=count;needed-=count*foodNutrition(type);}
    returnItems(this.construction.items,m.tile,'ration',RATION_YIELD);
    this.construction.items.find(i=>i.type==='ration'&&same(i,m.tile))!.collect=true;
    state.seconds=0;if(state.mode==='count')state.remaining=Math.max(0,state.remaining-1);
    this.cancel(worker);
  }
}
