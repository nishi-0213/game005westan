import type { ItemType, MapItem } from './items';
import { ITEM_TYPES } from './items.ts';
import type { Wall, Walls } from './walls';

export class Storage {
  readonly walls: Walls;
  constructor(walls: Walls) { this.walls = walls; }

  boxes(): Wall[] {
    return [...this.walls.items.values()].filter(box => (box.kind === 'storage' || box.kind === 'storageArea') && box.state === 'completed');
  }

  accepts(box: Wall, type: ItemType): boolean {
    return box.state === 'completed' && (box.kind === 'storage' || box.kind === 'storageArea') && box.accepted?.[type] !== false && this.capacity(box, type) > 0;
  }

  capacity(box: Wall, type: ItemType): number {
    if (box.kind === 'storage') return Infinity;
    if (box.kind !== 'storageArea') return 0;
    if (ITEM_TYPES.some(other => other !== type && (box.stored?.[other] ?? 0) > 0)) return 0;
    return Math.max(0, 100 - (box.stored?.[type] ?? 0));
  }

  sources(type: ItemType): MapItem[] {
    return this.boxes().filter(box => (box.stored?.[type] ?? 0) > 0).map(box => ({
      column: box.column, row: box.row, type,
      get quantity() { return box.state === 'completed' ? box.stored?.[type] ?? 0 : 0; },
      set quantity(value: number) { box.stored![type] = value; },
    }));
  }

  totals(): Record<ItemType, number> {
    const totals = { wood: 0, stone: 0 };
    for (const box of this.boxes()) for (const type of ITEM_TYPES) totals[type] += box.stored?.[type] ?? 0;
    return totals;
  }

  deposit(box: Wall, type: ItemType, quantity: number): number {
    if (!this.accepts(box, type) || quantity <= 0) return 0;
    box.stored ??= { wood: 0, stone: 0 };
    const deposited = Math.min(quantity, this.capacity(box, type));
    box.stored[type] += deposited;
    return deposited;
  }
}
