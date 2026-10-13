import type { MapItem, ItemType } from './items';
import { ITEM_APPEARANCE, PAWN_CARRY_LIMIT_KG, returnItems } from './items.ts';
import { findPath, findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';
import { setRoute, stopAtNextSafeTile } from './movement.ts';
import type { Movement, Tile } from './movement';
import { BUILD_RECIPES } from './walls.ts';
import type { Wall, Walls } from './walls';

export interface Builder {
  movement: Movement;
  mode: 'drafted' | 'automatic';
  inventory: { type: ItemType; quantity: number } | null;
  job: { target: Wall; phase: 'gather' | 'deliver' | 'build'; source?: MapItem; goal: Tile } | null;
  retrySeconds: number;
  dropRequested?: boolean;
}
const sameTile = (a: Tile, b: Tile) => a.column === b.column && a.row === b.row;
const adjacent = (a: Tile, b: Tile) => Math.max(Math.abs(a.column - b.column), Math.abs(a.row - b.row)) === 1;

export class Construction {
  readonly walls: Walls;
  readonly items: MapItem[];
  readonly claims = new Map<Wall, Builder>();
  readonly finish: (tile: Tile) => boolean;

  constructor(walls: Walls, items: MapItem[], finish: (tile: Tile) => boolean) {
    this.walls = walls; this.items = items; this.finish = finish;
  }

  cancel(builder: Builder): void {
    if (builder.job && this.claims.get(builder.job.target) === builder) this.claims.delete(builder.job.target);
    builder.job = null;
    builder.retrySeconds = 0;
    stopAtNextSafeTile(builder.movement, this.walls.cannotStop);
  }

  requestDrop(builder: Builder): void {
    if (!builder.inventory?.quantity) return;
    this.cancel(builder);
    builder.dropRequested = true;
  }

  path(from: Tile, to: Tile): Path | null {
    return findPath(from, to, this.walls.mapSize, this.walls.isBlocked, this.walls.cannotStop);
  }

  approach(from: Tile, target: Wall, paths?: Map<number, Path>): { goal: Tile; path: Path } | null {
    let best: { goal: Tile; path: Path } | null = null;
    for (let row = target.row - 1; row <= target.row + 1; row++) {
      for (let column = target.column - 1; column <= target.column + 1; column++) {
        if (column === target.column && row === target.row) continue;
        if (column < 0 || row < 0 || column >= this.walls.mapSize || row >= this.walls.mapSize) continue;
        const goal = { column, row };
        const path = paths ? (paths.get(row * this.walls.mapSize + column) ?? null) : this.path(from, goal);
        if (path && (!best || path.distance < best.path.distance)) best = { goal, path };
      }
    }
    return best;
  }

  nearestPlan(builder: Builder, material?: ItemType): { target: Wall; goal: Tile; path: Path } | null {
    let best: { target: Wall; goal: Tile; path: Path } | null = null;
    const paths = findPaths(builder.movement.tile, this.walls.mapSize, this.walls.isBlocked, this.walls.cannotStop);
    for (const target of this.walls.items.values()) {
      const recipe = BUILD_RECIPES[target.kind];
      if (target.state !== 'planned' || !recipe || (material && target.material !== material)) continue;
      const owner = this.claims.get(target);
      if (owner && owner !== builder) continue;
      if (!material && target.delivered < recipe.materialCount
        && !(builder.inventory?.type === target.material && builder.inventory.quantity > 0)
        && !this.items.some((item) => item.type === target.material && item.quantity > 0 && paths.has(item.row * this.walls.mapSize + item.column))) continue;
      const approach = this.approach(builder.movement.tile, target, paths);
      if (approach && (!best || approach.path.distance < best.path.distance)) best = { target, ...approach };
    }
    return best;
  }

  assignDelivery(builder: Builder): boolean {
    const material = builder.inventory?.quantity ? builder.inventory.type : undefined;
    const plan = this.nearestPlan(builder, material);
    if (!plan) return false;
    if (builder.job && this.claims.get(builder.job.target) === builder) this.claims.delete(builder.job.target);
    this.claims.set(plan.target, builder);
    const recipe = BUILD_RECIPES[plan.target.kind]!;
    builder.job = { target: plan.target, phase: plan.target.delivered >= recipe.materialCount ? 'build' : 'deliver', goal: plan.goal };
    setRoute(builder.movement, plan.path.tiles);
    return true;
  }

  update(builder: Builder, seconds: number): void {
    if (builder.dropRequested) {
      if (builder.movement.nextTile || !sameTile(builder.movement.tile, builder.movement.destination)) return;
      if (builder.inventory) returnItems(this.items, builder.movement.tile, builder.inventory.type, builder.inventory.quantity);
      builder.inventory = null;
      builder.dropRequested = false;
      builder.retrySeconds = 0.25;
      return;
    }
    if (builder.mode !== 'automatic') { if (builder.job) this.cancel(builder); return; }
    if (builder.job && builder.job.target.state !== 'planned') this.cancel(builder);
    if (builder.job && this.claims.get(builder.job.target) !== builder) this.cancel(builder);
    const movement = builder.movement;
    if (movement.nextTile || !sameTile(movement.tile, movement.destination)) return;
    if (!builder.job) {
      builder.retrySeconds -= seconds;
      if (builder.retrySeconds > 0) return;
      builder.retrySeconds = 0.25;
      const plan = this.nearestPlan(builder);
      if (!plan) return;
      const recipe = BUILD_RECIPES[plan.target.kind]!;
      if (plan.target.delivered >= recipe.materialCount) {
        this.claims.set(plan.target, builder);
        builder.job = { target: plan.target, phase: 'build', goal: plan.goal };
        setRoute(movement, plan.path.tiles);
        return;
      }
      if (builder.inventory?.quantity && builder.inventory.type === plan.target.material) { this.assignDelivery(builder); return; }
      if (builder.inventory?.quantity) {
        const held = builder.inventory;
        returnItems(this.items, movement.tile, held.type, held.quantity);
        builder.inventory = null;
      }
      let source: { item: MapItem; path: Path } | null = null;
      const paths = findPaths(movement.tile, this.walls.mapSize, this.walls.isBlocked, this.walls.cannotStop);
      for (const item of this.items) {
        if (item.quantity <= 0 || item.type !== plan.target.material) continue;
        const path = paths.get(item.row * this.walls.mapSize + item.column);
        if (path && (!source || path.distance < source.path.distance)) source = { item, path };
      }
      if (!source) return;
      this.claims.set(plan.target, builder);
      builder.job = { target: plan.target, phase: 'gather', source: source.item, goal: source.item };
      setRoute(movement, source.path.tiles);
      return;
    }
    const job = builder.job;
    if (!sameTile(movement.tile, job.goal)) { this.cancel(builder); return; }
    if (job.phase === 'gather') {
      const source = job.source!;
      if (source.quantity <= 0) { this.cancel(builder); return; }
      const quantity = Math.min(source.quantity, Math.floor(PAWN_CARRY_LIMIT_KG / ITEM_APPEARANCE[source.type].massKg));
      builder.inventory = { type: source.type, quantity };
      source.quantity -= quantity;
      if (!this.assignDelivery(builder)) this.cancel(builder);
      return;
    }
    if (!adjacent(movement.tile, job.target)) { this.cancel(builder); return; }
    const recipe = BUILD_RECIPES[job.target.kind]!;
    if (job.phase === 'deliver') {
      if (job.target.delivered >= recipe.materialCount) { job.phase = 'build'; return; }
      if (!builder.inventory?.quantity || builder.inventory.type !== job.target.material) { builder.inventory = null; this.cancel(builder); return; }
      // Transfer and consume exactly one material unit per operation.
      builder.inventory.quantity -= 1;
      job.target.delivered += 1;
      if (!builder.inventory.quantity) builder.inventory = null;
      if (job.target.delivered >= recipe.materialCount) job.phase = 'build';
      return;
    }
    job.target.workSeconds = Math.min(recipe.seconds, job.target.workSeconds + seconds);
    if (job.target.workSeconds >= recipe.seconds && this.finish(job.target)) this.cancel(builder);
  }
}
