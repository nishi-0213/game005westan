import { initialBodyHp } from './health.ts';
import { canPlan } from './path-schedule.ts';
import type { Combat, CombatTarget, AttackOrder } from './combat';
import type { CorpseEating } from './corpse-eating';
import type { FactionMember } from './factions';
import type { EatingWorker } from './needs';
import { FOOD_THRESHOLD, initialNeeds, updateNeeds } from './needs.ts';
import { createMovement, setRoute, stopAtNextSafeTile } from './movement.ts';
import type { Tile } from './movement';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';
import { updateRoaming } from './roaming.ts';
import type { Construction } from './construction';
import type { Harvesting } from './harvesting';
import type { Hauling } from './hauling';
import type { EnvironmentObject } from './environment';
import { harvestYield } from './environment.ts';
import type { MapItem } from './items';

export interface Animal extends EatingWorker, FactionMember {
  kind: 'deer' | 'wolf';
  combatCommitted?:boolean;
  retaliationProbability?:number;
  attackJob?: AttackOrder | null;
  hunt?: boolean;
  id: number;
  freeSeconds: number;
  leaving: boolean;
  departed: boolean;
  exitGoal?: Tile;
  outsideGoal?: Tile;
  decisionSeconds: number;
  fleeGoal?: Tile;
  attackMotionSeconds?:number;
}
export type Deer=Animal & {kind:'deer'};
export type Wolf=Animal & {kind:'wolf';prey?:CombatTarget;retaliationProbability:number};
export const WOLF_RETALIATION_PROBABILITY=.5;
export function createWolf(tile:Tile,id:number):Wolf {return {...createDeer(tile,id),kind:'wolf',retaliationProbability:WOLF_RETALIATION_PROBABILITY};}
export type FleeingPawn=EatingWorker & FactionMember & {fleeGoal?:Tile;freeSeconds?:number;combatCommitted?:boolean;attackJob?:AttackOrder|null};
export const DEER_FLEE_DISTANCE = 8;
const sameTile = (a: Tile, b: Tile): boolean => a.column === b.column && a.row === b.row;
const deerForage = (object: EnvironmentObject): boolean => object.type === 'grass' || object.type === 'wildStrawberry' && harvestYield(object) > 0;
export function createDeer(tile: Tile, id: number): Deer {
  return { armor: 0, kind: 'deer', id, faction: 'wild', movement: createMovement(tile), mode: 'automatic', inventory: null,
    job: null, retrySeconds: 0, harvestJob: null, harvestRetrySeconds: 0, needs: initialNeeds(false), hp: 100, bodyHp:initialBodyHp(), conditions:[], eatJob: null,
    freeSeconds: 0, leaving: false, departed: false, decisionSeconds: 0 };
}

export function deerAction(deer: Animal): string {
  if (deer.dead) return '死亡';
  if(deer.sleep?.phase==='sleeping')return '就寝中';
  if (deer.fleeGoal) return '逃走中';
  if (deer.leaving) return 'マップ外へ移動中';
  if (deer.eatJob) return '食事中';
  if(deer.attackJob?.retaliation)return '反撃中';
  if(deer.attackJob?.predation)return '捕食対象を追跡中';
  if (deer.harvestJob) return deer.movement.nextTile || !sameTile(deer.movement.tile, deer.movement.destination) ? '収集へ移動中' : '収集中';
  return '自由';
}

export class Wildlife {
  readonly deer: Deer[] = [];
  readonly wolves:Wolf[]=[];
  get animals():Animal[]{return [...this.deer,...this.wolves];}
  combat?:Combat;
  sleeping?:import('./sleep').Sleeping;
  corpseEating?:CorpseEating;
  players:()=>readonly CombatTarget[]=()=>[];
  private wolfSpawnSeconds=0;
  private wolfExitSeconds:number;
  readonly construction: Construction;
  readonly harvesting: Harvesting;
  readonly hauling: Hauling;
  readonly random: () => number;
  onSpawn?: (deer: Animal) => void;
  onDepart?: (deer: Animal) => void;
  private nextId = 1;
  private spawnSeconds = 0;
  private firstDeerWave=true;
  private firstWolfWave=true;
  private readonly initialPopulationMultiplier:number;
  private exitSeconds: number;
  constructor(construction: Construction, harvesting: Harvesting, hauling: Hauling, random: () => number = Math.random, initialPopulationMultiplier=1) {
    this.initialPopulationMultiplier=initialPopulationMultiplier;
    this.construction = construction; this.harvesting = harvesting; this.hauling = hauling; this.random = random;
    this.exitSeconds = this.interval();
    this.wolfExitSeconds=this.wolfInterval();
  }
  saveState(){return {nextId:this.nextId,spawnSeconds:this.spawnSeconds,exitSeconds:this.exitSeconds,wolfSpawnSeconds:this.wolfSpawnSeconds,wolfExitSeconds:this.wolfExitSeconds,firstDeerWave:this.firstDeerWave,firstWolfWave:this.firstWolfWave};}
  restoreState(state:ReturnType<Wildlife['saveState']>):void {this.nextId=state.nextId;this.spawnSeconds=state.spawnSeconds;this.exitSeconds=state.exitSeconds;this.wolfSpawnSeconds=state.wolfSpawnSeconds;this.wolfExitSeconds=state.wolfExitSeconds;this.firstDeerWave=state.firstDeerWave;this.firstWolfWave=state.firstWolfWave;}
  private interval(): number { return 50 + this.random() * 20; }
  private wolfInterval():number{return 110+this.random()*20;}
  private wolfCount():number{return 1+Math.floor(this.random()*2);}
  private count(): number { return 2 + Math.floor(this.random() * 2); }

  update(seconds: number, occupied: (tile: Tile) => boolean = () => false): void {
    if (seconds <= 0) return;
    this.spawnSeconds -= seconds;
    this.exitSeconds -= seconds;
    if (this.exitSeconds <= 0) {
      const candidates = this.deer.filter(deer => !deer.dead && !deer.leaving && !deer.departed);
      const count = this.count();
      for (let i = 0; i < count && candidates.length; i++) this.markForExit(candidates.splice(Math.floor(this.random() * candidates.length), 1)[0]);
      this.exitSeconds += this.interval();
    }
    if (this.spawnSeconds <= 0) { this.spawn(occupied,'deer',this.firstDeerWave?this.initialPopulationMultiplier:1);this.firstDeerWave=false; this.spawnSeconds += this.interval()/2; }
    if(this.combat&&this.corpseEating){
      this.wolfSpawnSeconds-=seconds;this.wolfExitSeconds-=seconds;
      if(this.wolfExitSeconds<=0){
        const candidates=this.wolves.filter(wolf=>!wolf.dead&&!wolf.leaving&&!wolf.departed),count=this.wolfCount();
        for(let i=0;i<count&&candidates.length;i++)this.markForExit(candidates.splice(Math.floor(this.random()*candidates.length),1)[0]);
        this.wolfExitSeconds+=this.wolfInterval();
      }
      // Process departures first so a new wave is not sent away immediately.
      if(this.wolfSpawnSeconds<=0){this.spawn(occupied,'wolf',this.firstWolfWave?this.initialPopulationMultiplier:1);this.firstWolfWave=false;this.wolfSpawnSeconds+=this.wolfInterval()*2/1.5;}
      for(let index=this.wolves.length-1;index>=0;index--){const wolf=this.wolves[index];this.updateWolf(wolf,seconds);if(wolf.departed){this.onDepart?.(wolf);this.wolves.splice(index,1);}}
    }
    for (let index = this.deer.length - 1; index >= 0; index--) {
      const deer = this.deer[index];
      this.updateDeer(deer, seconds);
      if (deer.departed) { this.onDepart?.(deer); this.deer.splice(index, 1); }
    }
  }

  private spawn(occupied: (tile: Tile) => boolean,kind:'deer'|'wolf'='deer',multiplier=1): void {
    const walls = this.construction.walls, candidates: Tile[] = [];
    for (let row = 0; row < walls.mapSize; row++) for (let column = 0; column < walls.mapSize; column++) {
      if (column !== 0 && row !== 0 && column !== walls.mapSize - 1 && row !== walls.mapSize - 1) continue;
      const tile = { column, row };
      if (!walls.at(tile) && !walls.isBlocked(tile) && !walls.cannotStop(tile) && !occupied(tile)
        && !this.animals.some(deer => sameTile(deer.movement.tile, tile) || sameTile(deer.movement.destination, tile))) candidates.push(tile);
    }
    const count = (kind==='wolf'?this.wolfCount():this.count())*multiplier;
    for (let i = 0; i < count && candidates.length; i++) {
      const tile = candidates.splice(Math.floor(this.random() * candidates.length), 1)[0];
      const animal=kind==='wolf'?createWolf(tile,this.nextId++):createDeer(tile,this.nextId++);
      if(animal.kind==='wolf')this.wolves.push(animal as Wolf);else this.deer.push(animal as Deer);
      this.onSpawn?.(animal);
    }
  }

  markForExit(deer: Animal): void {
    if (deer.dead || deer.departed || deer.leaving) return;
    if (deer.fleeGoal) { deer.leaving = true; return; }
    this.harvesting.cancel(deer);
    this.combat?.cancel(deer);
    deer.eatJob = null;
    deer.leaving = true;
    deer.decisionSeconds = 0;
  }

  wakeAndFlee(pawn: FleeingPawn, attacker: Tile): boolean {
    if (!pawn.sleep) return false;
    if (this.sleeping) this.sleeping.cancel(pawn);
    else pawn.sleep = undefined;
    if (pawn.dead) return false;
    this.flee(pawn, attacker);
    return true;
  }

  flee(deer: FleeingPawn & {departed?:boolean}, attacker: Tile): boolean {
    if (deer.dead || deer.departed) return false;
    if(deer.kind==='wolf'&&(deer.combatCommitted||deer.attackJob)){deer.combatCommitted=true;return false;}
    const walls = this.construction.walls;
    walls.bindMovement(deer.movement,deer.faction);
    const start = deer.movement.nextTile ?? deer.movement.tile;
    let dc = start.column - attacker.column, dr = start.row - attacker.row;
    if (!dc && !dr) { dc = 1; dr = 0; }
    const length = Math.hypot(dc, dr);
    const desired = { column: start.column + dc / length * DEER_FLEE_DISTANCE, row: start.row + dr / length * DEER_FLEE_DISTANCE };
    const paths = findPaths(start, walls.mapSize, walls.isBlocked, walls.cannotStop, deer.movement);
    let best: { goal: Tile; path: Path; error: number } | null = null;
    let lateral: { goal: Tile; path: Path; error: number; radialError: number } | null = null;
    const candidates=[];
    for(let row=Math.max(0,start.row-DEER_FLEE_DISTANCE);row<=Math.min(walls.mapSize-1,start.row+DEER_FLEE_DISTANCE);row++)
      for(let column=Math.max(0,start.column-DEER_FLEE_DISTANCE);column<=Math.min(walls.mapSize-1,start.column+DEER_FLEE_DISTANCE);column++){
        const goal={column,row},projection=(column-start.column)*dc+(row-start.row)*dr;
        const distance=Math.hypot(column-start.column,row-start.row);
        if(projection<0||!distance||distance>DEER_FLEE_DISTANCE+1e-9)continue;
        candidates.push({goal,projection,error:Math.hypot(column-desired.column,row-desired.row),radialError:Math.abs(DEER_FLEE_DISTANCE-distance)});
      }
    candidates.sort((a,b)=>Number(a.projection===0)-Number(b.projection===0)||(a.projection===0?a.radialError-b.radialError:0)||a.error-b.error);
    for(const candidate of candidates){
      const {goal,projection,error,radialError}=candidate;
      if(best&&(projection===0||error>best.error+1e-10))break;
      if(lateral&&(radialError>lateral.radialError+1e-10||radialError===lateral.radialError&&error>lateral.error+1e-10))break;
      const path=paths.get(goal.row*walls.mapSize+goal.column);if(!path)continue;
      if(projection===0){if(!lateral||path.distance<lateral.path.distance)lateral={goal,path,error,radialError};}
      else if(!best||path.distance<best.path.distance)best={goal,path,error};
    }
    best ??= lateral;
    if (!best) return false;
    this.harvesting.cancel(deer); this.hauling.cancel(deer); this.construction.cancel(deer);
    this.combat?.cancel(deer);
    deer.eatJob = null; deer.freeSeconds = 0;
    deer.fleeGoal = best.goal;
    return setRoute(deer.movement, best.path.tiles);
  }

  updateDeer(deer: Deer, seconds: number): void {
    if (deer.dead || deer.departed) return;
    const walls = this.construction.walls;
    walls.bindMovement(deer.movement,deer.faction);
    const resting=this.sleeping?.update(deer,seconds,false)??false;
    const eating = updateNeeds(deer, this.construction, this.harvesting, this.hauling, seconds, false,undefined,['strawberry','ration'],!resting);
    if(resting){if(deer.dead)this.sleeping?.cancel(deer);return;}
    if (deer.dead) return;
    if (deer.fleeGoal) {
      if (deer.movement.nextTile || !sameTile(deer.movement.tile, deer.movement.destination)) return;
      deer.fleeGoal = undefined;
      deer.freeSeconds = 0;
    }
    if (deer.leaving) {
      this.updateExit(deer, seconds);
      return;
    }
    if (eating) return;
    if (deer.needs.satiety < FOOD_THRESHOLD) {
      if (!deer.harvestJob) {
        if (canPlan(deer.movement)) {
          const work = this.harvesting.findWork(deer, object => object.type === 'grass')
            ?? this.harvesting.findWork(deer, object => object.type === 'wildStrawberry' && harvestYield(object) > 0);
          if (work) {
            stopAtNextSafeTile(deer.movement, walls.cannotStop);
            this.harvesting.claims.set(work.target, deer);
            deer.harvestJob = { target: work.target, goal: work.goal };
            setRoute(deer.movement, work.path.tiles);
          } else if (updateNeeds(deer, this.construction, this.harvesting, this.hauling, 0, true, undefined, ['strawberry','ration'])) return;
        }
      }
      if (deer.harvestJob) {
        const harvested = this.harvesting.update(deer, seconds, deerForage);
        if (harvested) this.eatHarvest(deer, harvested);
        return;
      }
    }
    updateRoaming(deer, walls, seconds, this.random);
  }

  reactToAttack(wolf:Wolf,attacker:CombatTarget):'retaliate'|'flee'|null {
    if(wolf.dead||wolf.sleep||wolf.departed||attacker.dead||attacker.departed)return null;
    if(wolf.combatCommitted||wolf.attackJob){
      wolf.combatCommitted=true;wolf.fleeGoal=undefined;
      if(wolf.attackJob&&!wolf.attackJob.target.dead&&!wolf.attackJob.target.departed)return 'retaliate';
      return this.combat?.requestRetaliation(wolf,attacker)?'retaliate':null;
    }
    wolf.prey=undefined;
    this.combat?.cancel(wolf);
    if(this.random()<wolf.retaliationProbability){
      wolf.fleeGoal=undefined;
      return this.combat?.requestRetaliation(wolf,attacker)?'retaliate':null;
    }
    return this.flee(wolf,attacker.movement.tile)?'flee':null;
  }

  updateWolf(wolf:Wolf,seconds:number):void {
    if(wolf.dead||wolf.departed)return;
    const walls=this.construction.walls;walls.bindMovement(wolf.movement,wolf.faction);
    const resting=this.sleeping?.update(wolf,seconds,false)??false;
    const eating=updateNeeds(wolf,this.construction,this.harvesting,this.hauling,seconds,false,undefined,['meat','ration'],!resting);
    if(resting){if(wolf.dead)this.sleeping?.cancel(wolf);return;}
    if(wolf.dead){this.combat?.cancel(wolf);return;}
    if(wolf.fleeGoal){
      if(wolf.movement.nextTile||!sameTile(wolf.movement.tile,wolf.movement.destination))return;
      wolf.fleeGoal=undefined;wolf.freeSeconds=0;
    }
    if(wolf.leaving){this.combat?.cancel(wolf);this.updateExit(wolf,seconds);return;}
    if(eating){this.combat?.cancel(wolf);return;}
    wolf.decisionSeconds-=seconds;
    if((wolf.attackJob?.predation||wolf.attackJob?.retaliation)&&this.combat?.update(wolf,seconds))return;
    if(wolf.needs.satiety<=FOOD_THRESHOLD&&this.combat&&this.corpseEating){
      if(canPlan(wolf.movement)&&wolf.prey?.dead&&this.corpseEating.request(wolf,wolf.prey)){wolf.prey=undefined;return;}
      if(wolf.decisionSeconds<=0&&canPlan(wolf.movement)){
        wolf.decisionSeconds=.25;
        const origin=wolf.movement.tile;
        const nearest=(targets:readonly CombatTarget[])=>[...targets].filter(target=>!target.departed&&!target.consumed&&target!==wolf).sort((a,b)=>Math.hypot(a.movement.tile.column-origin.column,a.movement.tile.row-origin.row)-Math.hypot(b.movement.tile.column-origin.column,b.movement.tile.row-origin.row)).find(target=>target.dead?this.corpseEating!.canEat(wolf,target):this.combat!.canReachAttack(wolf,target));
        const deer=nearest(this.deer);
        if (!deer && updateNeeds(wolf,this.construction,this.harvesting,this.hauling,0,true,undefined,['meat','ration'])) return;
        const target=deer??nearest(this.corpseEating.corpses().filter(corpse=>corpse.dead) as CombatTarget[])??nearest(this.players().filter(pawn=>pawn.faction==='player'));
        if(target){
          if(target.dead)this.corpseEating.request(wolf,target);
          else if(this.combat.requestPredation(wolf,target))wolf.prey=target;
          return;
        }
      }
    }
    if ((!this.combat || !this.corpseEating) && updateNeeds(wolf,this.construction,this.harvesting,this.hauling,0,!wolf.leaving&&!wolf.fleeGoal&&!wolf.attackJob?.retaliation,undefined,['meat','ration'])) return;
    updateRoaming(wolf,walls,seconds,this.random);
  }

  private eatHarvest(deer: Deer, target: EnvironmentObject): void {
    if (target.type === 'grass') {
      deer.needs.satiety = Math.min(100, deer.needs.satiety + 5);
      deer.freeSeconds = 0;
      return;
    }
    const source = this.harvesting.items.find(item => item.type === 'strawberry' && sameTile(item, target) && item.quantity > 0);
    if (!source) return;
    const quantity = Math.min(source.quantity, harvestYield(target));
    source.quantity -= quantity;
    const held = { type: 'strawberry' as const, quantity };
    deer.inventory = held;
    const goal = { ...deer.movement.tile };
    const food: MapItem = { ...goal, type: 'strawberry',
      get quantity() { return deer.inventory === held ? held.quantity : 0; },
      set quantity(value: number) { held.quantity = value; if (!value && deer.inventory === held) deer.inventory = null; },
    };
    deer.eatJob = { source: food, goal, manual: true };
    deer.freeSeconds = 0;
  }

  private updateExit(deer: Animal, seconds: number): void {
    const walls = this.construction.walls, movement = deer.movement;
    if (movement.tile.column < 0 || movement.tile.row < 0 || movement.tile.column >= walls.mapSize || movement.tile.row >= walls.mapSize) {
      deer.departed = true;
      return;
    }
    if (movement.nextTile || !sameTile(movement.tile, movement.destination)) return;
    if (deer.exitGoal && sameTile(movement.tile, deer.exitGoal)) {
      const { column, row } = movement.tile;
      deer.outsideGoal = column === 0 ? { column: -1, row } : column === walls.mapSize - 1 ? { column: walls.mapSize, row }
        : row === 0 ? { column, row: -1 } : { column, row: walls.mapSize };
      setRoute(movement, [deer.outsideGoal]);
      return;
    }
    deer.decisionSeconds -= seconds;
    if (deer.decisionSeconds > 0 || !canPlan(movement)) return;
    deer.decisionSeconds = .25;
    const paths = findPaths(movement.tile, walls.mapSize, walls.isBlocked, walls.cannotStop, movement);
    let best: { goal: Tile; path: Path } | undefined;
    for (const [index, path] of paths) {
      if(best&&path.distance>best.path.distance)break;
      const column = index % walls.mapSize, row = Math.floor(index / walls.mapSize);
      if (column !== 0 && row !== 0 && column !== walls.mapSize - 1 && row !== walls.mapSize - 1) continue;
      if (!best || path.distance < best.path.distance) best = { goal: { column, row }, path };
    }
    if (best) { deer.exitGoal = best.goal; setRoute(movement, best.path.tiles); }
  }
}
