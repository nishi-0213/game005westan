import type { ItemType } from './items';
import type { Tile } from './movement';

export type WallMaterial = 'wood' | 'stone';
export type ConstructionKind = 'wall' | 'barricade' | 'storage' | 'storageArea';
export interface Wall extends Tile {
  kind: ConstructionKind;
  material: WallMaterial;
  state: 'planned' | 'completed' | 'cancelled';
  delivered: number;
  workSeconds: number;
  stored?: Record<ItemType, number>;
  demolition?: boolean;
  demolitionSeconds?: number;
  accepted?: Record<ItemType, boolean>;
}

export const WALL_COLORS: Record<WallMaterial, number> = {
  wood: 0x916039,
  stone: 0x929292,
};
export const WALL_PLAN_ALPHA = 0.7;
export const BUILD_RECIPES: Record<ConstructionKind, { materialCount: number; seconds: number } | null> = {
  wall: { materialCount: 10, seconds: 1 },
  barricade: { materialCount: 5, seconds: 1 },
  storage: { materialCount: 30, seconds: 3 },
  storageArea: { materialCount: 0, seconds: 0 },
};

export class Walls {
  readonly items = new Map<string, Wall>();
  readonly mapSize: number;
  environmentCannotStop: (tile: Tile) => boolean = () => false;

  constructor(mapSize: number) {
    this.mapSize = mapSize;
  }

  plan(tile: Tile, material: WallMaterial, kind: ConstructionKind = 'wall'): Wall | null {
    if (!Number.isInteger(tile.column) || !Number.isInteger(tile.row)
      || tile.column < 0 || tile.row < 0 || tile.column >= this.mapSize || tile.row >= this.mapSize) return null;
    const key = `${tile.column},${tile.row}`;
    if (this.items.has(key)) return null;
    const wall: Wall = { ...tile, material, kind, state: 'planned', delivered: 0, workSeconds: 0 };
    if (kind === 'storage' || kind === 'storageArea') { wall.material = 'wood'; wall.stored = { wood: 0, stone: 0, strawberry: 0 }; wall.accepted = { wood: true, stone: true, strawberry: true }; }
    this.items.set(key, wall);
    return wall;
  }

  complete(tile: Tile): boolean {
    const wall = this.items.get(`${tile.column},${tile.row}`);
    if (!wall || wall.state === 'completed') return false;
    wall.state = 'completed';
    return true;
  }

  removePlan(tile: Tile): Wall | null {
    const key = `${tile.column},${tile.row}`;
    const item = this.items.get(key);
    if (!item || item.state !== 'planned') return null;
    item.state = 'cancelled';
    this.items.delete(key);
    return item;
  }

  isBlocked = (tile: Tile): boolean => {
    const item = this.items.get(`${tile.column},${tile.row}`);
    return item?.state === 'completed' && (item.kind === 'wall' || item.kind === 'storage');
  };

  cannotStop = (tile: Tile): boolean => {
    const item = this.items.get(`${tile.column},${tile.row}`);
    return (item?.state === 'completed' && item.kind === 'barricade') || this.environmentCannotStop(tile);
  };
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
