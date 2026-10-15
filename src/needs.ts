import { diningTable, findDiningSeat } from './dining.ts';
import type { DiningSeat } from './dining';
import type { Construction } from './construction';
import type { HarvestWorker, Harvesting } from './harvesting';
import type { HaulWorker, Hauling } from './hauling';
import type { MapItem, ItemType } from './items';
import { foodNutrition, returnItems, carryCapacity } from './items.ts';
import type { Tile } from './movement';
import { renderedPosition, setRoute, stopAtNextSafeTile } from './movement.ts';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';

export interface Needs { satiety: number; health: number; wakefulness?:number }
export type EatingWorker = HarvestWorker & HaulWorker & {
  needs: Needs;
  sleep?:import('./sleep').SleepState;
  sleepRetrySeconds?:number;
  hp?: number;
  consumed?: boolean;
  collectCorpse?: boolean;
  corpseEater?: EatingWorker;
  corpseStorage?: import('./walls').Wall;
  corpseCarrier?: { movement: import('./movement').Movement };
  corpseStation?: Tile;
  dead?: boolean;
  deadPosition?: Tile;
  eatJob: { source: MapItem; goal: Tile; manual?: boolean; eatingSeconds?: number; held?:boolean; seatChecked?:boolean; seat?:DiningSeat } | null;
};
export const SATIETY_LOSS_PER_SECOND = 1;
export const FOOD_THRESHOLD = 20;
export const STRAWBERRY_SATIETY = 20;
export const EATING_SECONDS = 1;
export const initialNeeds = (): Needs => ({ satiety: 100, health: 100, wakefulness:100 });
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
    const quantity = Math.min(job.source.quantity, Math.ceil(100 / foodNutrition(job.source.type)), carryCapacity(worker, job.source.type));
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
  worker.deadPosition = renderedPosition(worker.movement);
  let restingTile = worker.movement.tile;
  if (worker.movement.stopBlocked?.(restingTile)
    || worker.movement.nextTile && worker.movement.stopBlocked?.(worker.movement.nextTile)) {
    // A pawn dying during a crossing must not leave a body on another pawn.
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
  const previousHealth = worker.needs.health;
  worker.needs.health = Math.max(0, previousHealth - starvingSeconds);
  const unhealthySeconds = previousHealth <= 0 ? elapsed : Math.max(0, starvingSeconds - previousHealth);
  worker.hp = Math.max(0, (worker.hp ?? 100) - unhealthySeconds * 10);
  if (worker.hp <= 0) {
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
    if (worker.inventory && foodNutrition(worker.inventory.type) > 0 && (!animalDiet||animalDiet.includes(worker.inventory.type)) && worker.inventory.quantity > 0) {
      interruptWork(worker, construction, harvesting, hauling);
      const goal = { ...worker.movement.destination };
      worker.eatJob = { source:heldFoodSource(worker,goal), goal, held:true };
      return true;
    }
    const types:readonly ItemType[]=animalDiet??['strawberry','meat','ration'];
    const sources = [...construction.items.filter(item => types.includes(item.type) && (animalDiet||item.collect) && item.quantity > 0), ...types.flatMap(type=>construction.storage?.sources(type)??[])];
    if (!sources.length) return fallbackFood?.(worker)??false;
    const walls = construction.walls;
    const from = worker.movement.nextTile ?? worker.movement.tile;
    const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop, worker.movement);
    let best: { source: MapItem; goal: Tile; path: Path } | null = null;
    for (const source of sources) {
      let approach = construction.sourceApproach(from, source, paths);
      if (!approach && !walls.isBlocked(source)) approach = hauling.approach(from, source, paths);
      if (approach && (!best || approach.path.distance < best.path.distance)) best = { source, ...approach };
    }
    if (!best) return fallbackFood?.(worker)??false;
    interruptWork(worker, construction, harvesting, hauling);
    worker.eatJob = { source: best.source, goal: best.goal };
    setRoute(worker.movement, best.path.tiles);
    return true;
  }
  const job = worker.eatJob;
  if (job.seat && diningTable(construction.walls,job.seat.chair) !== job.seat.table) {
    delete job.seat;
    stopAtNextSafeTile(worker.movement,construction.walls.cannotStop);
    job.goal = {...worker.movement.destination};
    job.seatChecked = false;
    if (seekDiningSeat(worker,construction)) return true;
  }
  if (worker.movement.nextTile || !sameTile(worker.movement.tile, worker.movement.destination)) return true;
  if (!sameTile(worker.movement.tile, job.goal)) { worker.eatJob = null; return false; }
  if (!animalDiet && !job.seatChecked && seekDiningSeat(worker,construction)) return true;
  job.eatingSeconds = Math.min(EATING_SECONDS, (job.eatingSeconds ?? 0) + elapsed);
  if (job.eatingSeconds < EATING_SECONDS) return true;
  const quantity = Math.min(job.source.quantity, Math.max(1, Math.ceil((100 - worker.needs.satiety) / foodNutrition(job.source.type))));
  job.source.quantity -= quantity;
  worker.needs.satiety = Math.min(100, worker.needs.satiety + quantity * foodNutrition(job.source.type));
  worker.eatJob = null;
  return true;
}

export function requestEat(worker: EatingWorker, source: MapItem, construction: Construction, harvesting: Harvesting, hauling: Hauling): boolean {
  if (worker.dead || worker.sleep || foodNutrition(source.type) <= 0 || source.quantity <= 0) return false;
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
