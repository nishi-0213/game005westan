import { canPlan } from './path-schedule.ts';
import { canGiveOrders } from './mood.ts';
import type { EatingWorker } from './needs';
import type { Builder } from './construction';
import type { Construction } from './construction';
import type { Hauling } from './hauling';
import type { MapItem } from './items';
import { returnItems } from './items.ts';
import type { Tile } from './movement';
import { renderedPosition, setRoute, stopAtNextSafeTile } from './movement.ts';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';
import type { Wall } from './walls';

export type Corpse = EatingWorker;
export interface ButcherState {
  mode: 'count' | 'until' | 'forever';
  remaining: number;
  target: number;
  seconds: number;
  corpse?: Corpse;
}
export interface ButcherJob { station: Wall; phase: 'pickup' | 'carry' | 'store' | 'process'; corpse: Corpse; goal: Tile; fromStorage?: boolean }
export const BUTCHER_SECONDS = 5;
export const MEAT_YIELD = 10;
const sameTile = (a: Tile, b: Tile): boolean => a.column === b.column && a.row === b.row;
export function corpsePosition(corpse: Corpse): Tile {
  if (corpse.corpseCarrier) { const position = renderedPosition(corpse.corpseCarrier.movement); return { column: position.column + .2, row: position.row + .2 }; }
  return corpse.corpseStation ?? corpse.corpseStorage ?? corpse.deadPosition ?? corpse.movement.tile;
}
export function corpseItemType(corpse: Corpse): 'humanCorpse' | 'deerCorpse' | 'wolfCorpse' {
  return 'kind' in corpse && corpse.kind === 'deer' ? 'deerCorpse' : 'kind' in corpse && corpse.kind === 'wolf' ? 'wolfCorpse' : 'humanCorpse';
}
export function adjustButcherCount(state: ButcherState, amount: number): void {
  state.mode = 'count'; state.remaining = Math.max(0, Math.min(99, state.remaining + amount));
}

export class Butchery {
  readonly construction: Construction;
  readonly hauling: Hauling;
  readonly corpses: () => readonly Corpse[];
  readonly workers: () => readonly Builder[];
  readonly claims = new Map<Wall, Builder>();
  readonly corpseClaims = new Map<Corpse, Builder>();
  onPickup?: (corpse: Corpse) => void;
  onDrop?: (corpse: Corpse) => void;
  onConsume?: (corpse: Corpse) => void;
  constructor(construction: Construction, hauling: Hauling, corpses: () => readonly Corpse[], workers: () => readonly Builder[]) {
    this.construction = construction; this.hauling = hauling; this.corpses = corpses; this.workers = workers;
  }
  meatStock(): number {
    return this.construction.items.reduce((total, item) => total + (item.type === 'meat' ? item.quantity : 0), 0)
      + (this.construction.storage?.totals().meat ?? 0)
      + this.workers().filter(worker=>!worker.dead).reduce((total, worker) => total + (worker.inventory?.type === 'meat' ? worker.inventory.quantity : 0), 0);
  }
  wantsWork(station: Wall): boolean {
    const state = station.butcher;
    return station.state === 'completed' && Boolean(state && (state.mode === 'forever' || state.mode === 'count' && state.remaining > 0 || state.mode === 'until' && this.meatStock() < state.target));
  }
  private stations(): Wall[] { return [...this.construction.walls.items.values()].filter(station => station.kind === 'butcher' && this.wantsWork(station)); }
  private paths(worker: Builder) {
    const walls = this.construction.walls;
    return findPaths(worker.movement.nextTile ?? worker.movement.tile, walls.mapSize, walls.isBlocked, walls.cannotStop, worker.movement);
  }
  findTransport(worker: Builder, only?: Corpse): { station: Wall; corpse: Corpse; goal: Tile; path: Path } | null {
    const stations = this.stations().filter(station => !station.butcher?.corpse && (!this.claims.has(station) || this.claims.get(station) === worker));
    const corpses = this.corpses().filter(corpse => corpse.dead && (only ? corpse===only : corpse.collectCorpse || corpse.corpseStorage) && !corpse.consumed && !corpse.corpseEater && !corpse.corpseCarrier && !corpse.corpseStation && !this.corpseClaims.has(corpse));
    if (!stations.length || !corpses.length) return null;
    const paths = this.paths(worker), from = worker.movement.nextTile ?? worker.movement.tile;
    let best: { station: Wall; corpse: Corpse; goal: Tile; path: Path } | null = null;
    for (const station of stations) {
      if (!this.construction.approach(from, station, paths)) continue;
      for (const corpse of corpses) {
        const position = corpse.corpseStorage ?? corpse.movement.tile;
        const path = paths.get(position.row * this.construction.walls.mapSize + position.column);
        const approach = path ? { goal: position, path } : this.hauling.approach(from, position, paths);
        if (approach && (!best || approach.path.distance < best.path.distance)) best = { station, corpse, ...approach };
      }
    }
    return best;
  }
  findStorage(worker: Builder, only?: Corpse): { station: Wall; corpse: Corpse; goal: Tile; path: Path } | null {
    if (!this.hauling.storage.boxes().length) return null;
    const bodies = this.corpses().filter(body => body.dead && (only ? body===only : body.collectCorpse) && !body.consumed && !body.corpseEater && !body.corpseCarrier && !body.corpseStation && !body.corpseStorage && !this.corpseClaims.has(body));
    if (!bodies.length) return null;
    const paths = this.paths(worker), from = worker.movement.nextTile ?? worker.movement.tile;
    let best: { station: Wall; corpse: Corpse; goal: Tile; path: Path } | null = null;
    for (const corpse of bodies) {
      const position=corpse.movement.tile;
      const direct=paths.get(position.row*this.construction.walls.mapSize+position.column);
      const approach=direct?{goal:position,path:direct}:this.hauling.approach(from,position,paths);
      if (!approach || best && approach.path.distance>=best.path.distance) continue;
      const box=this.hauling.nearestBox(approach.goal,corpseItemType(corpse),worker.movement);
      if (box) best={station:box.target,corpse,...approach};
    }
    return best;
  }
  findProcessing(worker: Builder): { station: Wall; corpse: Corpse; goal: Tile; path: Path } | null {
    const stations = this.stations().filter(station => station.butcher?.corpse && (!this.claims.has(station) || this.claims.get(station) === worker));
    if (!stations.length) return null;
    const paths = this.paths(worker), from = worker.movement.nextTile ?? worker.movement.tile;
    let best: { station: Wall; corpse: Corpse; goal: Tile; path: Path } | null = null;
    for (const station of stations) {
      const approach = this.construction.approach(from, station, paths);
      if (approach && (!best || approach.path.distance < best.path.distance)) best = { station, corpse: station.butcher!.corpse!, ...approach };
    }
    return best;
  }
  canRequest(worker: Builder, corpse: Corpse): boolean {
    return canGiveOrders(worker) && !worker.dead && !worker.sleep && worker.mode==='automatic' && Boolean(this.findTransport(worker,corpse)??this.findStorage(worker,corpse));
  }
  request(worker: Builder, corpse: Corpse): boolean {
    if(!this.canRequest(worker,corpse))return false;
    const found=(this.findTransport(worker,corpse)??this.findStorage(worker,corpse))!;
    this.hauling.cancel(worker); this.hauling.onCommand?.(worker); this.cancel(worker);
    worker.dropRequested=false;worker.forcedCorpse=corpse;
    if(found.station.kind==='butcher')this.claims.set(found.station,worker);
    this.corpseClaims.set(corpse,worker);
    worker.butcherJob={station:found.station,corpse,goal:found.goal,phase:'pickup',fromStorage:Boolean(corpse.corpseStorage)};
    return setRoute(worker.movement,found.path.tiles);
  }
  cancel(worker: Builder): void {
    const job = worker.butcherJob;
    if (job && this.claims.get(job.station) === worker) this.claims.delete(job.station);
    if (job && this.corpseClaims.get(job.corpse) === worker) this.corpseClaims.delete(job.corpse);
    worker.butcherJob = null; worker.forcedCorpse = null;
    if (worker.carryingCorpse) this.dropCorpse(worker);
    stopAtNextSafeTile(worker.movement, this.construction.walls.cannotStop);
  }
  dropCorpse(worker: Builder): boolean {
    const corpse = worker.carryingCorpse;
    if (!corpse) return true;
    const paths = this.paths(worker), walls = this.construction.walls;
    const origin = worker.movement.nextTile ?? worker.movement.tile;
    for (const [index] of paths) {
      const tile = { column: index % walls.mapSize, row: Math.floor(index / walls.mapSize) };
      if (sameTile(tile, worker.movement.tile) || sameTile(tile, origin) || sameTile(tile, worker.movement.destination)) continue;
      corpse.corpseCarrier = undefined; corpse.corpseStation = undefined; corpse.corpseStorage = undefined;
      corpse.deadPosition = { ...tile }; corpse.movement.tile = { ...tile }; corpse.movement.destination = { ...tile };
      corpse.movement.nextTile = null; corpse.movement.route = []; corpse.movement.progress = 0;
      worker.carryingCorpse = null; this.corpseClaims.delete(corpse); this.onDrop?.(corpse);
      return true;
    }
    return false;
  }
  update(worker: Builder, seconds: number, work: 'transport' | 'process'): void {
    if (worker.dead || worker.mode !== 'automatic' || worker.dropRequested) { this.cancel(worker); return; }
    const movement = worker.movement;
    if (worker.carryingCorpse && !worker.butcherJob && (!canPlan(worker.movement)||!this.dropCorpse(worker))) return;
    const active = worker.butcherJob;
    if (active && ((active.station.kind === 'butcher' ? !this.wantsWork(active.station) || this.claims.get(active.station) !== worker : !this.hauling.storage.accepts(active.station,corpseItemType(active.corpse))) || active.corpse.consumed || !active.corpse.collectCorpse && worker.forcedCorpse!==active.corpse && !active.corpse.corpseStation && !active.fromStorage
      || (work === 'transport') !== (active.phase !== 'process'))) { this.cancel(worker); return; }
    if (movement.nextTile || !sameTile(movement.tile, movement.destination)) return;
    if (!worker.butcherJob) {
      if(!canPlan(movement))return;
      const found = work === 'transport' ? this.findTransport(worker) ?? this.findStorage(worker) : this.findProcessing(worker);
      if (!found) return;
      if (found.station.kind==='butcher') this.claims.set(found.station, worker);
      if (work === 'transport') this.corpseClaims.set(found.corpse, worker);
      worker.butcherJob = { station: found.station, corpse: found.corpse, goal: found.goal, phase: work === 'transport' ? 'pickup' : 'process', fromStorage:Boolean(found.corpse.corpseStorage) };
      setRoute(movement, found.path.tiles); return;
    }
    const job = worker.butcherJob;
    if (!sameTile(movement.tile, job.goal)) { this.cancel(worker); return; }
    const state = job.station.butcher!;
    if (job.phase === 'pickup') {
      if(!canPlan(movement))return;
      if (job.corpse.corpseCarrier || job.corpse.corpseStation || !job.corpse.dead) { this.cancel(worker); return; }
      const approach = this.construction.approach(movement.tile, job.station, this.paths(worker));
      if (!approach) { this.cancel(worker); return; }
      this.hauling.storage.withdrawCorpse(job.corpse,corpseItemType(job.corpse));
      worker.carryingCorpse = job.corpse; job.corpse.corpseCarrier = worker; this.onPickup?.(job.corpse);
      job.phase = job.station.kind==='butcher'?'carry':'store'; job.goal = approach.goal; setRoute(movement, approach.path.tiles); return;
    }
    if (job.phase === 'store') {
      if (!this.hauling.storage.depositCorpse(job.station,job.corpse,corpseItemType(job.corpse))) { this.cancel(worker); return; }
      worker.carryingCorpse=null; worker.forcedCorpse=null; this.corpseClaims.delete(job.corpse); worker.butcherJob=null; return;
    }
    if (job.phase === 'carry') {
      job.corpse.corpseCarrier = undefined; job.corpse.corpseStation = job.station; job.corpse.deadPosition = { column: job.station.column, row: job.station.row };
      state.corpse = job.corpse; worker.carryingCorpse = null; worker.forcedCorpse = null;
      this.corpseClaims.delete(job.corpse); this.claims.delete(job.station); worker.butcherJob = null; return;
    }
    if (state.corpse !== job.corpse || Math.max(Math.abs(movement.tile.column-job.station.column),Math.abs(movement.tile.row-job.station.row)) !== 1) { this.cancel(worker); return; }
    state.seconds = Math.min(BUTCHER_SECONDS, state.seconds + Math.max(0, seconds));
    if (state.seconds < BUTCHER_SECONDS - 1e-9) return;
    returnItems(this.construction.items, movement.tile, 'meat', MEAT_YIELD);
    const meat = this.construction.items.find(item => item.type === 'meat' && sameTile(item,movement.tile))!; meat.collect = true;
    if (job.corpse.inventory) returnItems(this.construction.items, movement.tile, job.corpse.inventory.type, job.corpse.inventory.quantity);
    if (job.corpse.weapon && job.corpse.weapon !== 'unarmed') returnItems(this.construction.items, movement.tile, job.corpse.weapon, 1);
    job.corpse.inventory = null; job.corpse.weapon = 'unarmed'; job.corpse.consumed = true; job.corpse.corpseStation = undefined;
    state.corpse = undefined; state.seconds = 0;
    if (state.mode === 'count') state.remaining = Math.max(0,state.remaining-1);
    this.onConsume?.(job.corpse); this.claims.delete(job.station); worker.butcherJob = null;
  }
}
