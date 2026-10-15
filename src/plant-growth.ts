import { GAME_MINUTES_PER_SECOND } from './game-time.ts';
import { createEnvironment } from './environment.ts';
import type { EnvironmentObject } from './environment';
import type { Tile } from './movement';
import type { Walls } from './walls';
import { invalidatePaths } from './pathfinding.ts';

export class PlantGrowth {
  readonly living = new Set<EnvironmentObject>();
  readonly growing = new Set<EnvironmentObject>();
  readonly objects: EnvironmentObject[];
  readonly walls: Walls;
  readonly occupied: (tile: Tile) => boolean;
  readonly onSpawn: (object: EnvironmentObject) => void;
  readonly random: () => number;
  private elapsed = 0;

  constructor(objects: EnvironmentObject[], walls: Walls, occupied: (tile: Tile) => boolean,
    onSpawn: (object: EnvironmentObject) => void = () => {}, random: () => number = Math.random) {
    this.objects = objects; this.walls = walls; this.occupied = occupied;
    this.onSpawn = onSpawn; this.random = random;
    for (const object of objects) if (object.type !== 'rock' && !object.collected) { this.living.add(object); if (object.hp < 100) this.growing.add(object); }
  }

  update(seconds: number, startHour?:number): void {
    let remaining = Math.max(0, seconds);
    let hour=startHour===undefined?undefined:((startHour%24)+24)%24;
    while (remaining > 0) {
      const daylight=hour===undefined||hour>=6&&hour<18;
      const boundary=hour===undefined?Infinity:((daylight?18:hour<6?6:30)-hour)*60/GAME_MINUTES_PER_SECOND;
      const step = Math.min(remaining, 60 - this.elapsed,boundary);
      let expired = false;
      for (const object of this.living) {
        if (object.collected) { this.living.delete(object); continue; }
        object.ageSeconds = (object.ageSeconds ?? 0) + step;
        if (object.ageSeconds >= 180 - 1e-9) {
          object.collected = true; object.collect = false;
          this.living.delete(object); this.growing.delete(object); expired = true;
        }
      }
      if (expired) invalidatePaths(this.walls.isBlocked);
      for (const object of this.growing) {
        if (object.collected) { this.growing.delete(object); continue; }
        object.hp = Math.min(100, object.hp + (daylight?99 * step / 60:0));
        if (object.hp >= 100 - 1e-9) { object.hp = 100; this.growing.delete(object); }
      }
      remaining -= step;
      if(hour!==undefined){hour=(hour+step*GAME_MINUTES_PER_SECOND/60)%24;for(const edge of [0,6,18,24])if(Math.abs(hour-edge)<1e-9)hour=edge%24;}
      this.elapsed += step;
      if (this.elapsed >= 60 - 1e-9) { this.elapsed = 0; this.spawn(); }
    }
  }

  private spawn(): void {
    const occupied = new Set(this.objects.filter(object => !object.collected).map(object => `${object.column},${object.row}`));
    const available: Tile[] = [];
    for (let row = 0; row < this.walls.mapSize; row++) for (let column = 0; column < this.walls.mapSize; column++) {
      const tile = { column, row }, key = `${column},${row}`;
      if (!occupied.has(key) && !this.walls.at(tile) && !this.occupied(tile)) available.push(tile);
    }
    let spawned = false;
    for (const type of ['tree', 'wildStrawberry'] as const) {
      const count = (2 + Math.floor(this.random() * 2)) * (type === 'tree' ? 5 : 1);
      for (let i = 0; i < count && available.length; i++) {
        const tile = available.splice(Math.floor(this.random() * available.length), 1)[0];
        const object = createEnvironment(type, tile);
        this.objects.push(object);
        this.growing.add(object);
        this.living.add(object);
        this.onSpawn(object);
        spawned = true;
      }
    }
    if (spawned) invalidatePaths(this.walls.isBlocked);
  }
}
