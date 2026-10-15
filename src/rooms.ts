import type {Tile} from './movement';
import type {Wall} from './walls';

export interface Room { id:number; area:number; outdoors:boolean }
export interface RoomDoor { door:Wall; roomIds:number[] }
const movementObstacle=new Set(['wall','storage','butcher','cooker','bed','table']);

/** Room boundaries and faction reachability are separate topologies. */
export class Rooms {
  readonly size:number;
  generation=0;
  private readonly structures:()=>Iterable<Wall>;
  private readonly footprint:(wall:Wall)=>Tile[];
  private readonly queue:Int32Array;
  private readonly roomMask:Uint8Array;
  private readonly playerMask:Uint8Array;
  private readonly otherMask:Uint8Array;
  private roomLabels:Int32Array;
  private playerLabels:Int32Array;
  private otherLabels:Int32Array;
  private roomList:Room[]=[];
  private doorList:RoomDoor[]=[];
  private masksDirty=true;
  private roomsDirty=true;
  private playerDirty=true;
  private otherDirty=true;
  constructor(size:number,structures:()=>Iterable<Wall>,footprint:(wall:Wall)=>Tile[]){
    this.size=size;this.structures=structures;this.footprint=footprint;
    this.queue=new Int32Array(size*size);
    this.roomMask=new Uint8Array(size*size);this.playerMask=new Uint8Array(size*size);this.otherMask=new Uint8Array(size*size);
    this.roomLabels=new Int32Array(size*size);this.playerLabels=new Int32Array(size*size);this.otherLabels=new Int32Array(size*size);
  }
  structureChanged(wall:Wall):void{
    if(wall.kind!=='door'&&!movementObstacle.has(wall.kind))return;
    this.masksDirty=true;this.playerDirty=true;this.otherDirty=true;
    if(wall.kind==='wall'||wall.kind==='door')this.roomsDirty=true;
  }
  doorChanged():void{this.otherDirty=true;}
  private masks():void{
    if(!this.masksDirty)return;
    this.roomMask.fill(0);this.playerMask.fill(0);
    for(const wall of this.structures())if(wall.state==='completed')for(const tile of this.footprint(wall)){
      const index=tile.row*this.size+tile.column;
      if(wall.kind==='wall'||wall.kind==='door')this.roomMask[index]=1;
      if(movementObstacle.has(wall.kind))this.playerMask[index]=1;
    }
    this.masksDirty=false;
  }
  private flood(mask:Uint8Array,labels:Int32Array,describe=true):Room[]{
    labels.fill(0);const groups:Room[]=[],size=this.size;let count=0;
    for(let start=0;start<labels.length;start++){
      if(mask[start]||labels[start])continue;
      const id=++count;let head=0,tail=1,outdoors=false;this.queue[0]=start;labels[start]=id;
      while(head<tail){
        const index=this.queue[head++],column=index%size,row=Math.floor(index/size);
        if(!column||!row||column===size-1||row===size-1)outdoors=true;
        for(let direction=0;direction<4;direction++){
          const next=direction===0?(column?index-1:-1):direction===1?(column<size-1?index+1:-1):direction===2?(row?index-size:-1):(row<size-1?index+size:-1);
          if(next>=0&&!mask[next]&&!labels[next]){labels[next]=id;this.queue[tail++]=next;}
        }
      }
      if(describe)groups.push({id,area:tail,outdoors});
    }
    return groups;
  }
  update():void{
    if(!this.roomsDirty)return;
    this.masks();this.roomList=this.flood(this.roomMask,this.roomLabels);this.doorList=[];
    for(const door of this.structures())if(door.state==='completed'&&door.kind==='door'){
      const ids=new Set<number>();
      for(const [dc,dr]of [[-1,0],[1,0],[0,-1],[0,1]]){
        const column=door.column+dc,row=door.row+dr;
        if(column>=0&&row>=0&&column<this.size&&row<this.size){const id=this.roomLabels[row*this.size+column];if(id)ids.add(id);}
      }
      this.doorList.push({door,roomIds:[...ids]});
    }
    this.roomsDirty=false;this.generation++;
  }
  get rooms():readonly Room[]{this.update();return this.roomList;}
  get doors():readonly RoomDoor[]{this.update();return this.doorList;}
  roomAt(tile:Tile):Room|undefined{
    this.update();const index=this.index(tile);return index<0?undefined:this.roomList[this.roomLabels[index]-1];
  }
  private index(tile:Tile):number{return tile.column>=0&&tile.row>=0&&tile.column<this.size&&tile.row<this.size?tile.row*this.size+tile.column:-1;}
  reachable(start:Tile,goal:Tile,player:boolean):boolean{
    const from=this.index(start),to=this.index(goal);
    // A pawn waking inside a bed or leaving the map still uses the existing route search.
    if(from<0||to<0)return true;
    this.masks();
    if(player&&this.playerDirty){this.flood(this.playerMask,this.playerLabels,false);this.playerDirty=false;}
    if(!player&&this.otherDirty){
      this.otherMask.set(this.playerMask);
      for(const door of this.structures())if(door.kind==='door'&&door.state==='completed'&&(door.openness??0)<=0)this.otherMask[door.row*this.size+door.column]=1;
      this.flood(this.otherMask,this.otherLabels,false);this.otherDirty=false;
    }
    const labels=player?this.playerLabels:this.otherLabels;
    return !labels[from]||labels[from]===labels[to];
  }
}
