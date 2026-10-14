import type {Walls,Wall} from './walls';
import {rayTiles} from './shooting.ts';
export const TORCH_RADIUS=4;
export function torchIlluminates(walls:Walls,torch:Wall,column:number,row:number):boolean {
  return Math.hypot(column-torch.column,row-torch.row)<=TORCH_RADIUS&&!rayTiles(torch,{column,row}).some(tile=>{const wall=walls.at(tile);return wall?.state==='completed'&&wall.kind==='wall';});
}
export function buildTorchLight(walls:Walls,samples=8):Uint8Array {
  const size=walls.mapSize*samples,data=new Uint8Array(size*size*4);
  for(let i=3;i<data.length;i+=4)data[i]=255;
  for(const torch of walls.items.values()){
    if(torch.kind!=='torch'||torch.state!=='completed')continue;
    const visible=new Set<number>();
    for(let row=Math.max(0,torch.row-4);row<=Math.min(walls.mapSize-1,torch.row+4);row++)for(let column=Math.max(0,torch.column-4);column<=Math.min(walls.mapSize-1,torch.column+4);column++)
      if(torchIlluminates(walls,torch,column,row))visible.add(row*walls.mapSize+column);
    for(let y=Math.max(0,(torch.row-4)*samples);y<Math.min(size,(torch.row+5)*samples);y++)for(let x=Math.max(0,(torch.column-4)*samples);x<Math.min(size,(torch.column+5)*samples);x++){
      if(!visible.has(Math.floor(y/samples)*walls.mapSize+Math.floor(x/samples)))continue;
      const distance=Math.hypot((x+.5)/samples-torch.column-.5,(y+.5)/samples-torch.row-.5);
      const intensity=Math.round(Math.max(0,1-distance/TORCH_RADIUS)*.95*255),index=(y*size+x)*4;
      data[index]=Math.max(data[index],intensity);
    }
  }
  return data;
}
