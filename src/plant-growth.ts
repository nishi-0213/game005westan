import { createEnvironment } from './environment.ts';
import type { EnvironmentObject } from './environment';
import type { Tile } from './movement';
import type { Walls } from './walls';
import { invalidatePaths } from './pathfinding.ts';

export class PlantGrowth {
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
    for (const object of objects) if (object.type !== 'rock' && !object.collected && object.hp < 100) this.growing.add(object);
  }

  update(seconds: number): void {
    let remaining = Math.max(0, seconds);
    while (remaining > 0) {
      const step = Math.min(remaining, 60 - this.elapsed);
      for (const object of this.growing) {
        if (object.collected) { this.growing.delete(object); continue; }
        object.hp = Math.min(100, object.hp + 99 * step / 60);
        if (object.hp >= 100 - 1e-9) { object.hp = 100; this.growing.delete(object); }
      }
      remaining -= step;
      this.elapsed += step;
      if (this.elapsed >= 60 - 1e-9) { this.elapsed = 0; this.spawn(); }
    }
  }

  private spawn(): void {
    const occupied = new Set(this.objects.filter(object => !object.collected).map(object => `${object.column},${object.row}`));
    const available: Tile[] = [];
    for (let row = 0; row < this.walls.mapSize; row++) for (let column = 0; column < this.walls.mapSize; column++) {
      const tile = { column, row }, key = `${column},${row}`;
      if (!occupied.has(key) && !this.walls.items.has(key) && !this.occupied(tile)) available.push(tile);
    }
    let spawned = false;
    for (const type of ['tree', 'wildStrawberry'] as const) {
      const count = 2 + Math.floor(this.random() * 2);
      for (let i = 0; i < count && available.length; i++) {
        const tile = available.splice(Math.floor(this.random() * available.length), 1)[0];
        const object = createEnvironment(type, tile);
        this.objects.push(object);
        this.growing.add(object);
        this.onSpawn(object);
        spawned = true;
      }
    }
    if (spawned) invalidatePaths(this.walls.isBlocked);
  }
}
