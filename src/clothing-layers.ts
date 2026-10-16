import type { Clothing, ClothingItem, ClothingSlot } from './items';
export const CLOTHING_SPRITES={hat:'hat',jacket:'jacket',trousers:'trousers',ballisticVest:'ballisticVest',gloves:'gloves'} as const;
export interface ClothingLayer { slot:ClothingSlot; type:ClothingItem; sprite?:typeof CLOTHING_SPRITES[keyof typeof CLOTHING_SPRITES] }
/** Back to front: outerwear covers the torso, hats remain above the hair. */
export function clothingLayers(clothing:Clothing):ClothingLayer[] {
  const layers:ClothingLayer[]=[];
  for(const slot of ['legs','torso','arms','outerwear','head'] as const){
    const type=clothing[slot];if(!type)continue;
    const sprite=CLOTHING_SPRITES[type];layers.push({slot,type,sprite});
  }
  return layers;
}
