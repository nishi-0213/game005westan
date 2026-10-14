import type { Tile } from './movement';

export type ItemType = 'wood' | 'stone' | 'strawberry' | 'rifle' | 'knife' | 'meat' | 'humanCorpse' | 'deerCorpse';
export interface MapItem extends Tile {
  type: ItemType;
  quantity: number;
  collect?: boolean;
}

export const ITEM_TYPES: ItemType[] = ['wood', 'stone', 'strawberry', 'rifle', 'knife', 'meat', 'humanCorpse', 'deerCorpse'];
export const PAWN_CARRY_LIMIT_KG = 20;
export const ITEM_APPEARANCE = {
  wood: { name: '木材', color: 0x916039, massKg: 1 },
  strawberry: { name: '苺', color: 0xe75b70, massKg: 0.2 },
  stone: { name: '石材', color: 0x929292, massKg: 4 },
  rifle: { name: 'ライフル', color: 0x46515b, massKg: 5 },
  knife: { name: 'ナイフ', color: 0xb9c3ca, massKg: 2 },
  meat: { name: '肉', color: 0xb95862, massKg: 1 },
  humanCorpse: { name: '人間の死体', color: 0x85755a, massKg: 50 },
  deerCorpse: { name: '鹿の死体', color: 0x725036, massKg: 120 },
};

export function foodNutrition(type: ItemType): number { return type === 'strawberry' ? 20 : type === 'meat' ? 40 : 0; }

export function emptyItemCounts(): Record<ItemType, number> {
  return { wood: 0, stone: 0, strawberry: 0, rifle: 0, knife: 0, meat: 0, humanCorpse: 0, deerCorpse: 0 };
}

export function carryCapacity(worker: { weapon?: 'unarmed' | 'rifle' | 'knife' }, type: ItemType): number {
  const equippedMass = worker.weapon && worker.weapon !== 'unarmed' ? ITEM_APPEARANCE[worker.weapon].massKg : 0;
  return Math.max(1, Math.floor(Math.max(0, PAWN_CARRY_LIMIT_KG - equippedMass) / ITEM_APPEARANCE[type].massKg));
}

export function initialItems(): MapItem[] {
  return [
    { type: 'wood', quantity: 100, column: 16, row: 16 },
    { type: 'stone', quantity: 200, column: 17, row: 16 },
    { type: 'rifle', quantity: 1, column: 16, row: 17 },
    { type: 'knife', quantity: 1, column: 17, row: 17 },
  ];
}

export function countItems(items: readonly MapItem[]): Record<ItemType, number> {
  const totals = emptyItemCounts();
  for (const item of items) totals[item.type] += item.quantity;
  return totals;
}

export function returnItems(items: MapItem[], tile: Tile, type: ItemType, quantity: number): void {
  if (quantity <= 0) return;
  const stack = items.find((item) => item.type === type && item.column === tile.column && item.row === tile.row);
  if (stack) stack.quantity += quantity;
  else items.push({ ...tile, type, quantity });
}

export function nearbyItems(items: readonly MapItem[], target: MapItem): MapItem[] {
  return items.filter(item => item.quantity > 0 && item.type === target.type && item.column >= target.column - 5 && item.column < target.column + 5 && item.row >= target.row - 5 && item.row < target.row + 5);
}

export function isWeaponItem(type: ItemType): type is 'rifle' | 'knife' { return type === 'rifle' || type === 'knife'; }
