import { Assets, Graphics, Sprite, Texture } from 'pixi.js';
import type { ItemType } from './items';

export const SPRITE_URLS = {
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
  if (type === 'knife' || type === 'rifle' || type === 'strawberry') return type;
  if (type === 'humanCorpse') return 'pawn';
  if (type === 'deerCorpse') return 'deer';
  if (type === 'wolfCorpse') return 'wolf';
  return undefined;
}
