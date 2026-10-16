import { findPaths } from './pathfinding.ts';
import type { Movement } from './movement';
import type { Walls } from './walls';
import type { Clothing, ClothingSlot, MapItem } from './items';

/** Keep clothes equipped if there is no reachable, empty ground cell to put them on. */
export function unequipClothing(worker:{clothing?:Clothing;movement:Movement},slot:ClothingSlot,items:MapItem[],walls:Walls):boolean {
  const type=worker.clothing?.[slot];if(!type)return false;
  const origin=worker.movement.tile;
  const paths=findPaths(worker.movement.nextTile??origin,walls.mapSize,walls.isBlocked,walls.cannotStop,worker.movement);
  for(const index of paths.keys()){
    const tile={column:index%walls.mapSize,row:Math.floor(index/walls.mapSize)};
    if(tile.column===origin.column&&tile.row===origin.row||walls.at(tile)||walls.floorAt(tile)?.state==='planned'||walls.cannotStop(tile)
      ||items.some(item=>item.quantity>0&&item.column===tile.column&&item.row===tile.row))continue;
    items.push({...tile,type,quantity:1});delete worker.clothing![slot];return true;
  }
  return false;
}
