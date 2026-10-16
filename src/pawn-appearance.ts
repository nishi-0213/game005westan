export type HairStyle = 'none' | 'hair1' | 'hair2';
export interface PawnAppearance { skinRed:number; skinDark:number; eyeSaturation:number; eyeHue?:number; hair?:HairStyle }
export function randomHairStyle(random:()=>number=Math.random):HairStyle {
  return (['none','hair1','hair2'] as const)[Math.max(0,Math.min(2,Math.floor(random()*3)))];
}
export interface PawnLayers { width:number; height:number; body:Uint8ClampedArray; eyes:Uint8ClampedArray }
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
export function randomPawnAppearance(random:()=>number=Math.random):PawnAppearance {
  const pick=()=>Math.min(5,Math.floor(clamp(random())*6))/5;
  return {skinRed:pick(),skinDark:pick()*.65,eyeSaturation:.2+pick()*.8,eyeHue:Math.min(11,Math.floor(clamp(random())*12))*30};
}
/** Legacy helper for the original 32px pawn; the app now loads the supplied separate PNGs. */
export function splitPawnLayers(pixels:Uint8ClampedArray,width:number,height:number):PawnLayers {
  if(width!==32||height!==32||pixels.length!==width*height*4)throw new Error('The original pawn must be a 32×32 RGBA image');
  const body=new Uint8ClampedArray(pixels),eyes=new Uint8ClampedArray(pixels.length);
  for(let y=10;y<=13;y++)for(const x of [11,12,19,20]){
    const offset=(y*width+x)*4;
    // Preserve highlights and replace the original gray pupil with the blue base.
    eyes.set(pixels.slice(offset,offset+4),offset);
    if(eyes[offset]!==255)eyes.set([0,0,255,pixels[offset+3]],offset);
    body.set([255,217,209,pixels[offset+3]],offset);
  }
  return {width,height,body,eyes};
}
export function recolorPawnLayers(layers:PawnLayers,appearance:PawnAppearance):PawnLayers {
  const body=new Uint8ClampedArray(layers.body),eyes=new Uint8ClampedArray(layers.eyes);
  const red=clamp(appearance.skinRed),dark=1-clamp(appearance.skinDark),saturation=clamp(appearance.eyeSaturation);
  for(let offset=0;offset<body.length;offset+=4){
    const r=body[offset],g=body[offset+1],b=body[offset+2];
    // Restrict skin changes to warm pixels: keep transparency, black lines and neutral details.
    if(body[offset+3]&&r>g&&r>b){
      body[offset]=Math.round(r*dark);
      body[offset+1]=Math.round(g*(1-red*.18)*dark);
      body[offset+2]=Math.round(b*(1-red*.28)*dark);
    }
    if(eyes[offset+3]){
      const channels=[eyes[offset]/255,eyes[offset+1]/255,eyes[offset+2]/255];
      const max=Math.max(...channels),min=Math.min(...channels),delta=max-min,midpoint=(max+min)/2;
      if(delta){
        const [r,g,b]=channels;
        let hue=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
        hue=((hue+(appearance.eyeHue??0)/60)%6+6)%6;
        const chroma=delta*saturation,x=chroma*(1-Math.abs(hue%2-1)),m=midpoint-chroma/2;
        const rgb=hue<1?[chroma,x,0]:hue<2?[x,chroma,0]:hue<3?[0,chroma,x]:hue<4?[0,x,chroma]:hue<5?[x,0,chroma]:[chroma,0,x];
        for(let channel=0;channel<3;channel++)eyes[offset+channel]=Math.round((rgb[channel]+m)*255);
      }
    }
  }
  return {...layers,body,eyes};
}
