import type { Tile } from './movement';
import type { Weapon } from './combat';
import { inWeaponRange, WEAPONS } from './combat.ts';

export interface RangeEdge { from: Tile; to: Tile }

/** Tile-edge outline of the usable map cells, without an interior hole at the pawn. */
export function attackRangeEdges(center: Tile, weapon: Weapon, size: number): RangeEdge[] {
  const range = WEAPONS[weapon].range;
  if (range < 1) return [];
  const inside = (column: number, row: number): boolean => column >= 0 && row >= 0 && column < size && row < size
    && (column === center.column && row === center.row || inWeaponRange(weapon, center, { column, row }));
  const edges: RangeEdge[] = [];
  for (let row = Math.max(0, center.row - range); row <= Math.min(size - 1, center.row + range); row++) {
    for (let column = Math.max(0, center.column - range); column <= Math.min(size - 1, center.column + range); column++) {
      if (!inside(column, row)) continue;
      if (!inside(column, row - 1)) edges.push({ from: { column, row }, to: { column: column + 1, row } });
      if (!inside(column + 1, row)) edges.push({ from: { column: column + 1, row }, to: { column: column + 1, row: row + 1 } });
      if (!inside(column, row + 1)) edges.push({ from: { column: column + 1, row: row + 1 }, to: { column, row: row + 1 } });
      if (!inside(column - 1, row)) edges.push({ from: { column, row: row + 1 }, to: { column, row } });
    }
  }
  return edges;
}
