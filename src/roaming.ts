import { canPlan, canRoam } from './path-schedule.ts';
import type { Movement } from './movement';
import { setRoute } from './movement.ts';
import { findPaths } from './pathfinding.ts';
import type { Walls } from './walls';

export interface Roamer { movement: Movement; freeSeconds?: number }
export function updateRoaming(pawn: Roamer, walls: Walls, seconds: number, random: () => number = Math.random): void {
  pawn.freeSeconds = (pawn.freeSeconds ?? 0) + seconds;
  const movement = pawn.movement;
  if (pawn.freeSeconds + 1e-9 < 5 || movement.nextTile || movement.tile.column !== movement.destination.column || movement.tile.row !== movement.destination.row) return;
  if(!canPlan(movement)||!canRoam(movement))return;
  pawn.freeSeconds = 0;
  const paths = findPaths(movement.tile, walls.mapSize, walls.isBlocked, walls.cannotStop, movement);
  const nearby = [...paths.keys()].filter(index => {
    const column = index % walls.mapSize, row = Math.floor(index / walls.mapSize);
    return (column !== movement.tile.column || row !== movement.tile.row) && Math.abs(column - movement.tile.column) <= 3 && Math.abs(row - movement.tile.row) <= 3;
  });
  if (nearby.length) setRoute(movement, paths.get(nearby[Math.floor(random() * nearby.length)])!.tiles);
}
