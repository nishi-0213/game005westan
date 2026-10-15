import { Container, Graphics } from 'pixi.js';
import type { Walls,Wall } from './walls';
import { daylight } from './game-time.ts';
export class StructureShadows {
  readonly view=new Container();
  private readonly shape=new Graphics();
  private readonly shade=new Graphics();
  private revision=-1;
  private signature='';
  private structures:Wall[]=[];
  private walls:Walls;
  private tileSize:number;
  constructor(walls:Walls,tileSize:number){this.walls=walls;this.tileSize=tileSize;this.view.eventMode='none';this.view.addChild(this.shape,this.shade);this.shade.mask=this.shape;}
  update(hour:number):void {
    const signature=`${this.walls.revision}:${Math.floor(hour*20)}`;
    if(signature===this.signature)return;
    this.signature=signature;
    if(this.revision!==this.walls.revision){this.revision=this.walls.revision;this.structures=[...this.walls.items.values()].filter(s=>s.state==='completed'&&(s.kind==='wall'||s.kind==='door'));}
    this.shape.clear();this.shade.clear();const light=daylight(hour);this.view.visible=light.shadowAlpha>0;
    if(!this.view.visible)return;
    const size=this.tileSize,dx=light.shadowX*size,dy=light.shadowY*size;
    for(const structure of this.structures){
      const x=structure.column*size,y=structure.row*size;
      const polygon=dx>=0?[x,y,x+size,y,x+size+dx,y+dy,x+size+dx,y+size+dy,x+dx,y+size+dy,x,y+size]
        :[x,y,x+size,y,x+size,y+size,x+size+dx,y+size+dy,x+dx,y+size+dy,x+dx,y+dy];
      this.shape.poly(polygon);
    }
    // Stencil the union of all silhouettes, then shade it once to avoid alpha stacking.
    this.shape.fill(0xffffff);
    if(this.structures.length){const bounds=this.shape.getLocalBounds();this.shade.rect(bounds.x,bounds.y,bounds.width,bounds.height).fill({color:0x08111d,alpha:light.shadowAlpha});}
  }
}
