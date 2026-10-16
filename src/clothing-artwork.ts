import { Graphics } from 'pixi.js';
import { ITEM_APPEARANCE, type Clothing } from './items';

// Temporary shapes aligned with the 24px pawn sprite; outerwear covers the torso.
export function drawClothing(view: Graphics, clothing: Clothing): void {
  view.clear();
  if(clothing.legs)view.rect(-5,5,4,6).rect(1,5,4,6).fill(ITEM_APPEARANCE[clothing.legs].color);
  if(clothing.torso)view.rect(-6,-3,12,9).fill(ITEM_APPEARANCE[clothing.torso].color);
  if(clothing.arms)view.rect(-9,1,3,5).rect(6,1,3,5).fill(ITEM_APPEARANCE[clothing.arms].color);
  if(clothing.outerwear)view.rect(-5,-3,10,9).fill(ITEM_APPEARANCE[clothing.outerwear].color).rect(-1,-2,2,7).fill(0x353c30);
  if(clothing.head)view.rect(-7,-10,14,3).rect(-5,-14,10,5).fill(ITEM_APPEARANCE[clothing.head].color);
}
