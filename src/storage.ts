import type { EatingWorker } from './needs';
import type { ItemType, MapItem } from './items';
import { ITEM_TYPES } from './items.ts';
import type { Wall, Walls } from './walls';

export class Storage {
  readonly walls: Walls;
  private sourceCache = new WeakMap<Wall,Map<ItemType,MapItem>>();
  private storedSources = new WeakSet<MapItem>();
  isSource(item: MapItem): boolean { return this.storedSources.has(item); }
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
    return this.boxes().filter(box => (box.stored?.[type] ?? 0) > 0).map(box => {
      let cache=this.sourceCache.get(box);
      if(!cache){cache=new Map();this.sourceCache.set(box,cache);}
      let source=cache.get(type);
      if(!source){
        const walls=this.walls;
        source={column:box.column,row:box.row,type,
          get quantity(){return box.state==='completed' && walls.at(box)===box ? box.stored?.[type]??0 : 0;},
          set quantity(value:number){box.stored![type]=value;}};
        cache.set(type,source);this.storedSources.add(source);
      }
      return source;
    });
  }

  totals(): Record<ItemType, number> {
    const totals = { wood: 0, stone: 0, strawberry: 0, rifle: 0, knife: 0, meat: 0, humanCorpse: 0, deerCorpse: 0 };
    for (const box of this.boxes()) for (const type of ITEM_TYPES) totals[type] += box.stored?.[type] ?? 0;
    return totals;
  }

  depositCorpse(box: Wall, corpse: EatingWorker, type: 'humanCorpse' | 'deerCorpse'): boolean {
    if (this.deposit(box, type, 1) !== 1) return false;
    box.storedCorpses ??= []; box.storedCorpses.push(corpse); corpse.corpseStorage = box;
    corpse.corpseCarrier = undefined; corpse.corpseStation = undefined;
    return true;
  }

  withdrawCorpse(corpse: EatingWorker, type: 'humanCorpse' | 'deerCorpse'): void {
    const box = corpse.corpseStorage;
    if (!box) return;
    const index = box.storedCorpses?.indexOf(corpse) ?? -1;
    if (index >= 0) box.storedCorpses!.splice(index, 1);
    if (box.stored) box.stored[type] = Math.max(0, (box.stored[type] ?? 0) - 1);
    corpse.corpseStorage = undefined;
  }

  deposit(box: Wall, type: ItemType, quantity: number): number {
    if (!this.accepts(box, type) || quantity <= 0) return 0;
    box.stored ??= { wood: 0, stone: 0, strawberry: 0, rifle: 0, knife: 0, meat: 0, humanCorpse: 0, deerCorpse: 0 };
    const deposited = Math.min(quantity, this.capacity(box, type));
    box.stored[type] = (box.stored[type] ?? 0) + deposited;
    return deposited;
  }
}
