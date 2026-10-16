import { ITEM_APPEARANCE, type Clothing } from './items.ts';
export interface ClothingShape { x:number; y:number; width:number; height:number; color:number }
/** Only gloves still need placeholder geometry; other garments use the supplied PNGs. */
export function clothingShapes(clothing:Clothing):ClothingShape[] {
  if(!clothing.arms)return [];
  const color=ITEM_APPEARANCE[clothing.arms].color;
  return [{x:-9,y:1,width:3,height:5,color},{x:6,y:1,width:3,height:5,color}];
}
