import type { Tile } from './movement';
import type { Wall, Walls } from './walls';

// Include both touching cells when a ray crosses an exact grid corner.
export function rayTiles(from:Tile,to:Tile):Tile[] {
  const cells:Tile[]=[{...from}],seen=new Set([`${from.column},${from.row}`]);
  const add=(column:number,row:number)=>{const key=`${column},${row}`;if(!seen.has(key)){seen.add(key);cells.push({column,row});}};
  const dx=to.column-from.column,dy=to.row-from.row,sx=Math.sign(dx),sy=Math.sign(dy);
  const deltaX=dx?1/Math.abs(dx):Infinity,deltaY=dy?1/Math.abs(dy):Infinity;
  let tx=deltaX/2,ty=deltaY/2,column=from.column,row=from.row;
  while(column!==to.column||row!==to.row){
    if(Math.abs(tx-ty)<1e-9){add(column+sx,row);add(column,row+sy);column+=sx;row+=sy;tx+=deltaX;ty+=deltaY;}
    else if(tx<ty){column+=sx;tx+=deltaX;}else{row+=sy;ty+=deltaY;}
    add(column,row);
  }
  return cells;
}
export function shootingObstacles(walls:Walls,from:Tile,to:Tile,target?:Wall):{blocked:boolean;covered:boolean} {
  let covered=false;
  for(const cell of rayTiles(from,to)){
    const structure=walls.at(cell);if(structure?.state!=='completed'||structure===target)continue;
    if(structure.kind==='wall'||structure.kind==='door')return {blocked:true,covered};
    if(structure.kind==='barricade')covered=true;
  }
  return {blocked:false,covered};
}
