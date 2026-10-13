import type { Tile } from './movement';

export type WallMaterial = 'wood' | 'stone';
export interface Wall extends Tile {
  material: WallMaterial;
  state: 'planned' | 'completed';
}

export const WALL_COLORS: Record<WallMaterial, number> = {
  wood: 0x916039,
  stone: 0x929292,
};
export const WALL_PLAN_ALPHA = 0.7;

export class Walls {
  readonly items = new Map<string, Wall>();
  readonly mapSize: number;

  constructor(mapSize: number) {
    this.mapSize = mapSize;
  }

  plan(tile: Tile, material: WallMaterial): Wall | null {
    if (!Number.isInteger(tile.column) || !Number.isInteger(tile.row)
      || tile.column < 0 || tile.row < 0 || tile.column >= this.mapSize || tile.row >= this.mapSize) return null;
    const key = `${tile.column},${tile.row}`;
    if (this.items.has(key)) return null;
    const wall: Wall = { ...tile, material, state: 'planned' };
    this.items.set(key, wall);
    return wall;
  }

  complete(tile: Tile): boolean {
    const wall = this.items.get(`${tile.column},${tile.row}`);
    if (!wall || wall.state === 'completed') return false;
    wall.state = 'completed';
    return true;
  }

  isBlocked = (tile: Tile): boolean =>
    this.items.get(`${tile.column},${tile.row}`)?.state === 'completed';
}

// Fill skipped tiles when a drag crosses several cells between pointer events.
export function dragTiles(from: Tile, to: Tile): Tile[] {
  const steps = Math.max(Math.abs(to.column - from.column), Math.abs(to.row - from.row));
  if (steps === 0) return [{ ...to }];
  return Array.from({ length: steps + 1 }, (_, index) => ({
    column: Math.round(from.column + (to.column - from.column) * index / steps),
    row: Math.round(from.row + (to.row - from.row) * index / steps),
  }));
}
