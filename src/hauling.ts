import type { Clearing, ClearanceJob } from './clearing';
import type { Builder } from './construction';
import type { ItemType, MapItem } from './items';
import { ITEM_APPEARANCE, PAWN_CARRY_LIMIT_KG } from './items.ts';
import type { Tile } from './movement';
import { setRoute, stopAtNextSafeTile } from './movement.ts';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';
import type { Wall } from './walls';
import type { Storage } from './storage';

export interface HaulWorker extends Builder {
  clearJob?: ClearanceJob | null;
  haulJob?: { source?: MapItem; target: Wall; phase: 'pickup' | 'deposit'; goal: Tile } | null;
}
const sameTile = (a: Tile, b: Tile) => a.column === b.column && a.row === b.row;
export class Hauling {
  clearing?: Clearing;
  readonly claims = new Map<MapItem, HaulWorker>();
  readonly items: MapItem[];
  readonly storage: Storage;
  constructor(items: MapItem[], storage: Storage) { this.items = items; this.storage = storage; }

  cancel(worker: HaulWorker): void {
    if (worker.clearJob) this.clearing?.cancel(worker);
    const source = worker.haulJob?.source;
    if (source && this.claims.get(source) === worker) this.claims.delete(source);
    worker.haulJob = null;
    stopAtNextSafeTile(worker.movement, this.storage.walls.cannotStop);
  }

  approach(from: Tile, target: Tile, knownPaths?: Map<number, Path>): { goal: Tile; path: Path } | null {
    const walls = this.storage.walls;
    const paths = knownPaths ?? findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop);
    let best: { goal: Tile; path: Path } | null = null;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const goal = { column: target.column + dc, row: target.row + dr };
      if (goal.column < 0 || goal.row < 0 || goal.column >= walls.mapSize || goal.row >= walls.mapSize) continue;
      const path = paths.get(goal.row * walls.mapSize + goal.column);
      if (path && (!best || path.distance < best.path.distance)) best = { goal, path };
    }
    return best;
  }

  nearestBox(from: Tile, type: ItemType): { target: Wall; goal: Tile; path: Path } | null {
    const walls = this.storage.walls;
    const boxes = this.storage.boxes().filter(target => this.storage.accepts(target, type));
    if (!boxes.length) return null;
    const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop);
    let best: { target: Wall; goal: Tile; path: Path } | null = null;
    for (const target of boxes) {
      const approach = this.approach(from, target, paths);
      if (approach && (!best || approach.path.distance < best.path.distance)) best = { target, ...approach };
    }
    return best;
  }

  findWork(worker: HaulWorker): { source?: MapItem; target: Wall; goal: Tile; path: Path } | null {
    const from = worker.movement.nextTile ?? worker.movement.tile;
    if (worker.inventory?.quantity) return this.nearestBox(from, worker.inventory.type);
    if (!this.storage.boxes().length || !this.items.some(source => source.collect && source.quantity > 0 && !this.claims.has(source))) return null;
    const walls = this.storage.walls;
    const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop);
    let best: { source: MapItem; target: Wall; goal: Tile; path: Path } | null = null;
    for (const source of this.items) {
      if (!source.collect || source.quantity <= 0 || this.claims.has(source)) continue;
      const path = paths.get(source.row * walls.mapSize + source.column);
      // Harvested/dropped items may share a non-stopping object or a storage box tile.
      const approach = path ? { goal: source, path } : (!walls.isBlocked(source) || walls.items.get(`${source.column},${source.row}`)?.kind === 'storage') ? this.approach(from, source, paths) : null;
      if (!approach || (best && approach.path.distance >= best.path.distance)) continue;
      const box = this.nearestBox(approach.goal, source.type);
      if (box) best = { source, target: box.target, ...approach };
    }
    return best;
  }

  hasAvailableWork(worker: HaulWorker): boolean { return this.findWork(worker) !== null; }

  update(worker: HaulWorker): void {
    if (worker.mode !== 'automatic' || worker.dropRequested || worker.job) { if (worker.haulJob) this.cancel(worker); return; }
    const job = worker.haulJob;
    if (job && (job.phase === 'pickup' && (!job.source?.collect || job.source.quantity <= 0 || this.claims.get(job.source) !== worker)
      || !this.storage.accepts(job.target, job.phase === 'pickup' ? job.source!.type : worker.inventory?.type ?? 'wood'))) this.cancel(worker);
    const movement = worker.movement;
    if (movement.nextTile || !sameTile(movement.tile, movement.destination)) return;
    if (!worker.haulJob) {
      const work = this.findWork(worker);
      if (!work) return;
      if (work.source) this.claims.set(work.source, worker);
      worker.haulJob = { source: work.source, target: work.target, phase: work.source ? 'pickup' : 'deposit', goal: work.goal };
      setRoute(movement, work.path.tiles);
      return;
    }
    const active = worker.haulJob;
    if (!sameTile(movement.tile, active.goal)) { this.cancel(worker); return; }
    if (active.phase === 'pickup') {
      const source = active.source!;
      const quantity = Math.min(source.quantity, this.storage.capacity(active.target, source.type), Math.floor(PAWN_CARRY_LIMIT_KG / ITEM_APPEARANCE[source.type].massKg));
      worker.inventory = { type: source.type, quantity };
      source.quantity -= quantity;
      this.claims.delete(source);
      const box = this.nearestBox(movement.tile, source.type);
      if (!box) { this.cancel(worker); return; }
      worker.haulJob = { target: box.target, phase: 'deposit', goal: box.goal };
      setRoute(movement, box.path.tiles);
      return;
    }
    if (worker.inventory) {
      worker.inventory.quantity -= this.storage.deposit(active.target, worker.inventory.type, worker.inventory.quantity);
      if (!worker.inventory.quantity) worker.inventory = null;
    }
    this.cancel(worker);
  }
}
