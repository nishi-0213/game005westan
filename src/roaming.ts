import { canPlan, canRoam } from './path-schedule.ts';
import type { Movement } from './movement';
import { setRoute } from './movement.ts';
import { findPath, findPaths, commandMove } from './pathfinding.ts';
import type { Walls } from './walls';

export interface Roamer { movement: Movement; freeSeconds?: number }
export function updateRoaming(pawn: Roamer, walls: Walls, seconds: number, random: () => number = Math.random): void {
  pawn.freeSeconds = (pawn.freeSeconds ?? 0) + seconds;
  const movement = pawn.movement;
  if (movement.pendingRoute || pawn.freeSeconds + 1e-9 < 5 || movement.nextTile || movement.tile.column !== movement.destination.column || movement.tile.row !== movement.destination.row) return;
  if(!canPlan(movement)||!canRoam(movement))return;
  pawn.freeSeconds = 0;
  const candidates=[];
  const blocked=movement.terrainBlocked??walls.isBlocked;
  for(let row=Math.max(0,movement.tile.row-3);row<=Math.min(walls.mapSize-1,movement.tile.row+3);row++)
    for(let column=Math.max(0,movement.tile.column-3);column<=Math.min(walls.mapSize-1,movement.tile.column+3);column++){
      const goal={column,row};
      if((column!==movement.tile.column||row!==movement.tile.row)&&!blocked(goal)&&!walls.cannotStop(goal)&&!movement.stopBlocked?.(goal))candidates.push(goal);
    }
  let fallback:ReturnType<typeof findPaths>|undefined;
  while(candidates.length){
    const goal=candidates.splice(Math.floor(random()*candidates.length),1)[0];
    if(movement.queuedPlanning){if(commandMove(movement,goal,walls.mapSize,blocked,walls.cannotStop))return;continue;}
    const path=fallback?fallback.get(goal.row*walls.mapSize+goal.column):findPath(movement.tile,goal,walls.mapSize,blocked,walls.cannotStop,movement);
    if(path){setRoute(movement,path.tiles);return;}
    // Reuse a single reachable-component search if the first candidate is sealed off.
    fallback??=findPaths(movement.tile,walls.mapSize,blocked,walls.cannotStop,movement);
  }
}
