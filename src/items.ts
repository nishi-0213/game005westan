import type { Tile } from './movement';

export type ItemType = 'wood' | 'stone';
export interface MapItem extends Tile {
  type: ItemType;
  quantity: number;
}

export const ITEM_TYPES: ItemType[] = ['wood', 'stone'];
export const ITEM_APPEARANCE = {
  wood: { name: '木材', color: 0x916039, massKg: 1 },
  stone: { name: '石材', color: 0x929292, massKg: 10 },
};

export function initialItems(): MapItem[] {
  return [
    { type: 'wood', quantity: 100, column: 16, row: 16 },
    { type: 'stone', quantity: 200, column: 17, row: 16 },
  ];
}

export function countItems(items: readonly MapItem[]): Record<ItemType, number> {
  const totals = { wood: 0, stone: 0 };
  for (const item of items) totals[item.type] += item.quantity;
  return totals;
}

export function returnItems(items: MapItem[], tile: Tile, type: ItemType, quantity: number): void {
  if (quantity <= 0) return;
  const stack = items.find((item) => item.type === type && item.column === tile.column && item.row === tile.row);
  if (stack) stack.quantity += quantity;
  else items.push({ ...tile, type, quantity });
}
