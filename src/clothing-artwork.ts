import { Graphics } from 'pixi.js';
import type { Clothing } from './items';
import { clothingShapes } from './clothing-shapes';

export function drawClothing(view: Graphics, clothing: Clothing): void {
  view.clear();
  for(const shape of clothingShapes(clothing))view.rect(shape.x,shape.y,shape.width,shape.height).fill(shape.color);
}
