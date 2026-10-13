import type { Tile } from './movement';

export interface Path { tiles: Tile[]; distance: number }
export function findPaths(start: Tile, size: number, blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean): Map<number, Path> {
  const result = new Map<number, Path>();
  const key = ({ column, row }: Tile) => row * size + column;
  const distances = new Map<number, number>([[key(start), 0]]);
  const previous = new Map<number, Tile>();
  const open: Tile[] = [{ ...start }];
  const closed = new Set<number>();
  while (open.length) {
    let index = 0;
    for (let i = 1; i < open.length; i++) if (distances.get(key(open[i]))! < distances.get(key(open[index]))!) index = i;
    const current = open.splice(index, 1)[0];
    const currentKey = key(current);
    if (closed.has(currentKey)) continue;
    if (!blocked(current) && !cannotStop(current)) {
      const tiles: Tile[] = [];
      let cursor = current;
      while (key(cursor) !== key(start)) { tiles.unshift(cursor); cursor = previous.get(key(cursor))!; }
      result.set(currentKey, { tiles, distance: distances.get(currentKey)! });
    }
    closed.add(currentKey);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const next = { column: current.column + dc, row: current.row + dr };
      if (next.column < 0 || next.row < 0 || next.column >= size || next.row >= size || blocked(next)) continue;
      if (dc && dr && (blocked({ column: next.column, row: current.row }) || blocked({ column: current.column, row: next.row }))) continue;
      const nextKey = key(next);
      const cost = distances.get(currentKey)! + Math.hypot(dc, dr);
      if (cost < (distances.get(nextKey) ?? Infinity)) {
        distances.set(nextKey, cost); previous.set(nextKey, current); open.push(next);
      }
    }
  }
  return result;
}

export function findPath(start: Tile, goal: Tile, size: number, blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean): Path | null {
  return findPaths(start, size, blocked, cannotStop).get(goal.row * size + goal.column) ?? null;
}
