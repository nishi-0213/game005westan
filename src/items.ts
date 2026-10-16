import type { BodyPart } from './health';
import type { Tile } from './movement';

export type ClothingItem = 'hat' | 'jacket' | 'trousers' | 'ballisticVest' | 'gloves';
export type ClothingSlot = 'head' | 'outerwear' | 'torso' | 'arms' | 'legs';
export type Clothing = Partial<Record<ClothingSlot, ClothingItem>>;
export type ItemType = ClothingItem | 'wood' | 'stone' | 'strawberry' | 'ration' | 'rifle' | 'knife' | 'meat' | 'humanCorpse' | 'deerCorpse' | 'wolfCorpse';
export interface MapItem extends Tile {
  type: ItemType;
  quantity: number;
  collect?: boolean;
}

export const ITEM_TYPES: ItemType[] = ['wood', 'stone', 'strawberry', 'ration', 'rifle', 'knife', 'meat', 'humanCorpse', 'deerCorpse', 'wolfCorpse', 'hat', 'jacket', 'trousers', 'ballisticVest', 'gloves'];
export const PAWN_CARRY_LIMIT_KG = 20;
export const CLOTHING_SLOTS = { head:'頭', outerwear:'上着', torso:'胴', arms:'腕', legs:'脚' } as const;
export const CLOTHING = {
  hat: { slot:'head', armor:1 }, jacket: { slot:'torso', armor:2 }, trousers: { slot:'legs', armor:1 },
  ballisticVest: { slot:'outerwear', armor:3 }, gloves: { slot:'arms', armor:1 },
} as const;
export function isClothingItem(type: ItemType): type is ClothingItem { return Object.hasOwn(CLOTHING, type); }
export function initialClothing(): Clothing { return { head:'hat', torso:'jacket', legs:'trousers' }; }
export function armorForPart(worker:{armor?:number;clothing?:Clothing},part:BodyPart):number {
  let armor=worker.armor??0;
  for(const [slot,type] of Object.entries(worker.clothing??{})){
    const covered=slot==='outerwear'?'torso':slot;
    if(covered===part)armor+=CLOTHING[type].armor;
  }
  return armor;
}
export const ITEM_APPEARANCE = {
  hat: { name:'帽子', color:0xb89961, massKg:.3 },
  jacket: { name:'ジャケット', color:0x6386a1, massKg:1 },
  trousers: { name:'ズボン', color:0x4d596b, massKg:1 },
  ballisticVest: { name:'防弾チョッキ', color:0x555e46, massKg:10 },
  gloves: { name:'グローブ', color:0xa17749, massKg:.2 },
  wood: { name: '木材', color: 0x916039, massKg: 1 },
  ration: { name:'携帯食料',color:0xd8b76c,massKg:1,nutrition:30 },
  strawberry: { name: '苺', color: 0xe75b70, massKg: 0.2, nutrition: 10 },
  stone: { name: '石材', color: 0x929292, massKg: 4 },
  rifle: { name: 'ライフル', color: 0x46515b, massKg: 5 },
  knife: { name: 'ナイフ', color: 0xb9c3ca, massKg: 2 },
  meat: { name: '肉', color: 0xb95862, massKg: 1, nutrition: 20 },
  humanCorpse: { name: '人間の死体', color: 0x85755a, massKg: 50, nutrition:100 },
  wolfCorpse: { name: '狼の死体', color: 0x89928d, massKg:50, nutrition:100 },
  deerCorpse: { name: '鹿の死体', color: 0x725036, massKg: 120, nutrition:100 },
};

export function foodNutrition(type: ItemType): number { return type === 'ration' || type === 'strawberry' || type === 'meat' || type === 'humanCorpse' || type === 'deerCorpse' || type === 'wolfCorpse' ? ITEM_APPEARANCE[type].nutrition : 0; }

export function emptyItemCounts(): Record<ItemType, number> {
  return { wood: 0, stone: 0, strawberry: 0, ration: 0, rifle: 0, knife: 0, meat: 0, humanCorpse: 0, deerCorpse: 0, wolfCorpse: 0, hat: 0, jacket: 0, trousers: 0, ballisticVest: 0, gloves: 0 };
}

export function carryCapacity(worker: { clothing?:Clothing; weapon?: 'unarmed' | 'rifle' | 'knife' }, type: ItemType): number {
  const equippedMass = equippedMassKg(worker);
  return Math.max(1, Math.floor(Math.max(0, PAWN_CARRY_LIMIT_KG - equippedMass) / ITEM_APPEARANCE[type].massKg));
}

export function equippedMassKg(worker: {clothing?:Clothing; weapon?:'unarmed'|'rifle'|'knife'}): number {
  return Object.values(worker.clothing ?? {}).reduce((sum, type) => sum + ITEM_APPEARANCE[type].massKg, 0)
    + (worker.weapon && worker.weapon !== 'unarmed' ? ITEM_APPEARANCE[worker.weapon].massKg : 0);
}
export function carriedMassKg(worker: {clothing?:Clothing; weapon?:'unarmed'|'rifle'|'knife'; inventory?:{type:ItemType;quantity:number}|null}): number {
  return equippedMassKg(worker) + (worker.inventory ? ITEM_APPEARANCE[worker.inventory.type].massKg * worker.inventory.quantity : 0);
}
export function initialItems(): MapItem[] {
  return [
    { type:'ballisticVest',quantity:1,column:15,row:18 },
    { type:'gloves',quantity:1,column:16,row:18 },
    { type:'ration',quantity:40,column:15,row:17,collect:true },
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
