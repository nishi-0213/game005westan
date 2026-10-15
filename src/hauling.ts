import type { Clearing, ClearanceJob } from './clearing';
import type { Builder } from './construction';
import type { ItemType, MapItem } from './items';
import { carryCapacity } from './items.ts';
import type { Movement, Tile } from './movement';
import { setRoute, stopAtNextSafeTile } from './movement.ts';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';
import type { Wall } from './walls';
import type { Storage } from './storage';

export interface HaulWorker extends Builder {
  forcedHaulSource?: MapItem | null;
  dead?: boolean;
  clearJob?: ClearanceJob | null;
  haulJob?: { source?: MapItem; target: Wall; phase: 'pickup' | 'deposit'; goal: Tile } | null;
}
const sameTile = (a: Tile, b: Tile) => a.column === b.column && a.row === b.row;
export class Hauling {
  onCommand?: (worker: HaulWorker) => void;
  clearing?: Clearing;
  readonly claims = new Map<MapItem, HaulWorker>();
  readonly items: MapItem[];
  readonly storage: Storage;
  constructor(items: MapItem[], storage: Storage) { this.items = items; this.storage = storage; }

  cancel(worker: HaulWorker): void {
    if (worker.clearJob) this.clearing?.cancel(worker);
    const source = worker.forcedHaulSource ?? worker.haulJob?.source;
    if (source && this.claims.get(source) === worker) this.claims.delete(source);
    worker.haulJob = null;
    worker.forcedHaulSource = null;
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

  nearestBox(from: Tile, type: ItemType, movement?: Movement): { target: Wall; goal: Tile; path: Path } | null {
    const walls = this.storage.walls;
    const boxes = this.storage.boxes().filter(target => this.storage.accepts(target, type));
    if (!boxes.length) return null;
    const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop, movement);
    let best: { target: Wall; goal: Tile; path: Path } | null = null;
    for (const target of boxes) {
      const approach = this.approach(from, target, paths);
      if (approach && (!best || approach.path.distance < best.path.distance)) best = { target, ...approach };
    }
    return best;
  }

  findWork(worker: HaulWorker): { source?: MapItem; target: Wall; goal: Tile; path: Path } | null {
    const from = worker.movement.nextTile ?? worker.movement.tile;
    if (worker.inventory?.quantity) return this.nearestBox(from, worker.inventory.type, worker.movement);
    if (!this.storage.boxes().length || !this.items.some(source => source.collect && source.quantity > 0 && !this.claims.has(source))) return null;
    const walls = this.storage.walls;
    const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop, worker.movement);
    let best: { source: MapItem; target: Wall; goal: Tile; path: Path } | null = null;
    for (const source of this.items) {
      if (!source.collect || source.quantity <= 0 || this.claims.has(source)) continue;
      const path = paths.get(source.row * walls.mapSize + source.column);
      // Harvested/dropped items may share a non-stopping object or a storage box tile.
      const approach = path ? { goal: source, path } : (!walls.isBlocked(source) || walls.items.get(`${source.column},${source.row}`)?.kind === 'storage') ? this.approach(from, source, paths) : null;
      if (!approach || (best && approach.path.distance >= best.path.distance)) continue;
      const box = this.nearestBox(approach.goal, source.type, worker.movement);
      if (box) best = { source, target: box.target, ...approach };
    }
    return best;
  }

  hasAvailableWork(worker: HaulWorker): boolean { return this.findWork(worker) !== null; }

  private forcedWork(worker: HaulWorker, source: MapItem): { source?: MapItem; target: Wall; goal: Tile; path: Path } | null {
    if (!this.items.includes(source) || source.quantity <= 0 || this.claims.has(source) && this.claims.get(source) !== worker) return null;
    const from = worker.movement.nextTile ?? worker.movement.tile;
    const walls = this.storage.walls;
    const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop, worker.movement);
    const path = paths.get(source.row * walls.mapSize + source.column);
    const approach = path ? { goal: source, path } : !walls.isBlocked(source) ? this.approach(from, source, paths) : null;
    if (!approach) return null;
    const box = this.nearestBox(approach.goal, source.type, worker.movement);
    if (!box) return null;
    if (worker.inventory?.quantity) return this.nearestBox(from, worker.inventory.type, worker.movement);
    return { source, target: box.target, ...approach };
  }

  canRequest(worker: HaulWorker, source: MapItem): boolean {
    return worker.mode === 'automatic' && !worker.sleep && !worker.dead && this.forcedWork(worker, source) !== null;
  }

  request(worker: HaulWorker, source: MapItem): boolean {
    if (!this.canRequest(worker, source)) return false;
    const work = this.forcedWork(worker, source)!;
    this.cancel(worker); this.onCommand?.(worker);
    worker.dropRequested = false; worker.forcedHaulSource = source;
    this.claims.set(source, worker);
    worker.haulJob = { source: work.source, target: work.target, phase: work.source ? 'pickup' : 'deposit', goal: work.goal };
    return setRoute(worker.movement, work.path.tiles);
  }

  update(worker: HaulWorker): void {
    if (worker.dead || worker.mode !== 'automatic' || worker.dropRequested || worker.job) { if (worker.haulJob || worker.forcedHaulSource) this.cancel(worker); return; }
    const job = worker.haulJob;
    if (job && (job.phase === 'pickup' && ((!job.source?.collect && worker.forcedHaulSource !== job.source) || !job.source || job.source.quantity <= 0 || this.claims.get(job.source) !== worker)
      || !this.storage.accepts(job.target, job.phase === 'pickup' ? job.source!.type : worker.inventory?.type ?? 'wood'))) this.cancel(worker);
    const movement = worker.movement;
    if (movement.nextTile || !sameTile(movement.tile, movement.destination)) return;
    if (!worker.haulJob) {
      const work = worker.forcedHaulSource ? this.forcedWork(worker, worker.forcedHaulSource) : this.findWork(worker);
      if (!work) { if (worker.forcedHaulSource) this.cancel(worker); return; }
      if (work.source) this.claims.set(work.source, worker);
      worker.haulJob = { source: work.source, target: work.target, phase: work.source ? 'pickup' : 'deposit', goal: work.goal };
      setRoute(movement, work.path.tiles);
      return;
    }
    const active = worker.haulJob;
    if (!sameTile(movement.tile, active.goal)) { this.cancel(worker); return; }
    if (active.phase === 'pickup') {
      const source = active.source!;
      const quantity = Math.min(source.quantity, this.storage.capacity(active.target, source.type), carryCapacity(worker, source.type));
      worker.inventory = { type: source.type, quantity };
      source.quantity -= quantity;
      if (worker.forcedHaulSource !== source) this.claims.delete(source);
      const box = this.nearestBox(movement.tile, source.type, movement);
      if (!box) { this.cancel(worker); return; }
      worker.haulJob = { target: box.target, phase: 'deposit', goal: box.goal };
      setRoute(movement, box.path.tiles);
      return;
    }
    if (worker.inventory) {
      worker.inventory.quantity -= this.storage.deposit(active.target, worker.inventory.type, worker.inventory.quantity);
      if (!worker.inventory.quantity) worker.inventory = null;
    }
    if (worker.forcedHaulSource && worker.forcedHaulSource.quantity > 0) {
      worker.haulJob = null;
    } else this.cancel(worker);
  }
}
