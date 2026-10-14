import { Graphics } from 'pixi.js';
import type { Walls,Wall } from './walls';
import { daylight } from './game-time.ts';
export class StructureShadows {
  readonly view=new Graphics();
  private revision=-1;
  private signature='';
  private structures:Wall[]=[];
  private walls:Walls;
  private tileSize:number;
  constructor(walls:Walls,tileSize:number){this.walls=walls;this.tileSize=tileSize;this.view.eventMode='none';}
  update(hour:number):void {
    const signature=`${this.walls.revision}:${Math.floor(hour*20)}`;
    if(signature===this.signature)return;
    this.signature=signature;
    if(this.revision!==this.walls.revision){this.revision=this.walls.revision;this.structures=[...this.walls.items.values()].filter(s=>s.state==='completed'&&(s.kind==='wall'||s.kind==='door'));}
    this.view.clear();const light=daylight(hour);this.view.visible=light.shadowAlpha>0;
    if(!this.view.visible)return;
    const size=this.tileSize,dx=light.shadowX*size,dy=light.shadowY*size;
    for(const structure of this.structures){
      const x=structure.column*size,y=structure.row*size;
      const polygon=dx>=0?[x,y,x+size,y,x+size+dx,y+dy,x+size+dx,y+size+dy,x+dx,y+size+dy,x,y+size]
        :[x,y,x+size,y,x+size,y+size,x+size+dx,y+size+dy,x+dx,y+size+dy,x+dx,y+dy];
      this.view.poly(polygon);
    }
    this.view.fill({color:0x08111d,alpha:light.shadowAlpha});
  }
}
