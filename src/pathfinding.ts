import type { Movement, Tile } from './movement';
import { advanceMovement, setRoute } from './movement.ts';

export interface Path { tiles: Tile[]; distance: number }
type TileRule = (tile: Tile) => boolean;
const caches = new WeakMap<TileRule, WeakMap<TileRule, Map<string, Map<number, Path>>>>();
export function registerPathCache(blocked: TileRule): void { caches.set(blocked, new WeakMap()); }
export function invalidatePaths(blocked: TileRule): void { if (caches.has(blocked)) caches.set(blocked, new WeakMap()); }

// Keep terrain searches shared; occupancy only filters possible stopping points.
class AvailablePaths extends Map<number, Path> {
  private paths: Map<number, Path>;
  private movement: Movement;
  private mapSize: number;
  constructor(paths: Map<number, Path>, movement: Movement, size: number) {
    super(); this.paths = paths; this.movement = movement; this.mapSize = size;
  }
  override get(index: number): Path | undefined {
    if (this.movement.stopBlocked?.({ column: index % this.mapSize, row: Math.floor(index / this.mapSize) })) return undefined;
    return this.paths.get(index);
  }
  override has(index: number): boolean { return this.get(index) !== undefined; }
  override *entries(): MapIterator<[number, Path]> { for (const [index, path] of this.paths) if (this.has(index)) yield [index, path]; }
  override *keys(): MapIterator<number> { for (const [index] of this.entries()) yield index; }
  override *values(): MapIterator<Path> { for (const [, path] of this.entries()) yield path; }
  override [Symbol.iterator](): MapIterator<[number, Path]> { return this.entries(); }
  override get size(): number { let count = 0; for (const _ of this.keys()) count++; return count; }
  override forEach(callback: (value: Path, key: number, map: Map<number, Path>) => void, thisArg?: unknown): void {
    for (const [index, path] of this) callback.call(thisArg, path, index, this);
  }
}

export function findPaths(start: Tile, size: number, blocked: TileRule, cannotStop: TileRule, movement?: Movement): Map<number, Path> {
  if (movement?.stopBlocked) return new AvailablePaths(findPaths(start, size, blocked, cannotStop), movement, size);
  const cache = caches.get(blocked);
  let policy = cache?.get(cannotStop);
  if (cache && !policy) { policy = new Map(); cache.set(cannotStop, policy); }
  const cacheKey = `${size}:${start.column},${start.row}`;
  const cached = policy?.get(cacheKey);
  if (cached) { policy!.delete(cacheKey); policy!.set(cacheKey, cached); return cached; }
  const result = new Map<number, Path>();
  const key = ({ column, row }: Tile) => row * size + column;
  const distances = new Map<number, number>([[key(start), 0]]);
  const previous = new Map<number, Tile>();
  const open: { tile: Tile; cost: number; order: number }[] = [];
  let order = 0;
  const less = (a: (typeof open)[number], b: (typeof open)[number]) => a.cost < b.cost || a.cost === b.cost && a.order < b.order;
  const push = (tile: Tile, cost: number) => {
    const node = { tile, cost, order: order++ }; open.push(node);
    let index = open.length - 1;
    while (index > 0) { const parent = (index - 1) >> 1; if (!less(node, open[parent])) break; open[index] = open[parent]; index = parent; }
    open[index] = node;
  };
  const pop = () => {
    const first = open[0], last = open.pop()!;
    if (open.length) {
      let index = 0;
      while (index * 2 + 1 < open.length) {
        let child = index * 2 + 1;
        if (child + 1 < open.length && less(open[child + 1], open[child])) child++;
        if (!less(open[child], last)) break;
        open[index] = open[child]; index = child;
      }
      open[index] = last;
    }
    return first;
  };
  push({ ...start }, 0);
  const closed = new Set<number>();
  while (open.length) {
    const node = pop(), current = node.tile, currentKey = key(current);
    if (closed.has(currentKey) || node.cost !== distances.get(currentKey)) continue;
    if (!blocked(current) && !cannotStop(current)) {
      let tiles: Tile[] | undefined;
      result.set(currentKey, { distance: node.cost, get tiles() {
        if (!tiles) {
          tiles = []; let cursor = current;
          while (key(cursor) !== key(start)) { tiles.push(cursor); cursor = previous.get(key(cursor))!; }
          tiles.reverse();
        }
        return tiles;
      } });
    }
    closed.add(currentKey);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const next = { column: current.column + dc, row: current.row + dr };
      if (next.column < 0 || next.row < 0 || next.column >= size || next.row >= size || blocked(next)) continue;
      if (dc && dr && (blocked({ column: next.column, row: current.row }) || blocked({ column: current.column, row: next.row }))) continue;
      const nextKey = key(next), cost = node.cost + Math.hypot(dc, dr);
      if (cost < (distances.get(nextKey) ?? Infinity)) { distances.set(nextKey, cost); previous.set(nextKey, current); push(next, cost); }
    }
  }
  if (policy) { policy.set(cacheKey, result); if (policy.size > 16) policy.delete(policy.keys().next().value!); }
  return result;
}

export function findPath(start: Tile, goal: Tile, size: number, blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean, movement?: Movement): Path | null {
  if (goal.column < 0 || goal.row < 0 || goal.column >= size || goal.row >= size || blocked(goal) || cannotStop(goal)) return null;
  return findPaths(start, size, blocked, cannotStop, movement).get(goal.row * size + goal.column) ?? null;
}

export function commandMove(movement: Movement, goal: Tile, size: number, blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean): boolean {
  const path = findPath(movement.nextTile ?? movement.tile, goal, size, blocked, cannotStop, movement);
  if (!path) return false;
  return setRoute(movement, path.tiles);
}

export function advancePathMovement(movement: Movement, seconds: number, size: number, blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean): void {
  // A death or blocked route can create a new stationary occupant after orders were issued.
  // Passing pawns do not displace a pawn that is waiting at its reserved destination.
  if (movement.reservationBlocked?.(movement.destination)) {
    const paths = findPaths(movement.nextTile ?? movement.tile, size, blocked, cannotStop, movement);
    let nearest: Path | undefined;
    let distance = Infinity;
    for (const [index, path] of paths) {
      const candidateDistance = Math.hypot(index % size - movement.destination.column, Math.floor(index / size) - movement.destination.row);
      if (candidateDistance < distance) { distance = candidateDistance; nearest = path; }
    }
    if (nearest) setRoute(movement, nearest.tiles);
  }
  const goal = { ...movement.destination };
  const hadRoute = movement.route !== undefined;
  advanceMovement(movement, seconds, blocked, cannotStop);
  if (hadRoute && (movement.destination.column !== goal.column || movement.destination.row !== goal.row)) {
    if (!commandMove(movement, goal, size, blocked, cannotStop) && movement.stopBlocked?.(movement.destination)) {
      const paths = findPaths(movement.tile, size, blocked, cannotStop, movement);
      const nearest = paths.values().next().value;
      if (nearest) setRoute(movement, nearest.tiles);
    }
  }
}
