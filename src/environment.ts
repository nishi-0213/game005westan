import type { Tile } from './movement';
import type { ItemType } from './items';

export type EnvironmentType = 'tree' | 'rock';
export interface EnvironmentObject extends Tile {
  type: EnvironmentType;
  collect: boolean;
  collected: boolean;
  workSeconds: number;
}
export const ENVIRONMENT_PROPERTIES: Record<EnvironmentType, { name: string; material: ItemType; quantity: number; seconds: number }> = {
  tree: { name: '木', material: 'wood', quantity: 12, seconds: 4 },
  rock: { name: '岩', material: 'stone', quantity: 8, seconds: 5 },
};

export function initialEnvironment(size: number, random: () => number = Math.random): EnvironmentObject[] {
  const available: Tile[] = [];
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    if (Math.abs(column - size / 2) <= 2 && Math.abs(row - size / 2) <= 2) continue;
    available.push({ column, row });
  }
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  return available.slice(0, 48).map((tile, index) => ({ ...tile, type: index < 24 ? 'tree' : 'rock', collect: false, collected: false, workSeconds: 0 }));
}

export function nearbySameType(objects: readonly EnvironmentObject[], center: EnvironmentObject): EnvironmentObject[] {
  return objects.filter((object) => !object.collected && object.type === center.type
    && object.column >= center.column - 5 && object.column < center.column + 5
    && object.row >= center.row - 5 && object.row < center.row + 5);
}
