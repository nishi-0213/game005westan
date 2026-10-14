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

export interface Deer extends EatingWorker, FactionMember {
  kind: 'deer';
  id: number;
  freeSeconds: number;
  leaving: boolean;
  departed: boolean;
  exitGoal?: Tile;
  outsideGoal?: Tile;
  decisionSeconds: number;
  fleeGoal?: Tile;
}
export const DEER_FLEE_DISTANCE = 8;
const sameTile = (a: Tile, b: Tile): boolean => a.column === b.column && a.row === b.row;
const berries = (object: EnvironmentObject): boolean => object.type === 'wildStrawberry' && harvestYield(object) > 0;
export function createDeer(tile: Tile, id: number): Deer {
  return { kind: 'deer', id, faction: 'wild', movement: createMovement(tile), mode: 'automatic', inventory: null,
    job: null, retrySeconds: 0, harvestJob: null, harvestRetrySeconds: 0, needs: initialNeeds(), hp: 100, eatJob: null,
    freeSeconds: 0, leaving: false, departed: false, decisionSeconds: 0 };
}

export function deerAction(deer: Deer): string {
  if (deer.dead) return '死亡';
  if (deer.fleeGoal) return '逃走中';
  if (deer.leaving) return 'マップ外へ移動中';
  if (deer.eatJob) return '食事中';
  if (deer.harvestJob) return deer.movement.nextTile || !sameTile(deer.movement.tile, deer.movement.destination) ? '収集へ移動中' : '収集中';
  return '自由';
}

export class Wildlife {
  readonly deer: Deer[] = [];
  readonly construction: Construction;
  readonly harvesting: Harvesting;
  readonly hauling: Hauling;
  readonly random: () => number;
  onSpawn?: (deer: Deer) => void;
  onDepart?: (deer: Deer) => void;
  private nextId = 1;
  private spawnSeconds = 0;
  private exitSeconds: number;
  constructor(construction: Construction, harvesting: Harvesting, hauling: Hauling, random: () => number = Math.random) {
    this.construction = construction; this.harvesting = harvesting; this.hauling = hauling; this.random = random;
    this.exitSeconds = this.interval();
  }
  private interval(): number { return 50 + this.random() * 20; }
  private count(): number { return 2 + Math.floor(this.random() * 2); }

  update(seconds: number, occupied: (tile: Tile) => boolean = () => false): void {
    if (seconds <= 0) return;
    this.spawnSeconds -= seconds;
    this.exitSeconds -= seconds;
    if (this.spawnSeconds <= 0) { this.spawn(occupied); this.spawnSeconds += this.interval(); }
    if (this.exitSeconds <= 0) {
      const candidates = this.deer.filter(deer => !deer.dead && !deer.leaving && !deer.departed);
      const count = this.count();
      for (let i = 0; i < count && candidates.length; i++) this.markForExit(candidates.splice(Math.floor(this.random() * candidates.length), 1)[0]);
      this.exitSeconds += this.interval();
    }
    for (let index = this.deer.length - 1; index >= 0; index--) {
      const deer = this.deer[index];
      this.updateDeer(deer, seconds);
      if (deer.departed) { this.onDepart?.(deer); this.deer.splice(index, 1); }
    }
  }

  private spawn(occupied: (tile: Tile) => boolean): void {
    const walls = this.construction.walls, candidates: Tile[] = [];
    for (let row = 0; row < walls.mapSize; row++) for (let column = 0; column < walls.mapSize; column++) {
      if (column !== 0 && row !== 0 && column !== walls.mapSize - 1 && row !== walls.mapSize - 1) continue;
      const tile = { column, row };
      if (!walls.at(tile) && !walls.isBlocked(tile) && !walls.cannotStop(tile) && !occupied(tile)
        && !this.deer.some(deer => sameTile(deer.movement.tile, tile) || sameTile(deer.movement.destination, tile))) candidates.push(tile);
    }
    const count = this.count();
    for (let i = 0; i < count && candidates.length; i++) {
      const tile = candidates.splice(Math.floor(this.random() * candidates.length), 1)[0];
      const deer = createDeer(tile, this.nextId++);
      this.deer.push(deer);
      this.onSpawn?.(deer);
    }
  }

  markForExit(deer: Deer): void {
    if (deer.dead || deer.departed || deer.leaving) return;
    if (deer.fleeGoal) { deer.leaving = true; return; }
    this.harvesting.cancel(deer);
    deer.eatJob = null;
    deer.leaving = true;
    deer.decisionSeconds = 0;
  }

  flee(deer: Deer, attacker: Tile): boolean {
    if (deer.dead || deer.departed) return false;
    const walls = this.construction.walls;
    const start = deer.movement.nextTile ?? deer.movement.tile;
    let dc = start.column - attacker.column, dr = start.row - attacker.row;
    if (!dc && !dr) { dc = 1; dr = 0; }
    const length = Math.hypot(dc, dr);
    const desired = { column: start.column + dc / length * DEER_FLEE_DISTANCE, row: start.row + dr / length * DEER_FLEE_DISTANCE };
    const paths = findPaths(start, walls.mapSize, walls.isBlocked, walls.cannotStop, deer.movement);
    let best: { goal: Tile; path: Path; error: number } | null = null;
    let lateral: { goal: Tile; path: Path; error: number; radialError: number } | null = null;
    for (const [index, path] of paths) {
      const goal = { column: index % walls.mapSize, row: Math.floor(index / walls.mapSize) };
      const projection = (goal.column - start.column) * dc + (goal.row - start.row) * dr;
      const distance = Math.hypot(goal.column - start.column, goal.row - start.row);
      if (projection < 0 || !distance || distance > DEER_FLEE_DISTANCE + 1e-9) continue;
      const error = Math.hypot(goal.column - desired.column, goal.row - desired.row);
      if (projection === 0) {
        const radialError = Math.abs(DEER_FLEE_DISTANCE - distance);
        if (!lateral || radialError < lateral.radialError || radialError === lateral.radialError && error < lateral.error) lateral = { goal, path, error, radialError };
        continue;
      }
      if (!best || error < best.error || error === best.error && path.distance < best.path.distance) best = { goal, path, error };
    }
    best ??= lateral;
    if (!best) return false;
    this.harvesting.cancel(deer); this.hauling.cancel(deer); this.construction.cancel(deer);
    deer.eatJob = null; deer.freeSeconds = 0;
    deer.fleeGoal = best.goal;
    return setRoute(deer.movement, best.path.tiles);
  }

  updateDeer(deer: Deer, seconds: number): void {
    if (deer.dead || deer.departed) return;
    const walls = this.construction.walls;
    const eating = updateNeeds(deer, this.construction, this.harvesting, this.hauling, seconds, false);
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
        deer.decisionSeconds -= seconds;
        if (deer.decisionSeconds <= 0) {
          deer.decisionSeconds = .25;
          const work = this.harvesting.findWork(deer, berries);
          if (work) {
            stopAtNextSafeTile(deer.movement, walls.cannotStop);
            this.harvesting.claims.set(work.target, deer);
            deer.harvestJob = { target: work.target, goal: work.goal };
            setRoute(deer.movement, work.path.tiles);
          }
        }
      }
      if (deer.harvestJob) {
        const harvested = this.harvesting.update(deer, seconds, berries);
        if (harvested) this.eatHarvest(deer, harvested);
        return;
      }
    }
    updateRoaming(deer, walls, seconds, this.random);
  }

  private eatHarvest(deer: Deer, target: EnvironmentObject): void {
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

  private updateExit(deer: Deer, seconds: number): void {
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
    if (deer.decisionSeconds > 0) return;
    deer.decisionSeconds = .25;
    const paths = findPaths(movement.tile, walls.mapSize, walls.isBlocked, walls.cannotStop, movement);
    let best: { goal: Tile; path: Path } | undefined;
    for (const [index, path] of paths) {
      const column = index % walls.mapSize, row = Math.floor(index / walls.mapSize);
      if (column !== 0 && row !== 0 && column !== walls.mapSize - 1 && row !== walls.mapSize - 1) continue;
      if (!best || path.distance < best.path.distance) best = { goal: { column, row }, path };
    }
    if (best) { deer.exitGoal = best.goal; setRoute(movement, best.path.tiles); }
  }
}
