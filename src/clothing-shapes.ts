import { ITEM_APPEARANCE, type Clothing } from './items.ts';
export interface ClothingShape { x:number; y:number; width:number; height:number; color:number }
// Shared geometry for map artwork and HTML portraits, in pawn sprite coordinates.
export function clothingShapes(clothing:Clothing):ClothingShape[] {
  const shapes:ClothingShape[]=[];
  const add=(x:number,y:number,width:number,height:number,color:number)=>shapes.push({x,y,width,height,color});
  if(clothing.legs){const color=ITEM_APPEARANCE[clothing.legs].color;add(-5,5,4,6,color);add(1,5,4,6,color);}
  if(clothing.torso)add(-6,-3,12,9,ITEM_APPEARANCE[clothing.torso].color);
  if(clothing.arms){const color=ITEM_APPEARANCE[clothing.arms].color;add(-9,1,3,5,color);add(6,1,3,5,color);}
  if(clothing.outerwear){add(-5,-3,10,9,ITEM_APPEARANCE[clothing.outerwear].color);add(-1,-2,2,7,0x353c30);}
  if(clothing.head){const color=ITEM_APPEARANCE[clothing.head].color;add(-7,-10,14,3,color);add(-5,-14,10,5,color);}
  return shapes;
}
