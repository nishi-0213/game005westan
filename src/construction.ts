import { canPlan } from './path-schedule.ts';
import { canGiveOrders } from './mood.ts';
import type { MapItem, ItemType } from './items';
import { carryCapacity, returnItems } from './items.ts';
import { findPath, findPaths, rankedTargets } from './pathfinding.ts';
import type { Path } from './pathfinding';
import { setRoute, stopAtNextSafeTile } from './movement.ts';
import type { Movement, Tile } from './movement';
import { BUILD_RECIPES } from './walls.ts';
import type { Wall, Walls } from './walls';
import type { Storage } from './storage';

export interface Builder {
  sleep?:import('./sleep').SleepState;
  movement: Movement;
  dead?: boolean;
  cookJob?: import('./cooking').CookingJob|null;
  butcherJob?: import('./butchery').ButcherJob | null;
  forcedCorpse?: import('./butchery').Corpse | null;
  carryingCorpse?: import('./butchery').Corpse | null;
  weapon?: 'unarmed' | 'rifle' | 'knife';
  mode: 'drafted' | 'automatic';
  inventory: { type: ItemType; quantity: number } | null;
  job: { target: Wall; phase: 'gather' | 'deliver' | 'build' | 'demolish'; source?: MapItem; goal: Tile } | null;
  retrySeconds: number;
  dropRequested?: boolean;
}
export const isBuildingPhase = (phase: string): boolean => phase === 'build' || phase === 'demolish';
export type ConstructionWork = 'all' | 'transport' | 'build';
const sameTile = (a: Tile, b: Tile) => a.column === b.column && a.row === b.row;
const adjacent = (a: Tile, b: Tile) => Math.max(Math.abs(a.column - b.column), Math.abs(a.row - b.row)) === 1;

export class Construction {
  readonly walls: Walls;
  readonly items: MapItem[];
  readonly claims = new Map<Wall, Builder>();
  readonly finish: (tile: Tile) => boolean;
  storage?: Storage;
  onCancel?: (worker: Builder) => void;
  demolish?: (tile: Tile) => boolean;
  readonly needsClearing: (tile: Tile) => boolean;

  constructor(walls: Walls, items: MapItem[], finish: (tile: Tile) => boolean, needsClearing: (tile: Tile) => boolean = () => false) {
    this.walls = walls; this.items = items; this.finish = finish;
    this.needsClearing = needsClearing;
  }

  sources(target: Wall): MapItem[] {
    if (!this.storage) return this.items;
    return this.storage.sources(target.material);
  }

  sourceApproach(from: Tile, source: MapItem, paths: Map<number, Path>): { goal: Tile; path: Path } | null {
    const path = paths.get(source.row * this.walls.mapSize + source.column);
    return path ? { goal: source, path } : this.walls.isBlocked(source) && this.walls.items.get(`${source.column},${source.row}`)?.kind === 'storage'
      ? this.approach(from, source, paths) : null;
  }

  cancel(builder: Builder): void {
    if (builder.job && this.claims.get(builder.job.target) === builder) this.claims.delete(builder.job.target);
    builder.job = null;
    builder.retrySeconds = 0;
    stopAtNextSafeTile(builder.movement, this.walls.cannotStop);
    this.onCancel?.(builder);
  }

  requestDrop(builder: Builder): void {
    if(!canGiveOrders(builder))return;
    if (!builder.inventory?.quantity && (!builder.weapon || builder.weapon === 'unarmed')) return;
    this.cancel(builder);
    builder.dropRequested = true;
  }

  path(from: Tile, to: Tile): Path | null {
    return findPath(from, to, this.walls.mapSize, this.walls.isBlocked, this.walls.cannotStop);
  }

  approach(from: Tile, target: Tile, paths?: Map<number, Path>): { goal: Tile; path: Path } | null {
    let best: { goal: Tile; path: Path } | null = null;
    for (let row = target.row - 1; row <= target.row + 1; row++) {
      for (let column = target.column - 1; column <= target.column + 1; column++) {
        if (column === target.column && row === target.row) continue;
        if (column < 0 || row < 0 || column >= this.walls.mapSize || row >= this.walls.mapSize) continue;
        const goal = { column, row };
        if (this.walls.at(goal) === target) continue;
        const path = paths ? (paths.get(row * this.walls.mapSize + column) ?? null) : this.path(from, goal);
        if (path && (!best || path.distance < best.path.distance)) best = { goal, path };
      }
    }
    return best;
  }

  nearestPlan(builder: Builder, material?: ItemType, work: ConstructionWork = 'all'): { target: Wall; goal: Tile; path: Path } | null {
    let best: { target: Wall; goal: Tile; path: Path } | null = null;
    let paths: Map<number, Path> | undefined;
    const sourcesByMaterial = new Map<ItemType, MapItem[]>();
    let bestOrder=Infinity;
    for (const {target,order,lowerBound} of rankedTargets([...this.walls.items.values()],builder.movement.tile)) {
      if(best&&lowerBound>best.path.distance+1e-10)break;
      const recipe = BUILD_RECIPES[target.kind];
      const destroying = target.state === 'completed' && target.demolition;
      if ((!destroying && target.state !== 'planned') || !recipe || this.needsClearing(target) || (material && (destroying || target.material !== material))) continue;
      const ready = destroying || target.delivered >= recipe.materialCount;
      if (work === 'build' && !ready || work === 'transport' && ready) continue;
      const owner = this.claims.get(target);
      if (owner && owner !== builder) continue;
      const needsSource = !material && !destroying && target.delivered < recipe.materialCount
        && !(builder.inventory?.type === target.material && builder.inventory.quantity > 0);
      let sources: MapItem[] = [];
      if (needsSource) {
        if (!sourcesByMaterial.has(target.material)) sourcesByMaterial.set(target.material,
          this.sources(target).filter(item => item.type === target.material && item.quantity > 0));
        sources = sourcesByMaterial.get(target.material)!;
        if (!sources.length) continue;
      }
      paths ??= findPaths(builder.movement.tile, this.walls.mapSize, this.walls.isBlocked, this.walls.cannotStop, builder.movement);
      if (needsSource && !sources.some(item => this.sourceApproach(builder.movement.tile, item, paths!))) continue;
      const approach = this.approach(builder.movement.tile, target, paths);
      if (approach && (!best || approach.path.distance < best.path.distance || approach.path.distance===best.path.distance&&order<bestOrder)) {best = { target, ...approach };bestOrder=order;}
    }
    return best;
  }

  assignDelivery(builder: Builder, work: ConstructionWork = 'all'): boolean {
    const material = builder.inventory?.quantity ? builder.inventory.type : undefined;
    const plan = this.nearestPlan(builder, material, work);
    if (!plan) return false;
    if (builder.job && this.claims.get(builder.job.target) === builder) this.claims.delete(builder.job.target);
    this.claims.set(plan.target, builder);
    const recipe = BUILD_RECIPES[plan.target.kind]!;
    builder.job = { target: plan.target, phase: plan.target.delivered >= recipe.materialCount ? 'build' : 'deliver', goal: plan.goal };
    setRoute(builder.movement, plan.path.tiles);
    return true;
  }

  update(builder: Builder, seconds: number, work: ConstructionWork = 'all'): void {
    if (builder.dropRequested) {
      if (builder.movement.nextTile || !sameTile(builder.movement.tile, builder.movement.destination)) return;
      if (builder.inventory) returnItems(this.items, builder.movement.tile, builder.inventory.type, builder.inventory.quantity);
      if (builder.weapon && builder.weapon !== 'unarmed') { returnItems(this.items, builder.movement.tile, builder.weapon, 1); builder.weapon = 'unarmed'; }
      builder.inventory = null;
      builder.dropRequested = false;
      builder.retrySeconds = 0.25;
      return;
    }
    if (builder.mode !== 'automatic') { if (builder.job) this.cancel(builder); return; }
    if (builder.job && this.needsClearing(builder.job.target)) { this.cancel(builder); return; }
    if (builder.job && (builder.job.phase === 'demolish' ? builder.job.target.state !== 'completed' || !builder.job.target.demolition : builder.job.target.state !== 'planned')) this.cancel(builder);
    if (builder.job && this.claims.get(builder.job.target) !== builder) this.cancel(builder);
    const movement = builder.movement;
    if (movement.nextTile || !sameTile(movement.tile, movement.destination)) return;
    if (!builder.job) {
      builder.retrySeconds -= seconds;
      if (builder.retrySeconds > 0 || !canPlan(movement)) return;
      builder.retrySeconds = 0.25;
      const plan = this.nearestPlan(builder, undefined, work);
      if (!plan) return;
      const recipe = BUILD_RECIPES[plan.target.kind]!;
      if (plan.target.demolition || plan.target.delivered >= recipe.materialCount) {
        this.claims.set(plan.target, builder);
        builder.job = { target: plan.target, phase: plan.target.demolition ? 'demolish' : 'build', goal: plan.goal };
        setRoute(movement, plan.path.tiles);
        return;
      }
      if (builder.inventory?.quantity && builder.inventory.type === plan.target.material) { this.assignDelivery(builder, work); return; }
      if (builder.inventory?.quantity) {
        const held = builder.inventory;
        returnItems(this.items, movement.tile, held.type, held.quantity);
        builder.inventory = null;
      }
      let source: { item: MapItem; path: Path; goal: Tile } | null = null;
      const paths = findPaths(movement.tile, this.walls.mapSize, this.walls.isBlocked, this.walls.cannotStop, builder.movement);
      let sourceOrder=Infinity;
      const supplies=this.sources(plan.target).filter(item=>item.quantity>0&&item.type===plan.target.material);
      for (const {target:item,order,lowerBound} of rankedTargets(supplies,movement.tile)) {
        if(source&&lowerBound>source.path.distance+1e-10)break;
        const approach = this.sourceApproach(movement.tile, item, paths);
        if (approach && (!source || approach.path.distance < source.path.distance || approach.path.distance===source.path.distance&&order<sourceOrder)) {source = { item, ...approach };sourceOrder=order;}
      }
      if (!source) return;
      this.claims.set(plan.target, builder);
      builder.job = { target: plan.target, phase: 'gather', source: source.item, goal: source.goal };
      setRoute(movement, source.path.tiles);
      return;
    }
    const job = builder.job;
    if (!sameTile(movement.tile, job.goal)) { this.cancel(builder); return; }
    if (job.phase === 'gather') {
      if(!canPlan(movement))return;
      const source = job.source!;
      if (source.quantity <= 0) { this.cancel(builder); return; }
      const quantity = Math.min(source.quantity, carryCapacity(builder, source.type));
      builder.inventory = { type: source.type, quantity };
      source.quantity -= quantity;
      if (!this.assignDelivery(builder, work)) this.cancel(builder);
      return;
    }
    if (!adjacent(movement.tile, job.target)) { this.cancel(builder); return; }
    const recipe = BUILD_RECIPES[job.target.kind]!;
    if (job.phase === 'deliver') {
      if (job.target.delivered >= recipe.materialCount) { if (work === 'transport') this.cancel(builder); else job.phase = 'build'; return; }
      if (!builder.inventory?.quantity || builder.inventory.type !== job.target.material) { builder.inventory = null; this.cancel(builder); return; }
      // Transfer and consume exactly one material unit per operation.
      builder.inventory.quantity -= 1;
      job.target.delivered += 1;
      if (!builder.inventory.quantity) builder.inventory = null;
      if (job.target.delivered >= recipe.materialCount) { if (work === 'transport') this.cancel(builder); else job.phase = 'build'; }
      return;
    }
    if (job.phase === 'demolish') {
      job.target.demolitionSeconds = Math.min(recipe.seconds, (job.target.demolitionSeconds ?? 0) + seconds);
      if (job.target.demolitionSeconds >= recipe.seconds && this.demolish?.(job.target)) this.cancel(builder);
      return;
    }
    job.target.workSeconds = Math.min(recipe.seconds, job.target.workSeconds + seconds);
    if (job.target.workSeconds >= recipe.seconds && this.finish(job.target)) this.cancel(builder);
  }
}
