import type { Clearing } from './clearing';
import type { Hauling, HaulWorker } from './hauling';
import type { HarvestWorker } from './harvesting';
import type { Harvesting } from './harvesting';
import type { Construction } from './construction';
import { isBuildingPhase } from './construction.ts';
import { findPaths } from './pathfinding.ts';
import { setRoute, stopAtNextSafeTile } from './movement.ts';

export interface WorkPriorities { construction: number; harvesting: number; hauling?: number; free?: number }
export type AutonomousWorker = HarvestWorker & HaulWorker & { priorities: WorkPriorities; dead?: boolean; freeSeconds?: number; freeActive?: boolean; decisionSeconds?: number; prioritySignature?: string; workTask?: string; transportTask?: 'clear' | 'deliver' | 'store' };
export const INITIAL_PRIORITIES: WorkPriorities[] = [
  { construction: 3, harvesting: 3, hauling: 3, free: 3 },
  { construction: 3, harvesting: 3, hauling: 3, free: 3 },
  { construction: 3, harvesting: 3, hauling: 3, free: 3 },
];
export function nextPriority(value: number, direction: 1 | -1 = 1): number { return (value - 1 + direction + 4) % 4 + 1; }

export function updateWork(worker: AutonomousWorker, construction: Construction, harvesting: Harvesting, seconds: number, random: () => number = Math.random, freeElapsedSeconds = seconds, hauling?: Hauling, clearing?: Clearing): void {
  if (worker.dead) return;
  const wasFree = worker.freeActive;
  worker.freeActive = false;
  if (worker.mode !== 'automatic' || worker.dropRequested) {
    worker.freeSeconds = 0;
    if (worker.haulJob || worker.clearJob) hauling?.cancel(worker);
    construction.update(worker, seconds); harvesting.update(worker, seconds); return;
  }
  const signature = `${worker.priorities.construction},${worker.priorities.harvesting},${worker.priorities.hauling ?? 3},${worker.priorities.free ?? 4}`;
  worker.decisionSeconds = (worker.decisionSeconds ?? 0) - seconds;
  let task = worker.workTask;
  if (!task || worker.decisionSeconds <= 0 || worker.prioritySignature !== signature) {
    const choices = [
      { task: 'harvest', priority: worker.priorities.harvesting },
      { task: 'transport', priority: worker.priorities.hauling ?? 3 },
      { task: 'build', priority: worker.priorities.construction },
      { task: 'free', priority: worker.priorities.free ?? 4 },
    ].sort((a, b) => a.priority - b.priority);
    // Only explore as far down the priority list as needed to select a task.
    for (const choice of choices) {
      if (choice.task === 'harvest' && !worker.harvestJob && !harvesting.hasAvailableWork(worker)) continue;
      if (choice.task === 'build' && !(worker.job && isBuildingPhase(worker.job.phase)) && !construction.nearestPlan(worker, undefined, 'build')) continue;
      if (choice.task === 'transport') {
        if (worker.clearJob || clearing?.hasAvailableWork(worker)) worker.transportTask = 'clear';
        else if (!worker.haulJob && (worker.job && !isBuildingPhase(worker.job.phase) || construction.nearestPlan(worker, undefined, 'transport'))) worker.transportTask = 'deliver';
        else if (worker.haulJob || !worker.job && hauling?.hasAvailableWork(worker)) worker.transportTask = 'store';
        else continue;
      }
      task = choice.task;
      break;
    }
    worker.workTask = task;
    worker.prioritySignature = signature;
    worker.decisionSeconds = .25;
  }
  if (task === 'free') {
    if (worker.job) construction.cancel(worker);
    if (worker.harvestJob) harvesting.cancel(worker);
    if (worker.haulJob || worker.clearJob) hauling?.cancel(worker);
    worker.freeActive = true;
    worker.freeSeconds = (worker.freeSeconds ?? 0) + freeElapsedSeconds;
    const movement = worker.movement;
    if (worker.freeSeconds >= 5 && !movement.nextTile && movement.tile.column === movement.destination.column && movement.tile.row === movement.destination.row) {
      worker.freeSeconds %= 5;
      const paths = findPaths(movement.tile, construction.walls.mapSize, construction.walls.isBlocked, construction.walls.cannotStop);
      const nearby = [...paths.keys()].filter(index => {
        const column = index % construction.walls.mapSize, row = Math.floor(index / construction.walls.mapSize);
        return (column !== movement.tile.column || row !== movement.tile.row) && Math.abs(column - movement.tile.column) <= 3 && Math.abs(row - movement.tile.row) <= 3;
      });
      if (nearby.length) setRoute(movement, paths.get(nearby[Math.floor(random() * nearby.length)])!.tiles);
    }
    return;
  }
  if (wasFree) stopAtNextSafeTile(worker.movement, construction.walls.cannotStop);
  worker.freeSeconds = 0;
  const hadJob = Boolean(worker.job || worker.harvestJob || worker.haulJob || worker.clearJob);
  if (task === 'harvest') {
    if (worker.job) construction.cancel(worker);
    if (worker.haulJob || worker.clearJob) hauling?.cancel(worker);
    harvesting.update(worker, seconds);
  } else {
    if (worker.harvestJob) harvesting.cancel(worker);
    if (task === 'transport' && worker.transportTask === 'clear') {
      if (worker.job) construction.cancel(worker);
      if (worker.haulJob) hauling?.cancel(worker);
      clearing?.update(worker);
    } else if (task === 'build' || worker.transportTask === 'deliver') {
      if (worker.haulJob || worker.clearJob) hauling?.cancel(worker);
      const work = task === 'build' ? 'build' : 'transport';
      if (worker.job && isBuildingPhase(worker.job.phase) !== (work === 'build')) construction.cancel(worker);
      construction.update(worker, seconds, work);
    } else {
      if (worker.job) construction.cancel(worker);
      hauling?.update(worker);
    }
  }
  if (hadJob && !worker.job && !worker.harvestJob && !worker.haulJob && !worker.clearJob) worker.decisionSeconds = 0;
}

export function currentAction(worker: AutonomousWorker): string {
  if (worker.dead) return '死亡';
  if (worker.dropRequested) return '地面に置く';
  if (worker.mode === 'drafted') return '徴兵';
  const moving = Boolean(worker.movement.nextTile) || worker.movement.tile.column !== worker.movement.destination.column || worker.movement.tile.row !== worker.movement.destination.row;
  if (worker.clearJob) return worker.clearJob.phase === 'pickup' ? '建設予定地の整理中' : 'アイテムを移動中';
  if (worker.haulJob) return worker.haulJob.phase === 'pickup' ? 'アイテムを取得中' : '保管箱へ運搬中';
  if (worker.harvestJob) return moving ? '収集へ移動中' : '収集中';
  if (worker.job) {
    if (worker.job.phase === 'demolish') return moving ? '破壊へ移動中' : '破壊中';
    if (worker.job.phase === 'build') return moving ? '建設へ移動中' : '建築中';
    if (worker.job.phase === 'gather') return '素材を取得中';
    return moving ? '素材を運搬中' : '素材を搬入中';
  }
  return worker.freeActive ? '自由' : '待機';
}
