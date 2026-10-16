import { Container, Sprite, Texture } from 'pixi.js';
import { SPRITE_URLS, spriteArtwork } from './sprite-assets';
import { recolorPawnLayers, type PawnAppearance, type PawnLayers } from './pawn-appearance';
let source:PawnLayers;
interface PawnArtwork { body:Texture; eyes:Texture; bodyUrl:string; eyesUrl:string }
const variants=new Map<string,PawnArtwork>();
async function pixels(url:string):Promise<{width:number;height:number;pixels:Uint8ClampedArray}> {
  const image=new Image();image.src=url;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
  return {width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data};
}
/** The source PNGs share a 32px canvas and are aligned without coordinate guessing. */
export async function loadPawnArtwork(layers={bodyUrl:SPRITE_URLS.pawnBody,eyesUrl:SPRITE_URLS.pawnEyes}):Promise<void> {
  const [body,eyes]=await Promise.all([pixels(layers.bodyUrl),pixels(layers.eyesUrl)]);
  if(body.width!==eyes.width||body.height!==eyes.height)throw new Error('Pawn body and eye layers must have matching sizes');
  source={width:body.width,height:body.height,body:body.pixels,eyes:eyes.pixels};
}
function layer(data:Uint8ClampedArray):{texture:Texture;url:string} {
  const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
  const context=canvas.getContext('2d')!,image=context.createImageData(source.width,source.height);image.data.set(data);context.putImageData(image,0,0);
  const texture=Texture.from(canvas);texture.source.scaleMode='nearest';
  return {texture,url:canvas.toDataURL()};
}
export function pawnArtwork(appearance:PawnAppearance):PawnArtwork {
  const key=JSON.stringify([appearance.skinRed,appearance.skinDark,appearance.eyeSaturation,appearance.eyeHue??0]);let artwork=variants.get(key);
  if(!artwork){
    const colored=recolorPawnLayers(source,appearance),body=layer(colored.body),eyes=layer(colored.eyes);
    artwork={body:body.texture,eyes:eyes.texture,bodyUrl:body.url,eyesUrl:eyes.url};variants.set(key,artwork);
  }
  return artwork;
}
export function pawnBody(appearance:PawnAppearance,size=24):Container {
  const body=new Container(),artwork=pawnArtwork(appearance);
  for(const texture of [artwork.body,artwork.eyes]){
    const sprite=new Sprite(texture);sprite.anchor.set(.5);sprite.width=size;sprite.height=size;sprite.roundPixels=true;body.addChild(sprite);
  }
  if(appearance.hair&&appearance.hair!=='none')body.addChild(spriteArtwork(appearance.hair,size));
  return body;
}
