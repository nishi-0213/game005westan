import type { Tile } from './movement';
import type { ItemType } from './items';

export type EnvironmentType = 'tree' | 'rock' | 'wildStrawberry';
export interface EnvironmentObject extends Tile {
  type: EnvironmentType;
  collect: boolean;
  collected: boolean;
  workSeconds: number;
  hp: number;
  ageSeconds?: number;
  clusterId?: number;
}
export const ENVIRONMENT_PROPERTIES: Record<EnvironmentType, { name: string; material: ItemType; quantity: number; seconds: number }> = {
  tree: { name: '木', material: 'wood', quantity: 12, seconds: 4 },
  wildStrawberry: { name: '野苺', material: 'strawberry', quantity: 5, seconds: 1 },
  rock: { name: '岩', material: 'stone', quantity: 8, seconds: 5 },
};

export function createEnvironment(type: EnvironmentType, tile: Tile): EnvironmentObject {
  return { ...tile, type, collect: false, collected: false, workSeconds: 0, hp: type === 'rock' ? 100 : 1 };
}

export function harvestYield(object: EnvironmentObject): number {
  const hp = Math.max(0, Math.min(100, object.hp ?? 100));
  return Math.floor(ENVIRONMENT_PROPERTIES[object.type].quantity * hp / 100 + 1e-9);
}

export function initialEnvironment(size: number, random: () => number = Math.random): EnvironmentObject[] {
  const available: Tile[] = [];
  const allowed = (tile: Tile) => tile.column >= 0 && tile.row >= 0 && tile.column < size && tile.row < size
    && !(Math.abs(tile.column - size / 2) <= 2 && Math.abs(tile.row - size / 2) <= 2);
  const key = (tile: Tile) => `${tile.column},${tile.row}`;
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    if (allowed({ column, row })) available.push({ column, row });
  }
  const result: EnvironmentObject[] = [];
  const rockTiles = new Set<string>();
  const directions = [{ dc: 1, dr: 0 }, { dc: -1, dr: 0 }, { dc: 0, dr: 1 }, { dc: 0, dr: -1 },
    { dc: 1, dr: 1 }, { dc: 1, dr: -1 }, { dc: -1, dr: 1 }, { dc: -1, dr: -1 }];
  for (let clusterId = 0; clusterId < 4; clusterId++) {
    const length = 3 + Math.floor(random() * 6);
    const zigzag = random() < 0.5;
    const candidates: Tile[][] = [];
    for (const start of available) for (const direction of directions.slice(0, zigzag ? 4 : 8)) {
      const chain: Tile[] = [{ ...start }];
      for (let i = 1; i < length; i++) {
        const previous = chain[i - 1];
        chain.push({
          column: previous.column + (zigzag && !direction.dc ? (i % 2 ? 1 : -1) : direction.dc),
          row: previous.row + (zigzag && !direction.dr ? (i % 2 ? 1 : -1) : direction.dr),
        });
      }
      if (chain.every(tile => allowed(tile) && !rockTiles.has(key(tile))
        && !directions.some(({ dc, dr }) => rockTiles.has(key({ column: tile.column + dc, row: tile.row + dr }))))) candidates.push(chain);
    }
    const chain = candidates[Math.floor(random() * candidates.length)];
    if (!chain) continue;
    for (const tile of chain) {
      rockTiles.add(key(tile));
      result.push({ ...createEnvironment('rock', tile), clusterId });
    }
  }
  // Smooth value noise defines forest density; weighted sampling keeps sparse trees outside dense patches.
  const spacing = 6, width = Math.ceil(size / spacing) + 1;
  const lattice = Array.from({ length: width * width }, () => random());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const density = (tile: Tile) => {
    const x = tile.column / spacing, y = tile.row / spacing, ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const at = (cx: number, cy: number) => lattice[cy * width + cx];
    const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
  const trees = available.filter(tile => !rockTiles.has(key(tile))).map(tile => ({
    tile, score: -Math.log(Math.max(0.000001, random())) / (0.001 + density(tile) ** 6),
  })).sort((a, b) => a.score - b.score).slice(0, 120);
  for (const { tile } of trees) result.push({ ...createEnvironment('tree', tile), hp:1+Math.floor(random()*100),ageSeconds:random()*180 });
  const occupied = new Set(result.map(key));
  const berries = available.filter(tile => !occupied.has(key(tile)));
  for (let i = 0; i < 16 && berries.length; i++) {
    const index = Math.floor(random() * berries.length);
    const tile = berries.splice(index, 1)[0];
    result.push({ ...createEnvironment('wildStrawberry', tile), hp:1+Math.floor(random()*100),ageSeconds:random()*180 });
  }
  return result;
}

export function nearbySameType(objects: readonly EnvironmentObject[], center: EnvironmentObject): EnvironmentObject[] {
  return objects.filter((object) => !object.collected && object.type === center.type
    && object.column >= center.column - 5 && object.column < center.column + 5
    && object.row >= center.row - 5 && object.row < center.row + 5);
}
