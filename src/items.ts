import type { Tile } from './movement';

export type ItemType = 'wood' | 'stone' | 'strawberry';
export interface MapItem extends Tile {
  type: ItemType;
  quantity: number;
  collect?: boolean;
}

export const ITEM_TYPES: ItemType[] = ['wood', 'stone', 'strawberry'];
export const PAWN_CARRY_LIMIT_KG = 20;
export const ITEM_APPEARANCE = {
  wood: { name: '木材', color: 0x916039, massKg: 1 },
  strawberry: { name: '苺', color: 0xe75b70, massKg: 0.2 },
  stone: { name: '石材', color: 0x929292, massKg: 10 },
};

export function initialItems(): MapItem[] {
  return [
    { type: 'wood', quantity: 100, column: 16, row: 16 },
    { type: 'stone', quantity: 200, column: 17, row: 16 },
  ];
}

export function countItems(items: readonly MapItem[]): Record<ItemType, number> {
  const totals = { wood: 0, stone: 0, strawberry: 0 };
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
