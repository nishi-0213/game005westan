import { canPlan } from './path-schedule.ts';
import type { Builder } from './construction';
import type { EnvironmentObject } from './environment';
import { ENVIRONMENT_PROPERTIES, harvestYield } from './environment.ts';
import type { MapItem } from './items';
import { returnItems } from './items.ts';
import type { Tile } from './movement';
import { setRoute, stopAtNextSafeTile } from './movement.ts';
import { findNearest, invalidatePaths } from './pathfinding.ts';
import type { Path } from './pathfinding';
import type { Walls } from './walls';

export interface HarvestWorker extends Builder {
  harvestJob: { target: EnvironmentObject; goal: Tile } | null;
  harvestRetrySeconds: number;
}
const sameTile = (a: Tile, b: Tile) => a.column === b.column && a.row === b.row;
const markedForHarvest = (target: EnvironmentObject): boolean => target.collect;
export class Harvesting {
  readonly objects: EnvironmentObject[];
  readonly items: MapItem[];
  readonly walls: Walls;
  readonly claims = new Map<EnvironmentObject, HarvestWorker>();

  constructor(objects: EnvironmentObject[], items: MapItem[], walls: Walls) {
    this.objects = objects; this.items = items; this.walls = walls;
  }

  cancel(worker: HarvestWorker): void {
    if (worker.harvestJob && this.claims.get(worker.harvestJob.target) === worker) this.claims.delete(worker.harvestJob.target);
    worker.harvestJob = null;
    worker.harvestRetrySeconds = 0;
    stopAtNextSafeTile(worker.movement, this.walls.cannotStop);
  }

  findWork(worker: HarvestWorker, eligible = markedForHarvest): { target: EnvironmentObject; goal: Tile; path: Path } | null {
    if (!canPlan(worker.movement))return null;
    if (!this.objects.some(target => eligible(target) && !target.collected && !this.claims.has(target))) return null;
    const candidates=[];
    for(const target of this.objects){
      if(!eligible(target)||target.collected||this.claims.has(target)||this.walls.isBlocked(target))continue;
      for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(dc||dr)candidates.push({target,goal:{column:target.column+dc,row:target.row+dr}});
    }
    return findNearest(worker.movement.nextTile??worker.movement.tile,this.walls.mapSize,this.walls.isBlocked,this.walls.cannotStop,candidates,worker.movement);

  }

  hasAvailableWork(worker: HarvestWorker): boolean { return this.findWork(worker) !== null; }

  update(worker: HarvestWorker, seconds: number, eligible = markedForHarvest): EnvironmentObject | undefined {
    if (worker.mode !== 'automatic' || worker.job || worker.dropRequested) { if (worker.harvestJob) this.cancel(worker); return; }
    const job = worker.harvestJob;
    if (job && (!eligible(job.target) || job.target.collected || this.claims.get(job.target) !== worker || this.walls.isBlocked(job.target))) this.cancel(worker);
    if (worker.movement.nextTile || !sameTile(worker.movement.tile, worker.movement.destination)) return;
    if (!worker.harvestJob) {
      worker.harvestRetrySeconds -= seconds;
      if (worker.harvestRetrySeconds > 0 || !canPlan(worker.movement)) return;
      worker.harvestRetrySeconds = 0.25;
      const best = this.findWork(worker, eligible);
      if (best) {
        this.claims.set(best.target, worker);
        worker.harvestJob = { target: best.target, goal: best.goal };
        setRoute(worker.movement, best.path.tiles);
      }
      return;
    }
    const active = worker.harvestJob;
    if (!sameTile(worker.movement.tile, active.goal)) { this.cancel(worker); return; }
    const properties = ENVIRONMENT_PROPERTIES[active.target.type];
    active.target.workSeconds = Math.min(properties.seconds, active.target.workSeconds + seconds);
    if (active.target.workSeconds >= properties.seconds) {
      active.target.collected = true;
      invalidatePaths(this.walls.isBlocked);
      returnItems(this.items, { column: active.target.column, row: active.target.row }, properties.material, harvestYield(active.target));
      {
        const stack = this.items.find(item => item.type === properties.material && item.column === active.target.column && item.row === active.target.row);
        if (stack) stack.collect = true;
      }
      this.cancel(worker);
      return active.target;
    }
  }
}
