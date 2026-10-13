import type { Hauling, HaulWorker } from './hauling';
import type { HarvestWorker } from './harvesting';
import type { Harvesting } from './harvesting';
import type { Construction } from './construction';
import { findPaths } from './pathfinding.ts';
import { setRoute, stopAtNextSafeTile } from './movement.ts';

export interface WorkPriorities { construction: number; harvesting: number; free?: number }
export type AutonomousWorker = HarvestWorker & HaulWorker & { priorities: WorkPriorities; freeSeconds?: number; freeActive?: boolean };
export const INITIAL_PRIORITIES: WorkPriorities[] = [
  { construction: 3, harvesting: 3, free: 3 },
  { construction: 3, harvesting: 3, free: 3 },
  { construction: 3, harvesting: 3, free: 3 },
];
export function nextPriority(value: number, direction: 1 | -1 = 1): number { return (value - 1 + direction + 4) % 4 + 1; }

export function updateWork(worker: AutonomousWorker, construction: Construction, harvesting: Harvesting, seconds: number, random: () => number = Math.random, freeElapsedSeconds = seconds, hauling?: Hauling): void {
  const wasFree = worker.freeActive;
  worker.freeActive = false;
  if (worker.mode !== 'automatic' || worker.dropRequested) {
    worker.freeSeconds = 0;
    if (worker.haulJob) hauling?.cancel(worker);
    construction.update(worker, seconds); harvesting.update(worker, seconds); return;
  }
  const canHarvest = Boolean(worker.harvestJob) || harvesting.hasAvailableWork(worker);
  const canHaul = Boolean(worker.haulJob) || Boolean(!worker.job && hauling?.hasAvailableWork(worker));
  const canCollect = canHarvest || canHaul;
  const canBuild = Boolean(worker.job) || construction.nearestPlan(worker) !== null;
  const freePriority = worker.priorities.free ?? 4;
  if ((!canCollect || freePriority < worker.priorities.harvesting) && (!canBuild || freePriority < worker.priorities.construction)) {
    if (worker.job) construction.cancel(worker);
    if (worker.harvestJob) harvesting.cancel(worker);
    if (worker.haulJob) hauling?.cancel(worker);
    worker.freeActive = true;
    worker.freeSeconds = (worker.freeSeconds ?? 0) + freeElapsedSeconds;
    const movement = worker.movement;
    if (worker.freeSeconds >= 5 && !movement.nextTile && movement.tile.column === movement.destination.column && movement.tile.row === movement.destination.row) {
      worker.freeSeconds %= 5;
      const paths = findPaths(movement.tile, construction.walls.mapSize, construction.walls.isBlocked, construction.walls.cannotStop);
      const nearby = [...paths.values()].filter((path) => {
        const goal = path.tiles.at(-1);
        return goal && Math.abs(goal.column - movement.tile.column) <= 3 && Math.abs(goal.row - movement.tile.row) <= 3;
      });
      if (nearby.length) setRoute(movement, nearby[Math.floor(random() * nearby.length)].tiles);
    }
    return;
  }
  if (wasFree) stopAtNextSafeTile(worker.movement, construction.walls.cannotStop);
  worker.freeSeconds = 0;
  const collectFirst = canCollect && (!canBuild || worker.priorities.harvesting <= worker.priorities.construction);
  if (collectFirst) {
    if (worker.job) construction.cancel(worker);
    if (canHarvest) {
      if (worker.haulJob) hauling?.cancel(worker);
      harvesting.update(worker, seconds);
    } else {
      if (worker.harvestJob) harvesting.cancel(worker);
      hauling?.update(worker);
    }
  } else {
    if (worker.harvestJob) harvesting.cancel(worker);
    if (worker.haulJob) hauling?.cancel(worker);
    construction.update(worker, seconds);
    if (!canBuild) harvesting.update(worker, seconds);
  }
}

export function currentAction(worker: AutonomousWorker): string {
  if (worker.dropRequested) return '地面に置く';
  if (worker.mode === 'drafted') return '徴兵';
  const moving = Boolean(worker.movement.nextTile) || worker.movement.tile.column !== worker.movement.destination.column || worker.movement.tile.row !== worker.movement.destination.row;
  if (worker.haulJob) return worker.haulJob.phase === 'pickup' ? 'アイテムを取得中' : '保管箱へ運搬中';
  if (worker.harvestJob) return moving ? '収集へ移動中' : '収集中';
  if (worker.job) {
    if (worker.job.phase === 'build') return moving ? '建設へ移動中' : '建築中';
    if (worker.job.phase === 'gather') return '素材を取得中';
    return moving ? '素材を運搬中' : '素材を搬入中';
  }
  return worker.freeActive ? '自由' : '待機';
}
