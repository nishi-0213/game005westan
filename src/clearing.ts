import type { Builder } from './construction';
import type { Hauling } from './hauling';
import type { ItemType, MapItem } from './items';
import { ITEM_APPEARANCE, PAWN_CARRY_LIMIT_KG, returnItems } from './items.ts';
import type { Tile } from './movement';
import { setRoute, stopAtNextSafeTile } from './movement.ts';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';
import type { Wall } from './walls';

export interface ClearanceJob {
  target: Wall;
  source?: MapItem;
  phase: 'pickup' | 'drop';
  goal: Tile;
  collect?: boolean;
}
export interface ClearWorker extends Builder { clearJob?: ClearanceJob | null }
const sameTile = (a: Tile, b: Tile) => a.column === b.column && a.row === b.row;
const key = (tile: Tile) => `${tile.column},${tile.row}`;

export class Clearing {
  readonly claims = new Map<Wall, ClearWorker>();
  readonly destinations = new Map<string, ClearWorker>();
  readonly items: MapItem[];
  readonly hauling: Hauling;
  constructor(items: MapItem[], hauling: Hauling) { this.items = items; this.hauling = hauling; }

  isClearing(tile: Tile): boolean {
    const target = this.hauling.storage.walls.items.get(key(tile));
    return target !== undefined && this.claims.has(target);
  }

  canPlace(tile: Tile, type: ItemType, worker: ClearWorker): boolean {
    const walls = this.hauling.storage.walls;
    return !walls.items.has(key(tile)) && !walls.isBlocked(tile) && !walls.cannotStop(tile)
      && (!this.destinations.has(key(tile)) || this.destinations.get(key(tile)) === worker)
      && !this.items.some(item => item.quantity > 0 && sameTile(item, tile) && item.type !== type);
  }

  nearbyPlace(from: Tile, origin: Tile, type: ItemType, worker: ClearWorker): { goal: Tile; path: Path } | null {
    const walls = this.hauling.storage.walls;
    const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop, worker.movement);
    for (let radius = 1; radius < walls.mapSize; radius++) {
      let best: { goal: Tile; path: Path } | null = null;
      for (let row = Math.max(0, origin.row - radius); row <= Math.min(walls.mapSize - 1, origin.row + radius); row++) {
        for (let column = Math.max(0, origin.column - radius); column <= Math.min(walls.mapSize - 1, origin.column + radius); column++) {
          if (Math.max(Math.abs(column - origin.column), Math.abs(row - origin.row)) !== radius) continue;
          const path = paths.get(row * walls.mapSize + column);
          if (!path || best && path.distance >= best.path.distance) continue;
          const goal = { column, row };
          if (this.canPlace(goal, type, worker)) best = { goal, path };
        }
      }
      if (best) return best;
    }
    return null;
  }

  findWork(worker: ClearWorker): { target: Wall; source: MapItem; goal: Tile; path: Path } | null {
    const walls = this.hauling.storage.walls;
    if (!this.items.some(item => item.quantity > 0 && walls.items.get(key(item))?.state === 'planned')) return null;
    const from = worker.movement.nextTile ?? worker.movement.tile;
    let paths: Map<number, Path> | undefined;
    let best: { target: Wall; source: MapItem; goal: Tile; path: Path } | null = null;
    for (const source of this.items) {
      if (source.quantity <= 0) continue;
      const target = walls.items.get(key(source));
      if (!target || target.state !== 'planned' || this.claims.has(target) && this.claims.get(target) !== worker) continue;
      // A live environment object is cleared through harvesting before the item is approached.
      if (walls.cannotStop(source)) continue;
      paths ??= findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop, worker.movement);
      const path = paths.get(source.row * walls.mapSize + source.column);
      if (!path || best && path.distance >= best.path.distance) continue;
      if (!this.nearbyPlace(source, target, worker.inventory?.type ?? source.type, worker)) continue;
      best = { target, source, goal: source, path };
    }
    return best;
  }

  hasAvailableWork(worker: ClearWorker): boolean { return this.findWork(worker) !== null; }

  cancel(worker: ClearWorker): void {
    const job = worker.clearJob;
    if (!job) return;
    if (this.claims.get(job.target) === worker) this.claims.delete(job.target);
    for (const [tile, owner] of this.destinations) if (owner === worker) this.destinations.delete(tile);
    worker.clearJob = null;
    stopAtNextSafeTile(worker.movement, this.hauling.storage.walls.cannotStop);
  }

  assignDrop(worker: ClearWorker, target: Wall, collect = false): boolean {
    if (!worker.inventory?.quantity) return false;
    const place = this.nearbyPlace(worker.movement.tile, target, worker.inventory.type, worker);
    if (!place) return false;
    this.destinations.set(key(place.goal), worker);
    worker.clearJob = { target, phase: 'drop', goal: place.goal, collect };
    setRoute(worker.movement, place.path.tiles);
    return true;
  }

  update(worker: ClearWorker): void {
    if (worker.mode !== 'automatic' || worker.dropRequested || worker.job) { this.cancel(worker); return; }
    if (worker.clearJob && worker.clearJob.target.state !== 'planned') this.cancel(worker);
    const movement = worker.movement;
    if (movement.nextTile || !sameTile(movement.tile, movement.destination)) return;
    if (!worker.clearJob) {
      const work = this.findWork(worker);
      if (!work) return;
      this.claims.set(work.target, worker);
      if (worker.inventory?.quantity) {
        if (!this.assignDrop(worker, work.target)) this.claims.delete(work.target);
      } else {
        worker.clearJob = { target: work.target, source: work.source, phase: 'pickup', goal: work.goal };
        setRoute(movement, work.path.tiles);
      }
      return;
    }
    const job = worker.clearJob;
    if (!sameTile(movement.tile, job.goal)) { this.cancel(worker); return; }
    if (job.phase === 'pickup') {
      const source = job.source!;
      if (source.quantity <= 0 || !sameTile(source, job.target)) { this.cancel(worker); return; }
      const place = this.nearbyPlace(movement.tile, job.target, source.type, worker);
      if (!place) { this.cancel(worker); return; }
      const quantity = Math.min(source.quantity, Math.floor(PAWN_CARRY_LIMIT_KG / ITEM_APPEARANCE[source.type].massKg));
      source.quantity -= quantity;
      worker.inventory = { type: source.type, quantity };
      this.assignDrop(worker, job.target, Boolean(source.collect));
      return;
    }
    if (!worker.inventory?.quantity) { this.cancel(worker); return; }
    if (!this.canPlace(job.goal, worker.inventory.type, worker)) {
      this.destinations.delete(key(job.goal));
      if (!this.assignDrop(worker, job.target, job.collect)) this.cancel(worker);
      return;
    }
    const held = worker.inventory;
    returnItems(this.items, job.goal, held.type, held.quantity);
    const stack = this.items.find(item => sameTile(item, job.goal) && item.type === held.type)!;
    if (job.collect) stack.collect = true;
    worker.inventory = null;
    this.cancel(worker);
  }
}
