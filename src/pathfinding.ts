import type { Movement, Tile } from './movement';
import { advanceMovement, setRoute } from './movement.ts';

export interface Path { tiles: Tile[]; distance: number }
type TileRule = (tile: Tile) => boolean;
const caches = new WeakMap<TileRule, WeakMap<TileRule, Map<string, Map<number, Path>>>>();
export function registerPathCache(blocked: TileRule): void { caches.set(blocked, new WeakMap()); }
export function invalidatePaths(blocked: TileRule): void { if (caches.has(blocked)) caches.set(blocked, new WeakMap()); }

export function findPaths(start: Tile, size: number, blocked: TileRule, cannotStop: TileRule): Map<number, Path> {
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

export function findPath(start: Tile, goal: Tile, size: number, blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean): Path | null {
  if (goal.column < 0 || goal.row < 0 || goal.column >= size || goal.row >= size || blocked(goal) || cannotStop(goal)) return null;
  return findPaths(start, size, blocked, cannotStop).get(goal.row * size + goal.column) ?? null;
}

export function commandMove(movement: Movement, goal: Tile, size: number, blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean): boolean {
  const path = findPath(movement.nextTile ?? movement.tile, goal, size, blocked, cannotStop);
  if (!path) return false;
  setRoute(movement, path.tiles);
  return true;
}

export function advancePathMovement(movement: Movement, seconds: number, size: number, blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean): void {
  const goal = { ...movement.destination };
  const hadRoute = movement.route !== undefined;
  advanceMovement(movement, seconds, blocked, cannotStop);
  if (hadRoute && (movement.destination.column !== goal.column || movement.destination.row !== goal.row)) {
    commandMove(movement, goal, size, blocked, cannotStop);
  }
}
