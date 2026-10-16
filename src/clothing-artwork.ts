import { Graphics } from 'pixi.js';
import type { Clothing } from './items';
import { clothingShapes } from './clothing-shapes';
import { clothingLayers } from './clothing-layers';
import { clearArtwork, spriteArtwork } from './sprite-assets';

export function drawClothing(view: Graphics, clothing: Clothing): void {
  clearArtwork(view);
  for(const layer of clothingLayers(clothing)){
    if(layer.sprite)view.addChild(spriteArtwork(layer.sprite));
    else{
      const shape=new Graphics();
      for(const rect of clothingShapes({[layer.slot]:layer.type}))shape.rect(rect.x,rect.y,rect.width,rect.height).fill(rect.color);
      view.addChild(shape);
    }
  }
}
