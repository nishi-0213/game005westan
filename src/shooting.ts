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
// Cover protects only the target's tile and its eight neighbors on the shot ray.
// Multiple obstacles use the strongest cover rather than stacking penalties.
export function shootingObstacles(walls:Walls,from:Tile,to:Tile,target?:Wall):{blocked:boolean;accuracyPenalty:number} {
  let accuracyPenalty=0;
  for(const cell of rayTiles(from,to)){
    const structure=walls.at(cell);
    if(structure?.state==='completed'&&structure!==target&&(structure.kind==='wall'||structure.kind==='door'))return {blocked:true,accuracyPenalty};
    if(cell.column===from.column&&cell.row===from.row||Math.max(Math.abs(cell.column-to.column),Math.abs(cell.row-to.row))>1)continue;
    if(structure?.state==='completed'&&structure!==target&&structure.kind==='barricade')accuracyPenalty=.4;
    const object=walls.environmentAt(cell);
    if(object&&!object.collected&&(object.type==='tree'||object.type==='rock'))accuracyPenalty=Math.max(accuracyPenalty,.2);
  }
  return {blocked:false,accuracyPenalty};
}
