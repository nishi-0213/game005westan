import { Assets, Graphics, Sprite, Texture } from 'pixi.js';
import type { ItemType } from './items';

export const SPRITE_URLS = {
  gloves: new URL('./assets/gloves.png', import.meta.url).href,
  ration: new URL('./assets/ration.png', import.meta.url).href,
  hat: new URL('./assets/hat.png', import.meta.url).href,
  jacket: new URL('./assets/jacket.png', import.meta.url).href,
  trousers: new URL('./assets/trousers.png', import.meta.url).href,
  ballisticVest: new URL('./assets/ballistic-vest.png', import.meta.url).href,
  pawnBody: new URL('./assets/pawn-body.png', import.meta.url).href,
  pawnEyes: new URL('./assets/pawn-eyes.png', import.meta.url).href,
  hair1: new URL('./assets/hair-1.png', import.meta.url).href,
  hair2: new URL('./assets/hair-2.png', import.meta.url).href,
  rock: new URL('./assets/rock.png', import.meta.url).href,
  floorStone: new URL('./assets/floor-stone.png', import.meta.url).href,
  floorWood: new URL('./assets/floor-wood.png', import.meta.url).href,
  wallStone: new URL('./assets/wall-stone.png', import.meta.url).href,
  wallWood: new URL('./assets/wall-wood.png', import.meta.url).href,
  itemStone: new URL('./assets/item-stone.png', import.meta.url).href,
  itemWood: new URL('./assets/item-wood.png', import.meta.url).href,
  itemStrawberry: new URL('./assets/item-strawberry.png', import.meta.url).href,
  knife: new URL('./assets/knife.png', import.meta.url).href,
  pawn: new URL('./assets/pawn.png', import.meta.url).href,
  rifle: new URL('./assets/rifle.png', import.meta.url).href,
  deer: new URL('./assets/deer.png', import.meta.url).href,
  grass: new URL('./assets/grass.png', import.meta.url).href,
  tree: new URL('./assets/tree.png', import.meta.url).href,
  wolf: new URL('./assets/wolf.png', import.meta.url).href,
  strawberry: new URL('./assets/strawberry.png', import.meta.url).href,
};
export type SpriteName = keyof typeof SPRITE_URLS;

export async function loadSprites(): Promise<void> {
  await Promise.all(Object.values(SPRITE_URLS).map(async url => {
    const texture = await Assets.load<Texture>(url);
    texture.source.scaleMode = 'nearest';
  }));
}

export function spriteArtwork(name: SpriteName, size = 24): Sprite {
  const sprite = new Sprite(Assets.get<Texture>(SPRITE_URLS[name]));
  sprite.anchor.set(.5);
  sprite.width = size; sprite.height = size;
  sprite.roundPixels = true;
  return sprite;
}

export function clearArtwork(view: Graphics): Graphics {
  view.clear();
  for (const child of view.removeChildren()) child.destroy();
  return view;
}

export function drawArtwork(view: Graphics, name: SpriteName, size = 24): Graphics {
  clearArtwork(view);
  view.addChild(spriteArtwork(name, size));
  return view;
}

export function itemSprite(type: ItemType): SpriteName | undefined {
  if (type === 'knife' || type === 'rifle' || type==='hat' || type==='jacket' || type==='trousers' || type==='ballisticVest' || type==='gloves' || type==='ration') return type;
  if(type==='wood')return 'itemWood';
  if(type==='stone')return 'itemStone';
  if(type==='strawberry')return 'itemStrawberry';
  if (type === 'humanCorpse') return 'pawn';
  if (type === 'deerCorpse') return 'deer';
  if (type === 'wolfCorpse') return 'wolf';
  return undefined;
}
