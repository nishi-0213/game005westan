import { GAME_MINUTES_PER_SECOND } from './game-time.ts';
import { createEnvironment } from './environment.ts';
import type { EnvironmentObject, EnvironmentType } from './environment';
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
  private births: { time: number; type: Exclude<EnvironmentType, 'rock'> }[] = [];
  private birthIndex = 0;

  constructor(objects: EnvironmentObject[], walls: Walls, occupied: (tile: Tile) => boolean,
    onSpawn: (object: EnvironmentObject) => void = () => {}, random: () => number = Math.random) {
    this.objects = objects; this.walls = walls; this.occupied = occupied;
    this.onSpawn = onSpawn; this.random = random;
    this.scheduleBirths();
    for (const object of objects) if (object.type !== 'rock' && !object.collected) { this.living.add(object); if (object.hp < 100) this.growing.add(object); }
  }

  saveState(){return {elapsed:this.elapsed,births:this.births.map(b=>({...b})),birthIndex:this.birthIndex};}
  restoreState(state:ReturnType<PlantGrowth['saveState']>):void {this.elapsed=state.elapsed;this.births=state.births;this.birthIndex=state.birthIndex;}
  update(seconds: number, startHour?:number): void {
    let remaining = Math.max(0, seconds);
    let hour=startHour===undefined?undefined:((startHour%24)+24)%24;
    while (remaining > 0) {
      const daylight=hour===undefined||hour>=6&&hour<18;
      const boundary=hour===undefined?Infinity:((daylight?18:hour<6?6:30)-hour)*60/GAME_MINUTES_PER_SECOND;
      const nextBirth = this.births[this.birthIndex]?.time ?? 60;
      const step = Math.min(remaining, 60 - this.elapsed, boundary, Math.max(0, nextBirth - this.elapsed));
      let expired = false;
      for (const object of this.living) {
        if (object.collected) { this.living.delete(object); continue; }
        if (object.type === 'grass' && (this.walls.floorAt(object)?.state === 'completed' || this.walls.at(object)?.state === 'completed')) {
          object.collected = true; object.collect = false;
          this.living.delete(object); this.growing.delete(object);
          continue;
        }
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
      while (this.birthIndex < this.births.length && this.births[this.birthIndex].time <= this.elapsed + 1e-9) {
        this.spawn(this.births[this.birthIndex++].type);
      }
      if (this.elapsed >= 60 - 1e-9) { this.elapsed = 0; this.scheduleBirths(); }
    }
  }

  private scheduleBirths(): void {
    this.births = [];
    this.birthIndex = 0;
    for (const type of ['tree', 'wildStrawberry', 'grass'] as const) {
      const count = (2 + Math.floor(this.random() * 2)) * (type === 'tree' ? 50 : type === 'grass' ? 100 : 3);
      // Randomize every birth inside its own slot; species have independent clocks.
      for (let index = 0; index < count; index++) {
        this.births.push({ type, time: (index + .05 + .9 * this.random()) * 60 / count });
      }
    }
    this.births.sort((a, b) => a.time - b.time);
  }

  private spawn(type: Exclude<EnvironmentType, 'rock'>): void {
    const occupied = new Set(this.objects.filter(object => !object.collected).map(object => `${object.column},${object.row}`));
    const size=this.walls.mapSize;
    const available=(tile:Tile)=>!occupied.has(`${tile.column},${tile.row}`)&&!this.walls.at(tile)&&!this.walls.floorAt(tile)&&!this.occupied(tile);
    let tile:Tile|undefined;
    // Rejection sampling is uniform over free cells without scanning the whole map.
    for(let attempt=0;attempt<32;attempt++){
      const index=Math.floor(this.random()*size*size),candidate={column:index%size,row:Math.floor(index/size)};
      if(available(candidate)){tile=candidate;break;}
    }
    if(!tile){
      // Dense/full maps still terminate and can use any remaining free cell.
      const candidates:Tile[]=[];
      for(let row=0;row<size;row++)for(let column=0;column<size;column++){
        const candidate={column,row};if(available(candidate))candidates.push(candidate);
      }
      if(!candidates.length)return;
      tile=candidates[Math.floor(this.random()*candidates.length)];
    }
    const object = createEnvironment(type, tile);
    this.objects.push(object);
    this.growing.add(object);
    this.living.add(object);
    this.onSpawn(object);
    invalidatePaths(this.walls.isBlocked);
  }
}
