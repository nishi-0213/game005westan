import type { HarvestWorker } from './harvesting';
import type { Harvesting } from './harvesting';
import type { Construction } from './construction';

export interface WorkPriorities { construction: number; harvesting: number }
export const INITIAL_PRIORITIES: WorkPriorities[] = [
  { construction: 3, harvesting: 3 },
  { construction: 3, harvesting: 3 },
  { construction: 3, harvesting: 3 },
];
export function nextPriority(value: number): number { return value % 4 + 1; }

export function updateWork(worker: HarvestWorker & { priorities: WorkPriorities }, construction: Construction, harvesting: Harvesting, seconds: number): void {
  if (worker.mode !== 'automatic' || worker.dropRequested) {
    construction.update(worker, seconds); harvesting.update(worker, seconds); return;
  }
  const canHarvest = Boolean(worker.harvestJob) || harvesting.hasAvailableWork(worker);
  const canBuild = Boolean(worker.job) || construction.nearestPlan(worker) !== null;
  const collectFirst = canHarvest && (!canBuild || worker.priorities.harvesting <= worker.priorities.construction);
  if (collectFirst) {
    if (worker.job) construction.cancel(worker);
    harvesting.update(worker, seconds);
  } else {
    if (worker.harvestJob) harvesting.cancel(worker);
    construction.update(worker, seconds);
    if (!canBuild) harvesting.update(worker, seconds);
  }
}
