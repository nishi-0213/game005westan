import {movementHasSafeExit} from './movement.ts';
import type {Movement,Tile} from './movement';
import {footprint} from './walls.ts';
import type {Wall,Walls} from './walls';
interface ConstructionOccupant {
  movement:Movement;
  faction?:string;
  dead?:boolean;
  consumed?:boolean;
  corpseCarrier?:unknown;
  corpseStation?:unknown;
  corpseStorage?:unknown;
}
/** Prevent this structure from covering an actor or removing an existing safe exit. */
export function constructionHasClearance(walls:Walls,item:Wall,actors:readonly ConstructionOccupant[]):boolean {
  const cells=footprint(item);
  const sameTile=(entry:Tile)=>cells.some(cell=>entry.column===cell.column&&entry.row===cell.row);
  const solid=['wall','storage','bed','table','butcher','cooker'].includes(item.kind);
  const blockedAfter=(entry:Tile)=>walls.isBlocked(entry)||(solid&&sameTile(entry));
  const cannotStopAfter=(entry:Tile)=>walls.cannotStop(entry)||(item.kind==='barricade'&&sameTile(entry));
  return !actors.some(actor=>{
    if(actor.consumed||actor.corpseCarrier||actor.corpseStation||actor.corpseStorage)return false;
    const {movement,faction}=actor;
    const occupied=actor.dead?[movement.tile]:[movement.tile,movement.nextTile,movement.destination];
    if(!actor.dead&&solid&&movement.nextTile&&movement.nextTile.column!==movement.tile.column&&movement.nextTile.row!==movement.tile.row){
      occupied.push({column:movement.nextTile.column,row:movement.tile.row},{column:movement.tile.column,row:movement.nextTile.row});
    }
    if(occupied.some(entry=>entry&&sameTile(entry)))return true;
    if(actor.dead)return false;
    const blockedBefore=faction!=='player'?walls.nonPlayerBlocked:walls.isBlocked;
    const blocked=faction!=='player'?(entry:Tile)=>walls.nonPlayerBlocked(entry)||blockedAfter(entry)||(item.kind==='door'&&sameTile(entry)):blockedAfter;
    // Sleepers intentionally occupy blocked bed cells. An unrelated existing
    // obstruction must not veto construction everywhere on the map.
    return movementHasSafeExit(movement,blockedBefore,walls.cannotStop)&&!movementHasSafeExit(movement,blocked,cannotStopAfter);
  });
}
