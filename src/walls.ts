import {Rooms} from './rooms.ts';
import { invalidatePaths, registerPathCache, registerReachability, registerHierarchy, invalidateHierarchy } from './pathfinding.ts';
import type { ItemType } from './items';
import type { EnvironmentObject } from './environment';
import type { Movement, Tile } from './movement';

export type DoorMode='automatic'|'closed'|'open';
export type WallMaterial = 'wood' | 'stone';
export type ConstructionKind = 'wall' | 'door' | 'barricade' | 'storage' | 'storageArea' | 'butcher' | 'cooker' | 'torch' | 'bed' | 'table' | 'chair' | 'stoneFloor' | 'woodFloor';
export const isFloor=(kind:ConstructionKind):boolean=>kind==='stoneFloor'||kind==='woodFloor';
export const requiresItemClearance=(kind:ConstructionKind):boolean=>!isFloor(kind)&&kind!=='storageArea';
export const constructionKey=(tile:Tile&{kind?:ConstructionKind}):string=>`${tile.kind&&isFloor(tile.kind)?'floor:':''}${tile.column},${tile.row}`;
export interface Wall extends Tile {
  kind: ConstructionKind;
  orientation?: 0 | 1;
  cooking?:import('./cooking').CookingState;
  butcher?: import('./butchery').ButcherState;
  material: WallMaterial;
  state: 'planned' | 'completed' | 'cancelled';
  delivered: number;
  workSeconds: number;
  hp?: number;
  openness?: number;
  doorMode?:DoorMode;
  storedCorpses?: import('./needs').EatingWorker[];
  stored?: Record<ItemType, number>;
  demolition?: boolean;
  demolitionSeconds?: number;
  accepted?: Record<ItemType, boolean>;
}

export const WALL_COLORS: Record<WallMaterial, number> = {
  wood: 0x916039,
  stone: 0x929292,
};
export const WALL_PLAN_ALPHA = 0.3;
export const BUILD_RECIPES: Record<ConstructionKind, { materialCount: number; seconds: number } | null> = {
  stoneFloor:{materialCount:1,seconds:.2},
  woodFloor:{materialCount:1,seconds:.2},
  wall: { materialCount: 2, seconds: 1 },
  door: { materialCount: 15, seconds: 1 },
  barricade: { materialCount: 5, seconds: 1 },
  storage: { materialCount: 30, seconds: 3 },
  storageArea: { materialCount: 0, seconds: 0 },
  butcher: { materialCount: 30, seconds: 3 },
  cooker: { materialCount:30,seconds:4 },
  torch:{materialCount:1,seconds:1},
  bed:{materialCount:5,seconds:3},
  table:{materialCount:10,seconds:3},
  chair:{materialCount:3,seconds:1},
};

export function footprint(wall: Pick<Wall, 'column' | 'row' | 'kind' | 'orientation'>): Tile[] {
  if(wall.kind==='table')return [0,1].map(offset=>({column:wall.column+(wall.orientation?0:offset),row:wall.row+(wall.orientation?offset:0)}));
  if(wall.kind==='bed')return [0,1].map(offset=>({column:wall.column+(wall.orientation?offset:0),row:wall.row+(wall.orientation?0:offset)}));
  if (wall.kind !== 'butcher' && wall.kind !== 'cooker') return [{ column: wall.column, row: wall.row }];
  const horizontal=wall.kind==='cooker'?!wall.orientation:Boolean(wall.orientation);
  return [-1, 0, 1].map(offset => ({ column: wall.column + (horizontal ? offset : 0), row: wall.row + (horizontal ? 0 : offset) }));
}

export class Walls {
  readonly items = new Map<string, Wall>();
  private readonly completed=new WeakSet<Wall>();
  private occupied = new Map<string, Wall>();
  readonly mapSize: number;
  revision=0;
  readonly rooms:Rooms;
  environmentAt: (tile: Tile) => EnvironmentObject | undefined = () => undefined;
  environmentCannotStop: (tile: Tile) => boolean = () => false;

  constructor(mapSize: number) {
    this.mapSize = mapSize;
    this.rooms=new Rooms(mapSize,()=>this.items.values(),footprint);
    registerPathCache(this.isBlocked);
    registerPathCache(this.nonPlayerBlocked,this.isBlocked);
    registerReachability(this.isBlocked,(from,to)=>this.rooms.reachable(from,to,true));
    registerReachability(this.nonPlayerBlocked,(from,to)=>this.rooms.reachable(from,to,false));
    registerHierarchy(this.isBlocked,mapSize,()=>this.rooms.obstacles(true));
    registerHierarchy(this.nonPlayerBlocked,mapSize,()=>this.rooms.obstacles(false));
  }

  plan(tile: Tile, material: WallMaterial, kind: ConstructionKind = 'wall', orientation: 0 | 1 = 0): Wall | null {
    if (!Number.isInteger(tile.column) || !Number.isInteger(tile.row)
      || tile.column < 0 || tile.row < 0 || tile.column >= this.mapSize || tile.row >= this.mapSize) return null;
    const key = constructionKey({...tile,kind});
    const floor=isFloor(kind);
    const cells = footprint({ ...tile, kind, orientation });
    if (cells.some(cell => cell.column < 0 || cell.row < 0 || cell.column >= this.mapSize || cell.row >= this.mapSize || (floor?this.floorAt(cell):this.at(cell)))) return null;
    const wall: Wall = { ...tile, material, kind, orientation, state: 'planned', delivered: 0, workSeconds: 0, ...(floor?{}:{hp:100}) };
    if (kind === 'storage' || kind === 'storageArea') { wall.material = 'wood'; wall.stored = { wood: 0, stone: 0, strawberry: 0, ration: 0, rifle: 0, knife: 0, meat: 0, humanCorpse: 0, deerCorpse: 0, wolfCorpse: 0, hat: 0, jacket: 0, trousers: 0, ballisticVest: 0, gloves: 0 }; wall.accepted = { wood: true, stone: true, strawberry: true, ration: true, rifle: true, knife: true, meat: true, humanCorpse: true, deerCorpse: true, wolfCorpse: true, hat: true, jacket: true, trousers: true, ballisticVest: true, gloves: true }; }
    if (kind==='stoneFloor') wall.material='stone';
    if (kind==='woodFloor'||kind === 'door'||kind==='torch'||kind==='bed') wall.material='wood';
    if(kind==='cooker'){wall.material='wood';wall.cooking={mode:'count',remaining:0,target:0,seconds:0,meat:0,strawberry:0};}
    if (kind === 'butcher') { wall.material = 'wood'; wall.butcher = { mode: 'count', remaining: 0, target: 0, seconds: 0 }; }
    this.revision++;
    this.items.set(key, wall);
    if(!floor)for (const cell of cells) this.occupied.set(`${cell.column},${cell.row}`, wall);
    if(kind==='storageArea')this.complete(wall);
    return wall;
  }

  complete(tile: Tile): boolean {
    const wall = this.at(tile)??this.floorAt(tile);
    if (!wall || wall.state === 'completed') return false;
    wall.state = 'completed';
    this.completed.add(wall);
    this.rooms.structureChanged(wall);
    this.invalidateChunks(wall);
    this.revision++;
    if(!isFloor(wall.kind))invalidatePaths(this.isBlocked);
    return true;
  }

  removePlan(tile: Tile): Wall | null {
    const structure=this.at(tile);
    const item = structure?.state==='planned'?structure:this.floorAt(tile);
    if (!item || item.state !== 'planned') return null;
    item.state = 'cancelled';
    this.erase(item);
    if(!isFloor(item.kind))invalidatePaths(this.isBlocked);
    return item;
  }

  private invalidateChunks(wall:Wall):void{
    if(!['wall','door','storage','butcher','cooker','bed','table'].includes(wall.kind))return;
    const cells=footprint(wall);invalidateHierarchy(this.isBlocked,cells);invalidateHierarchy(this.nonPlayerBlocked,cells);
  }

  floorAt(tile:Tile):Wall|undefined{return this.items.get(`floor:${tile.column},${tile.row}`);}
  speedMultiplier=(tile:Tile):number=>this.floorAt(tile)?.state==='completed'?1.2:1;
  // Position lookups exclude ground; a construction reference keeps its own layer.
  at(tile: Tile): Wall | undefined { if('kind' in tile&&isFloor((tile as Wall).kind))return this.floorAt(tile);return this.occupied.get(`${tile.column},${tile.row}`) ?? this.items.get(`${tile.column},${tile.row}`); }

  erase(item: Wall): void {
    if(this.completed.has(item)||item.state==='completed'){this.rooms.structureChanged(item);this.invalidateChunks(item);this.completed.delete(item);}
    this.revision++;
    this.items.delete(constructionKey(item));
    if(!isFloor(item.kind))for (const cell of footprint(item)) this.occupied.delete(`${cell.column},${cell.row}`);
    if(!isFloor(item.kind))invalidatePaths(this.isBlocked);
  }

  isBlocked = (tile: Tile): boolean => {
    const item = this.occupied.get(`${tile.column},${tile.row}`);
    return item?.state === 'completed' && ((item.kind==='door'&&item.doorMode==='closed'&&(item.openness??0)<=0)||item.kind === 'wall' || item.kind === 'storage' || item.kind === 'butcher' || item.kind==='cooker' || item.kind==='bed' || item.kind==='table');
  };

  nonPlayerBlocked = (tile: Tile): boolean => {
    const door=this.occupied.get(`${tile.column},${tile.row}`);
    return this.isBlocked(tile) || (door?.state==='completed' && door.kind==='door' && (door.openness??0)<=0);
  };

  setDoorMode(door:Wall,mode:DoorMode):void {
    if(door.kind!=='door'||door.state!=='completed'||(door.doorMode??'automatic')===mode)return;
    door.doorMode=mode;
    this.rooms.doorChanged(true);
    invalidateHierarchy(this.isBlocked,[door]);invalidateHierarchy(this.nonPlayerBlocked,[door]);invalidatePaths(this.isBlocked);
  }

  setDoorOpenness(door:Wall,openness:number):void {
    const wasOpen=(door.openness??0)>0;
    door.openness=Math.max(0,Math.min(1,openness));
    if(wasOpen!==(door.openness>0)){this.rooms.doorChanged(door.doorMode==='closed');if(door.doorMode==='closed')invalidateHierarchy(this.isBlocked,[door]);invalidateHierarchy(this.nonPlayerBlocked,[door]);invalidatePaths(this.nonPlayerBlocked);}
  }

  bindMovement(movement: Movement, faction: import('./factions').Faction): void {
    movement.speedMultiplier=this.speedMultiplier;
    movement.terrainBlocked=faction==='player'?this.isBlocked:this.nonPlayerBlocked;
  }

  cannotStop = (tile: Tile): boolean => {
    const item = this.occupied.get(`${tile.column},${tile.row}`);
    return (item?.state === 'completed' && item.kind === 'barricade') || this.environmentCannotStop(tile);
  };
}

// Fill skipped tiles when a drag crosses several cells between pointer events.
export function dragTiles(from: Tile, to: Tile): Tile[] {
  const steps = Math.max(Math.abs(to.column - from.column), Math.abs(to.row - from.row));
  if (steps === 0) return [{ ...to }];
  return Array.from({ length: steps + 1 }, (_, index) => ({
    column: Math.round(from.column + (to.column - from.column) * index / steps),
    row: Math.round(from.row + (to.row - from.row) * index / steps),
  }));
}
