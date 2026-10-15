import type {Tile} from './movement';
export const PATH_CHUNK_SIZE=16;
interface Region { id:number; x:number; y:number; edges:Set<number> }

/** Components inside 16x16 chunks, connected through all traversable chunk borders. */
export class HierarchicalMap {
  revision=0;
  readonly size:number;
  readonly labels:Int32Array;
  private readonly width:number;
  private readonly snapshot:()=>Uint8Array;
  private readonly dirty=new Set<number>();
  private readonly chunks=new Map<number,number[]>();
  private readonly corridors=new Map<string,Set<number>>();
  private readonly regions=new Map<number,Region>();
  private readonly queue=new Int32Array(PATH_CHUNK_SIZE*PATH_CHUNK_SIZE);
  constructor(size:number,snapshot:()=>Uint8Array){
    this.size=size;this.snapshot=snapshot;this.width=Math.ceil(size/PATH_CHUNK_SIZE);this.labels=new Int32Array(size*size);
    for(let i=0;i<this.width*this.width;i++)this.dirty.add(i);
  }
  invalidate(tiles:readonly Tile[]):void{
    this.revision++;this.corridors.clear();
    for(const tile of tiles)this.dirty.add(Math.floor(tile.row/PATH_CHUNK_SIZE)*this.width+Math.floor(tile.column/PATH_CHUNK_SIZE));
  }
  private rebuild(chunk:number,mask:Uint8Array):void{
    for(const id of this.chunks.get(chunk)??[]){for(const neighbor of this.regions.get(id)?.edges??[])this.regions.get(neighbor)?.edges.delete(id);this.regions.delete(id);}
    const x0=chunk%this.width*PATH_CHUNK_SIZE,y0=Math.floor(chunk/this.width)*PATH_CHUNK_SIZE,x1=Math.min(this.size,x0+PATH_CHUNK_SIZE),y1=Math.min(this.size,y0+PATH_CHUNK_SIZE),ids:number[]=[];
    for(let row=y0;row<y1;row++)this.labels.fill(0,row*this.size+x0,row*this.size+x1);
    for(let row=y0;row<y1;row++)for(let column=x0;column<x1;column++){
      const start=row*this.size+column;if(mask[start]||this.labels[start])continue;
      const id=start+1;let head=0,tail=1,sumX=0,sumY=0;this.queue[0]=start;this.labels[start]=id;
      while(head<tail){const index=this.queue[head++],x=index%this.size,y=Math.floor(index/this.size);sumX+=x;sumY+=y;
        for(let d=0;d<4;d++){const next=d===0?(x>x0?index-1:-1):d===1?(x+1<x1?index+1:-1):d===2?(y>y0?index-this.size:-1):(y+1<y1?index+this.size:-1);if(next>=0&&!mask[next]&&!this.labels[next]){this.labels[next]=id;this.queue[tail++]=next;}}
      }
      ids.push(id);this.regions.set(id,{id,x:sumX/tail,y:sumY/tail,edges:new Set()});
    }
    this.chunks.set(chunk,ids);
    const link=(a:number,b:number)=>{const x=this.labels[a],y=this.labels[b];if(x&&y&&x!==y&&this.regions.has(x)&&this.regions.has(y)){this.regions.get(x)!.edges.add(y);this.regions.get(y)!.edges.add(x);}};
    for(let y=y0;y<y1;y++){if(x0)link(y*this.size+x0,y*this.size+x0-1);if(x1<this.size)link(y*this.size+x1-1,y*this.size+x1);}
    for(let x=x0;x<x1;x++){if(y0)link(y0*this.size+x,(y0-1)*this.size+x);if(y1<this.size)link((y1-1)*this.size+x,y1*this.size+x);}
  }
  *corridor(start:Tile,goal:Tile):Generator<void,Set<number>|null>{
    if(this.dirty.size){const mask=this.snapshot();while(this.dirty.size){const chunk=this.dirty.values().next().value!;this.dirty.delete(chunk);this.rebuild(chunk,mask);yield;}}
    const source=this.labels[start.row*this.size+start.column],target=this.labels[goal.row*this.size+goal.column];
    if(!source||!target)return null;
    const key=`${source}:${target}`,cached=this.corridors.get(key);if(cached)return cached;
    const finish=this.regions.get(target)!,cost=new Map([[source,0]]),previous=new Map<number,number>(),open=[source],closed=new Set<number>();
    const estimate=(id:number)=>{const node=this.regions.get(id)!;return (cost.get(id)??Infinity)+Math.hypot(node.x-finish.x,node.y-finish.y);};
    while(open.length){let best=0;for(let i=1;i<open.length;i++)if(estimate(open[i])<estimate(open[best]))best=i;const id=open.splice(best,1)[0];if(closed.has(id))continue;
      if(id===target){const route=new Set<number>();let cursor=id;while(true){route.add(cursor);if(cursor===source)break;cursor=previous.get(cursor)!;}
        // A one-region halo permits local shortcuts without opening the entire map.
        for(const member of [...route])for(const neighbor of this.regions.get(member)!.edges)route.add(neighbor);
        this.corridors.set(key,route);if(this.corridors.size>128)this.corridors.delete(this.corridors.keys().next().value!);
        return route;
      }
      closed.add(id);const node=this.regions.get(id)!;
      for(const next of node.edges){const neighbor=this.regions.get(next)!,distance=cost.get(id)!+Math.hypot(node.x-neighbor.x,node.y-neighbor.y);if(!closed.has(next)&&distance<(cost.get(next)??Infinity)){cost.set(next,distance);previous.set(next,id);open.push(next);}}
      yield;
    }
    return null;
  }
}
