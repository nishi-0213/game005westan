import type { Tile } from './movement';

export type ItemType = 'wood' | 'stone' | 'strawberry' | 'rifle';
export interface MapItem extends Tile {
  type: ItemType;
  quantity: number;
  collect?: boolean;
}

export const ITEM_TYPES: ItemType[] = ['wood', 'stone', 'strawberry', 'rifle'];
export const PAWN_CARRY_LIMIT_KG = 20;
export const ITEM_APPEARANCE = {
  wood: { name: '木材', color: 0x916039, massKg: 1 },
  strawberry: { name: '苺', color: 0xe75b70, massKg: 0.2 },
  stone: { name: '石材', color: 0x929292, massKg: 4 },
  rifle: { name: 'ライフル', color: 0x46515b, massKg: 5 },
};

export function emptyItemCounts(): Record<ItemType, number> {
  return { wood: 0, stone: 0, strawberry: 0, rifle: 0 };
}

export function carryCapacity(worker: { weapon?: 'unarmed' | 'rifle' }, type: ItemType): number {
  const equippedMass = worker.weapon === 'rifle' ? ITEM_APPEARANCE.rifle.massKg : 0;
  return Math.floor(Math.max(0, PAWN_CARRY_LIMIT_KG - equippedMass) / ITEM_APPEARANCE[type].massKg);
}

export function initialItems(): MapItem[] {
  return [
    { type: 'wood', quantity: 100, column: 16, row: 16 },
    { type: 'stone', quantity: 200, column: 17, row: 16 },
    { type: 'rifle', quantity: 1, column: 16, row: 17 },
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
