import type { Construction } from './construction';
import type { HarvestWorker, Harvesting } from './harvesting';
import type { HaulWorker, Hauling } from './hauling';
import type { MapItem } from './items';
import type { Tile } from './movement';
import { renderedPosition, setRoute, stopAtNextSafeTile } from './movement.ts';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';

export interface Needs { satiety: number; health: number }
export type EatingWorker = HarvestWorker & HaulWorker & {
  needs: Needs;
  dead?: boolean;
  deadPosition?: Tile;
  eatJob: { source: MapItem; goal: Tile; manual?: boolean; eatingSeconds?: number } | null;
};
export const SATIETY_LOSS_PER_SECOND = 0.1;
export const FOOD_THRESHOLD = 20;
export const STRAWBERRY_SATIETY = 20;
export const EATING_SECONDS = 1;
export const initialNeeds = (): Needs => ({ satiety: 100, health: 100 });
const sameTile = (a: Tile, b: Tile) => a.column === b.column && a.row === b.row;

function interruptWork(worker: EatingWorker, construction: Construction, harvesting: Harvesting, hauling: Hauling): void {
  construction.cancel(worker); harvesting.cancel(worker); hauling.cancel(worker);
}

export function updateNeeds(worker: EatingWorker, construction: Construction, harvesting: Harvesting, hauling: Hauling, seconds: number): boolean {
  if (worker.dead) return true;
  const elapsed = Math.max(0, seconds);
  const previousSatiety = worker.needs.satiety;
  worker.needs.satiety = Math.max(0, previousSatiety - elapsed * SATIETY_LOSS_PER_SECOND);
  const starvingSeconds = Math.max(0, elapsed - previousSatiety / SATIETY_LOSS_PER_SECOND);
  worker.needs.health = Math.max(0, worker.needs.health - starvingSeconds);
  if (worker.needs.health <= 0) {
    worker.deadPosition = renderedPosition(worker.movement);
    worker.dead = true;
    interruptWork(worker, construction, harvesting, hauling);
    worker.eatJob = null;
    worker.dropRequested = false;
    worker.movement.nextTile = null;
    worker.movement.progress = 0;
    worker.movement.destination = { ...worker.movement.tile };
    worker.movement.route = [];
    return true;
  }
  if (worker.dropRequested) { worker.eatJob = null; return false; }
  if (!worker.eatJob && worker.needs.satiety > FOOD_THRESHOLD) return false;
  if (worker.eatJob && (worker.eatJob.source.quantity <= 0 || !worker.eatJob.manual && construction.items.includes(worker.eatJob.source) && !worker.eatJob.source.collect)) {
    worker.eatJob = null;
    stopAtNextSafeTile(worker.movement, construction.walls.cannotStop);
    return false;
  }
  if (!worker.eatJob) {
    if (worker.inventory?.type === 'strawberry' && worker.inventory.quantity > 0) {
      const held = worker.inventory;
      interruptWork(worker, construction, harvesting, hauling);
      const goal = { ...worker.movement.destination };
      const source: MapItem = { ...goal, type: 'strawberry',
        get quantity() { return worker.inventory === held ? held.quantity : 0; },
        set quantity(value: number) { held.quantity = value; if (!value && worker.inventory === held) worker.inventory = null; },
      };
      worker.eatJob = { source, goal };
      return true;
    }
    const sources = [...construction.items.filter(item => item.type === 'strawberry' && item.collect && item.quantity > 0), ...(construction.storage?.sources('strawberry') ?? [])];
    if (!sources.length) return false;
    const walls = construction.walls;
    const from = worker.movement.nextTile ?? worker.movement.tile;
    const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop);
    let best: { source: MapItem; goal: Tile; path: Path } | null = null;
    for (const source of sources) {
      let approach = construction.sourceApproach(from, source, paths);
      if (!approach && !walls.isBlocked(source)) approach = hauling.approach(from, source, paths);
      if (approach && (!best || approach.path.distance < best.path.distance)) best = { source, ...approach };
    }
    if (!best) return false;
    interruptWork(worker, construction, harvesting, hauling);
    worker.eatJob = { source: best.source, goal: best.goal };
    setRoute(worker.movement, best.path.tiles);
    return true;
  }
  const job = worker.eatJob;
  if (worker.movement.nextTile || !sameTile(worker.movement.tile, worker.movement.destination)) return true;
  if (!sameTile(worker.movement.tile, job.goal)) { worker.eatJob = null; return false; }
  job.eatingSeconds = Math.min(EATING_SECONDS, (job.eatingSeconds ?? 0) + elapsed);
  if (job.eatingSeconds < EATING_SECONDS) return true;
  const quantity = Math.min(job.source.quantity, Math.max(1, Math.ceil((100 - worker.needs.satiety) / STRAWBERRY_SATIETY)));
  job.source.quantity -= quantity;
  worker.needs.satiety = Math.min(100, worker.needs.satiety + quantity * STRAWBERRY_SATIETY);
  worker.eatJob = null;
  return true;
}

export function requestEat(worker: EatingWorker, source: MapItem, construction: Construction, harvesting: Harvesting, hauling: Hauling): boolean {
  if (worker.dead || source.type !== 'strawberry' || source.quantity <= 0) return false;
  const walls = construction.walls;
  const from = worker.movement.nextTile ?? worker.movement.tile;
  const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop);
  let approach = construction.sourceApproach(from, source, paths);
  if (!approach && !walls.isBlocked(source)) approach = hauling.approach(from, source, paths);
  if (!approach) return false;
  interruptWork(worker, construction, harvesting, hauling);
  worker.dropRequested = false;
  worker.eatJob = { source, goal: approach.goal, manual: true };
  setRoute(worker.movement, approach.path.tiles);
  return true;
}
