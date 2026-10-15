import type { Movement } from './movement';
import type { Walls, Wall } from './walls';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';

export const DINING_DISTANCE = 20;
export interface DiningSeat { chair: Wall; table: Wall; path: Path }
export function diningTable(walls: Walls, chair: Wall): Wall | undefined {
  if (chair.kind !== 'chair' || chair.state !== 'completed' || walls.at(chair) !== chair) return;
  for (const [dc, dr] of [[0,-1],[1,0],[0,1],[-1,0]]) {
    const table = walls.at({column:chair.column+dc, row:chair.row+dr});
    if (table?.kind === 'table' && table.state === 'completed') return table;
  }
}

/** Search once when food is ready; path length includes detours and diagonal costs. */
export function findDiningSeat(walls: Walls, movement: Movement): DiningSeat | null {
  const candidates = [...walls.items.values()].flatMap(chair => {
    const table = diningTable(walls, chair);
    return table ? [{chair, table}] : [];
  });
  if (!candidates.length) return null;
  const paths = findPaths(movement.nextTile ?? movement.tile, walls.mapSize, walls.isBlocked, walls.cannotStop, movement);
  let best: DiningSeat | null = null;
  for (const candidate of candidates) {
    const path = paths.get(candidate.chair.row * walls.mapSize + candidate.chair.column);
    if (path && path.distance <= DINING_DISTANCE && (!best || path.distance < best.path.distance)) best = {...candidate, path};
  }
  return best;
}
