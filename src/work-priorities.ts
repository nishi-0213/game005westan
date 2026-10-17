import { isNursing, type Nursing } from './nursing.ts';
import { canPlan } from './path-schedule.ts';
import type { Cooking } from './cooking';
import type { Hunting } from './hunting';
import type { Butchery } from './butchery';
import type { Clearing } from './clearing';
import type { Hauling, HaulWorker } from './hauling';
import type { HarvestWorker } from './harvesting';
import type { Harvesting } from './harvesting';
import type { Construction } from './construction';
import { isBuildingPhase } from './construction.ts';
import { stopAtNextSafeTile } from './movement.ts';
import { updateRoaming } from './roaming.ts';

export interface WorkPriorities { nursing?:number; construction: number; harvesting: number; hauling?: number; butchery?: number; cooking?: number; hunting?: number; free?: number }
export type AutonomousWorker = HarvestWorker & HaulWorker & { priorities: WorkPriorities; dead?: boolean; freeSeconds?: number; freeActive?: boolean; decisionSeconds?: number; prioritySignature?: string; workTask?: string; transportTask?: 'clear' | 'deliver' | 'store' | 'corpse' | 'ingredients' };
export const INITIAL_PRIORITIES: WorkPriorities[] = [
  { nursing:3, construction: 3, harvesting: 3, hauling: 3, butchery: 3, cooking:3, hunting: 3, free: 3 },
  { nursing:3, construction: 3, harvesting: 3, hauling: 3, butchery: 3, cooking:3, hunting: 3, free: 3 },
  { nursing:3, construction: 3, harvesting: 3, hauling: 3, butchery: 3, cooking:3, hunting: 3, free: 3 },
];
export function nextPriority(value: number, direction: 1 | -1 = 1): number { return (value - 1 + direction + 4) % 4 + 1; }

export function updateWork(worker: AutonomousWorker, construction: Construction, harvesting: Harvesting, seconds: number, random: () => number = Math.random, freeElapsedSeconds = seconds, hauling?: Hauling, clearing?: Clearing, butchery?: Butchery, hunting?: Hunting, cooking?:Cooking, nursing?:Nursing): void {
  if (worker.dead) {nursing?.cancel(worker);hunting?.cancel(worker);if(worker.cookJob)cooking?.cancel(worker);return;}
  if(worker.receivingNursing){worker.freeActive=false;return;}
  if(!worker.workTask&&!canPlan(worker.movement)&&worker.mode==='automatic'&&!worker.dropRequested)return;
  const wasFree = worker.freeActive;
  worker.freeActive = false;
  if (worker.mode !== 'automatic' || worker.dropRequested) {
    nursing?.cancel(worker);
    if(worker.cookJob)cooking?.cancel(worker);
    hunting?.cancel(worker);
    worker.freeSeconds = 0;
    if (worker.butcherJob || worker.carryingCorpse) butchery?.cancel(worker);
    if (worker.haulJob || worker.clearJob) hauling?.cancel(worker);
    construction.update(worker, seconds); harvesting.update(worker, seconds); return;
  }
  const constructionUnavailable = construction.releaseUnavailable(worker);
  const cookingUnavailable = cooking?.releaseUnavailable(worker);
  if (constructionUnavailable || cookingUnavailable) { worker.workTask = undefined; worker.decisionSeconds = 0; }
  const signature = `${worker.priorities.nursing??3},${worker.priorities.construction},${worker.priorities.harvesting},${worker.priorities.hauling ?? 3},${worker.priorities.free ?? 4},${worker.priorities.butchery ?? 3},${worker.priorities.hunting??3},${worker.priorities.cooking??3}`;
  worker.decisionSeconds = (worker.decisionSeconds ?? 0) - seconds;
  let task = worker.workTask;
  if ((!task || worker.decisionSeconds <= 0 || worker.prioritySignature !== signature) && canPlan(worker.movement)) {
    const choices = [
      {task:'nurse',priority:worker.priorities.nursing??3},
      { task: 'harvest', priority: worker.priorities.harvesting },
      { task: 'transport', priority: worker.priorities.hauling ?? 3 },
      { task: 'build', priority: worker.priorities.construction },
      { task: 'butcher', priority: worker.priorities.butchery ?? 3 },
      { task:'cook',priority:worker.priorities.cooking??3 },
      { task: 'hunt', priority: worker.priorities.hunting??3 },
      { task: 'free', priority: worker.priorities.free ?? 4 },
    ].sort((a, b) => a.priority - b.priority);
    // Only explore as far down the priority list as needed to select a task.
    for (const choice of choices) {
      if(choice.task==='nurse'&&!worker.nurseJob&&!nursing?.findWork(worker))continue;
      if (choice.task==='hunt'&&!hunting?.hasAvailableWork(worker))continue;
      if (choice.task === 'harvest' && !worker.harvestJob && !harvesting.hasAvailableWork(worker)) continue;
      if (choice.task === 'build' && worker.job?.batch && worker.job.phase === 'deliver' && worker.inventory?.quantity) continue;
      if (choice.task === 'build' && !(worker.job && isBuildingPhase(worker.job.phase)) && !construction.nearestPlan(worker, undefined, 'build')) continue;
      if (choice.task === 'butcher' && !(worker.butcherJob?.phase === 'process') && !butchery?.findProcessing(worker)) continue;
      if(choice.task==='cook'&&worker.cookJob?.phase!=='process'&&!cooking?.findProcessing(worker))continue;
      if (choice.task === 'transport') {
        if (worker.clearJob || clearing?.hasAvailableWork(worker)) worker.transportTask = 'clear';
        else if (worker.butcherJob && worker.butcherJob.phase !== 'process' || butchery?.findTransport(worker) || butchery?.findStorage(worker)) worker.transportTask = 'corpse';
        else if(worker.cookJob&&worker.cookJob.phase!=='process'||cooking?.findTransport(worker))worker.transportTask='ingredients';
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
  if(task!=='nurse')nursing?.cancel(worker);
  if(worker.cookJob&&!(task==='cook'&&worker.cookJob.phase==='process')&&!(task==='transport'&&worker.transportTask==='ingredients'))cooking?.cancel(worker);
  if(task!=='hunt')hunting?.cancel(worker);
  if (worker.butcherJob && !(task === 'butcher' && worker.butcherJob.phase === 'process') && !(task === 'transport' && worker.transportTask === 'corpse')) butchery?.cancel(worker);
  if (task === 'free') {
    if (worker.job) construction.cancel(worker);
    if (worker.harvestJob) harvesting.cancel(worker);
    if (worker.haulJob || worker.clearJob) hauling?.cancel(worker);
    worker.freeActive = true;
    updateRoaming(worker, construction.walls, freeElapsedSeconds, random);
    return;
  }
  if (wasFree) stopAtNextSafeTile(worker.movement, construction.walls.cannotStop);
  worker.freeSeconds = 0;
  const hadJob = Boolean(worker.job || worker.harvestJob || worker.haulJob || worker.clearJob || worker.butcherJob || worker.cookJob);
  if(task==='nurse'){
    nursing?.update(worker,seconds);
  } else if(task==='cook'||task==='transport'&&worker.transportTask==='ingredients'){
    if(worker.job)construction.cancel(worker);
    if(worker.harvestJob)harvesting.cancel(worker);
    if(worker.haulJob||worker.clearJob)hauling?.cancel(worker);
    cooking?.update(worker,seconds,task==='cook'?'process':'transport');
  } else if(task==='hunt'){
    hunting?.update(worker,seconds);
  } else if (task === 'butcher' || task === 'transport' && worker.transportTask === 'corpse') {
    if (worker.job) construction.cancel(worker);
    if (worker.harvestJob) harvesting.cancel(worker);
    if (worker.haulJob || worker.clearJob) hauling?.cancel(worker);
    butchery?.update(worker, seconds, task === 'butcher' ? 'process' : 'transport');
  } else if (task === 'harvest') {
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
  if (hadJob && !worker.job && !worker.harvestJob && !worker.haulJob && !worker.clearJob && !worker.butcherJob && !worker.cookJob) worker.decisionSeconds = 0;
}

export function currentAction(worker: AutonomousWorker): string {
  if (worker.dead) return '死亡';
  if(worker.receivingNursing)return '看護を受けている';
  if(worker.nurseJob)return isNursing(worker)?'看護':'看護へ移動中';
  if (worker.dropRequested) return '地面に置く';
  if (worker.mode === 'drafted'&&!worker.forcedConstruction) return '徴兵';
  const moving = Boolean(worker.movement.nextTile) || worker.movement.tile.column !== worker.movement.destination.column || worker.movement.tile.row !== worker.movement.destination.row;
  if(worker.cookJob)return worker.cookJob.phase==='process'?moving?'調理へ移動中':'調理中':worker.cookJob.phase==='carry'?'調理材料を運搬中':'調理材料を取得中';
  if (worker.butcherJob) return worker.butcherJob.phase === 'process' ? moving ? '解体へ移動中' : '解体中' : worker.butcherJob.phase === 'carry' || worker.butcherJob.phase === 'store' ? '死体を運搬中' : '死体を取得中';
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
