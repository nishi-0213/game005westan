import {foodRequirement} from './personality.ts';
import { conditionRemaining, mealConditions, updateConditions, type BodyCondition } from './body-conditions.ts';
import { recoverHealth, damageAllBodyParts, healthHp, type BodyHp } from './health.ts';
import { FOOD_THRESHOLD } from './needs-threshold.ts';
import { canPlan } from './path-schedule.ts';
import { GAME_MINUTES_PER_SECOND } from './game-time.ts';
import { canGiveOrders, rememberMood, type MoodMemory } from './mood.ts';
import { diningTable, findDiningSeat } from './dining.ts';
import type { DiningSeat } from './dining';
import type { Construction } from './construction';
import type { HarvestWorker, Harvesting } from './harvesting';
import type { HaulWorker, Hauling } from './hauling';
import type { MapItem, ItemType } from './items';
import { foodNutrition, returnItems, carryCapacity } from './items.ts';
import type { Tile } from './movement';
import { setRoute, stopAtNextSafeTile } from './movement.ts';
import { findPaths, rankedTargets } from './pathfinding.ts';
import type { Path } from './pathfinding';

export interface Needs { satiety: number; wakefulness?:number; happiness?:number }
export type EatingWorker = HarvestWorker & HaulWorker & {
  needs: Needs;
  kind?:'human'|'deer'|'wolf';
  moodMemories?:MoodMemory[];
  sleep?:import('./sleep').SleepState;
  sleepRetrySeconds?:number;
  hp?: number;
  bodyHp?: BodyHp;
  conditions?:BodyCondition[];
  armor?: number;
  consumed?: boolean;
  collectCorpse?: boolean;
  corpseEater?: EatingWorker;
  corpseStorage?: import('./walls').Wall;
  corpseCarrier?: { movement: import('./movement').Movement };
  corpseStation?: Tile;
  dead?: boolean;
  deadPosition?: Tile;
  eatJob: { source: MapItem; goal: Tile; manual?: boolean; corpse?: EatingWorker; eatingSeconds?: number; held?:boolean; seatChecked?:boolean; seat?:DiningSeat } | null;
};
export const SATIETY_LOSS_PER_SECOND = GAME_MINUTES_PER_SECOND / 30;
export const STARVATION_HP_LOSS_PER_SECOND = 30 / (24 * 60 / GAME_MINUTES_PER_SECOND);
export { FOOD_THRESHOLD } from './needs-threshold.ts';
export const STRAWBERRY_SATIETY = 20;
export const EATING_SECONDS = 1;
export const initialNeeds = (human=true): Needs => ({ satiety: 100, wakefulness:100, ...(human?{happiness:50}:{}) });
const sameTile = (a: Tile, b: Tile) => a.column === b.column && a.row === b.row;

function interruptWork(worker: EatingWorker, construction: Construction, harvesting: Harvesting, hauling: Hauling): void {
  construction.cancel(worker); harvesting.cancel(worker); hauling.cancel(worker);
}

function heldFoodSource(worker: EatingWorker, goal: Tile): MapItem {
  const held = worker.inventory!;
  return { ...goal, type: held.type,
    get quantity() { return worker.inventory === held ? held.quantity : 0; },
    set quantity(value: number) { held.quantity = value; if (!value && worker.inventory === held) worker.inventory = null; },
  };
}

function seekDiningSeat(worker: EatingWorker, construction: Construction): boolean {
  const job = worker.eatJob!;
  job.seatChecked = true;
  if (!['strawberry','meat','ration'].includes(job.source.type)) return false;
  const seat = findDiningSeat(construction.walls, worker.movement);
  if (!seat) return false;
  if (!job.held) {
    // A pawn carries one material type: put work supplies down before picking up a meal.
    if (worker.inventory) {
      returnItems(construction.items,worker.movement.tile,worker.inventory.type,worker.inventory.quantity);
      worker.inventory = null;
    }
    const quantity = Math.min(job.source.quantity, Math.ceil(100 * foodRequirement(worker) / foodNutrition(job.source.type)), carryCapacity(worker, job.source.type));
    job.source.quantity -= quantity;
    worker.inventory = {type:job.source.type,quantity};
    job.source = heldFoodSource(worker, worker.movement.tile);
    job.held = true;
  }
  delete job.eatingSeconds;
  job.seat = seat;
  job.goal = {column:seat.chair.column,row:seat.chair.row};
  setRoute(worker.movement,seat.path.tiles);
  return seat.path.distance > 0;
}

export function killPawn(worker: EatingWorker, construction: Construction, harvesting: Harvesting, hauling: Hauling): void {
  if (worker.dead) return;
  worker.hp = 0;
  if(worker.bodyHp&&healthHp(worker)>0)worker.bodyHp.torso=0;
  worker.deadPosition = { ...worker.movement.tile };
  let restingTile = worker.movement.tile;
  if (!worker.movement.nextTile && worker.movement.stopBlocked?.(restingTile)) {
    // Keep the existing free-cell fallback for stationary pawns.
    // During a crossing, death always returns to the source tile.
    const walls = construction.walls;
    const paths = findPaths(worker.movement.nextTile ?? restingTile, walls.mapSize, walls.isBlocked, walls.cannotStop, worker.movement);
    let nearestDistance = Infinity;
    for (const index of paths.keys()) {
      const tile = { column: index % walls.mapSize, row: Math.floor(index / walls.mapSize) };
      const distance = Math.hypot(tile.column - worker.deadPosition.column, tile.row - worker.deadPosition.row);
      if (distance < nearestDistance) { nearestDistance = distance; restingTile = tile; }
    }
    worker.deadPosition = { ...restingTile };
  }
  // Clothing stays equipped on the corpse; only the weapon is dropped here.
  if(worker.weapon && worker.weapon!=='unarmed') {
    const walls=construction.walls;
    const nearby=[];
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(!dc&&!dr)continue;
      const tile={column:restingTile.column+dc,row:restingTile.row+dr};
      if(tile.column>=0&&tile.row>=0&&tile.column<walls.mapSize&&tile.row<walls.mapSize&&!walls.isBlocked(tile)&&!walls.cannotStop(tile))nearby.push(tile);
    }
    returnItems(construction.items,nearby[0]??restingTile,worker.weapon,1);
    worker.weapon='unarmed';
  }
  worker.dead = true;
  if(worker.kind==='human'&&'faction' in worker&&worker.faction==='player')worker.collectCorpse=false;
  interruptWork(worker, construction, harvesting, hauling);
  worker.eatJob = null;
  worker.dropRequested = false;
  worker.movement.tile = { ...restingTile };
  worker.movement.nextTile = null;
  worker.movement.progress = 0;
  worker.movement.destination = { ...worker.movement.tile };
  worker.movement.route = [];
  worker.movement.changed?.();
}

export function updateNeeds(worker: EatingWorker, construction: Construction, harvesting: Harvesting, hauling: Hauling, seconds: number, automaticFood = true, fallbackFood?: (worker:EatingWorker)=>boolean, animalDiet?: readonly ItemType[], allowEating=true): boolean {
  if (worker.dead) return true;
  const elapsed = Math.max(0, seconds);
  const previousSatiety = worker.needs.satiety;
  worker.needs.satiety = Math.max(0, previousSatiety - elapsed * SATIETY_LOSS_PER_SECOND);
  const starvingSeconds = Math.max(0, elapsed - previousSatiety / SATIETY_LOSS_PER_SECOND);
  const recoveryBlockedSeconds:Partial<Record<keyof BodyHp,number>>={};
  for(const condition of worker.conditions??[])recoveryBlockedSeconds[condition.part]=Math.max(recoveryBlockedSeconds[condition.part]??0,conditionRemaining(worker,condition));
  updateConditions(worker,elapsed);
  recoverHealth(worker,Math.max(0,elapsed-starvingSeconds),recoveryBlockedSeconds);
  damageAllBodyParts(worker,starvingSeconds * STARVATION_HP_LOSS_PER_SECOND);
  if (healthHp(worker) <= 0) {
    killPawn(worker, construction, harvesting, hauling);
    return true;
  }
  if(!allowEating)return true;
  if (worker.dropRequested) { worker.eatJob = null; return false; }
  if(worker.mode==='drafted'){
    if(worker.eatJob&&!worker.eatJob.manual){worker.eatJob=null;stopAtNextSafeTile(worker.movement,construction.walls.cannotStop);}
    if(!worker.eatJob)return false;
  }
  if (!worker.eatJob && (!automaticFood || worker.needs.satiety > FOOD_THRESHOLD)) return false;
  if (worker.eatJob && (worker.eatJob.source.quantity <= 0 || !worker.eatJob.manual && construction.items.includes(worker.eatJob.source) && !worker.eatJob.source.collect && !animalDiet)) {
    worker.eatJob = null;
    stopAtNextSafeTile(worker.movement, construction.walls.cannotStop);
    return false;
  }
  if (!worker.eatJob) {
    if (!animalDiet && worker.inventory && foodNutrition(worker.inventory.type) > 0 && worker.inventory.quantity > 0) {
      interruptWork(worker, construction, harvesting, hauling);
      const goal = { ...worker.movement.destination };
      worker.eatJob = { source:heldFoodSource(worker,goal), goal, held:true };
      return true;
    }
    if(!canPlan(worker.movement))return false;
    const types:readonly ItemType[]=animalDiet??['strawberry','meat','ration'];
    const carried = animalDiet && worker.inventory?.quantity && types.includes(worker.inventory.type) ? heldFoodSource(worker, worker.movement.nextTile ?? worker.movement.tile) : undefined;
    const sources = [...(carried ? [carried] : []), ...construction.items.filter(item => types.includes(item.type) && (animalDiet||item.collect) && item.quantity > 0), ...types.flatMap(type=>construction.storage?.sources(type)??[])];
    if (!sources.length) return fallbackFood?.(worker)??false;
    const walls = construction.walls;
    const from = worker.movement.nextTile ?? worker.movement.tile;
    const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop, worker.movement);
    let best: { source: MapItem; goal: Tile; path: Path } | null = null;
    let bestOrder=Infinity;
    // Animal diets are ordered preferences; distance only breaks ties within a food type.
    for (const group of animalDiet ? types.map(type => sources.filter(source => source.type === type)) : [sources]) {
      for (const {target:source,order,lowerBound} of rankedTargets(group,from)) {
        if(best&&lowerBound>best.path.distance+1e-10)break;
        let approach = construction.sourceApproach(from, source, paths);
        if (!approach && !walls.isBlocked(source)) approach = hauling.approach(from, source, paths);
        if (approach && (!best || approach.path.distance < best.path.distance || approach.path.distance===best.path.distance&&order<bestOrder)) {best = { source, ...approach };bestOrder=order;}
      }
      if (best) break;
    }
    if (!best) return fallbackFood?.(worker)??false;
    interruptWork(worker, construction, harvesting, hauling);
    worker.eatJob = { source: best.source, goal: best.goal, held: best.source === carried };
    setRoute(worker.movement, best.path.tiles);
    return true;
  }
  const job = worker.eatJob;
  if (job.seat && diningTable(construction.walls,job.seat.chair) !== job.seat.table) {
    delete job.seat;
    stopAtNextSafeTile(worker.movement,construction.walls.cannotStop);
    job.goal = {...worker.movement.destination};
    job.seatChecked = false;
    if (canPlan(worker.movement)&&seekDiningSeat(worker,construction)) return true;
  }
  if (worker.movement.nextTile || !sameTile(worker.movement.tile, worker.movement.destination)) return true;
  if (!sameTile(worker.movement.tile, job.goal)) { worker.eatJob = null; return false; }
  if (!animalDiet && !job.seatChecked) {
    if(!canPlan(worker.movement))return true;
    if(seekDiningSeat(worker,construction))return true;
  }
  job.eatingSeconds = Math.min(EATING_SECONDS, (job.eatingSeconds ?? 0) + elapsed);
  if (job.eatingSeconds < EATING_SECONDS) return true;
  const quantity = Math.min(job.source.quantity, Math.max(1, Math.ceil((100 - worker.needs.satiety) * foodRequirement(worker) / foodNutrition(job.source.type))));
  job.source.quantity -= quantity;
  worker.needs.satiety = Math.min(100, worker.needs.satiety + quantity * foodNutrition(job.source.type) / foodRequirement(worker));
  mealConditions(worker,job.source.type);
  if(job.source.type==='meat'||job.source.type==='humanCorpse'||job.source.type==='deerCorpse'||job.source.type==='wolfCorpse')rememberMood(worker,'rawFood');
  if(!job.seat)rememberMood(worker,'standingMeal');
  worker.eatJob = null;
  return true;
}

export function requestEat(worker: EatingWorker, source: MapItem, construction: Construction, harvesting: Harvesting, hauling: Hauling, manual=true): boolean {
  if (manual&&!canGiveOrders(worker) || worker.dead || worker.sleep || foodNutrition(source.type) <= 0 || source.quantity <= 0) return false;
  const walls = construction.walls;
  const from = worker.movement.nextTile ?? worker.movement.tile;
  const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop, worker.movement);
  let approach = construction.sourceApproach(from, source, paths);
  if (!approach && !walls.isBlocked(source)) approach = hauling.approach(from, source, paths);
  if (!approach) return false;
  interruptWork(worker, construction, harvesting, hauling);
  worker.dropRequested = false;
  worker.eatJob = { source, goal: approach.goal, manual: true };
  setRoute(worker.movement, approach.path.tiles);
  return true;
}
