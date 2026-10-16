export interface PawnAppearance { skinRed:number; skinDark:number; eyeSaturation:number }
export interface PawnLayers { width:number; height:number; body:Uint8ClampedArray; eyes:Uint8ClampedArray }
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
export function randomPawnAppearance(random:()=>number=Math.random):PawnAppearance {
  const pick=()=>Math.min(5,Math.floor(clamp(random())*6))/5;
  return {skinRed:pick(),skinDark:pick()*.65,eyeSaturation:.2+pick()*.8};
}
/** Compatibility source for the original 32px pawn until separate PNG files are available. */
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
      const midpoint=(Math.max(eyes[offset],eyes[offset+1],eyes[offset+2])+Math.min(eyes[offset],eyes[offset+1],eyes[offset+2]))/2;
      for(let channel=0;channel<3;channel++)eyes[offset+channel]=Math.round(midpoint+(eyes[offset+channel]-midpoint)*saturation);
    }
  }
  return {...layers,body,eyes};
}
