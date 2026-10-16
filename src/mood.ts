import type { BodyCondition } from './body-conditions';
import { FOOD_THRESHOLD } from './needs-threshold.ts';
import { GAME_MINUTES_PER_SECOND } from './game-time.ts';
export type MemoryKind = 'standingMeal' | 'rawFood' | 'killedHuman';
export interface MoodMemory {kind:MemoryKind;seconds:number}
export interface MoodPawn {
  kind?:string; dead?:boolean;
  needs:{satiety:number;wakefulness?:number;happiness?:number};
  moodMemories?:MoodMemory[];
  conditions?:BodyCondition[];
}
export interface MoodEffect {label:string;amount:number;count:number}
const MEMORIES={
  standingMeal:{label:'立ち食いした',amount:-3,hours:5},
  rawFood:{label:'生の食材を食べた',amount:-30,hours:5},
  killedHuman:{label:'人を無力化した',amount:-30,hours:72},
};
export function moodEffects(pawn:MoodPawn):MoodEffect[]{
  const effects:MoodEffect[]=[];
  if(pawn.needs.satiety<=0)effects.push({label:'飢餓',amount:-20,count:1});
  else if(pawn.needs.satiety<=FOOD_THRESHOLD)effects.push({label:'お腹が空いた',amount:-5,count:1});
  if((pawn.needs.wakefulness??100)<=20)effects.push({label:'眠い',amount:-10,count:1});
  for(const kind of ['standingMeal','rawFood','killedHuman'] as const){
    const count=pawn.moodMemories?.filter(memory=>memory.kind===kind&&memory.seconds>0).length??0;
    if(count)effects.push({label:MEMORIES[kind].label,amount:MEMORIES[kind].amount*count,count});
  }
  const active=pawn.conditions?.filter(condition=>condition.seconds>0)??[];
  const injuries=active.filter(condition=>condition.kind==='bleeding'||condition.kind==='bruise').length;
  if(injuries)effects.push({label:'怪我をした',amount:-10*injuries,count:injuries});
  if(active.some(condition=>condition.kind==='stomachache'))effects.push({label:'病気になった',amount:-15,count:1});
  return effects;
}
export function updateMood(pawn:MoodPawn,seconds:number):void {
  if(pawn.kind!=='human'||pawn.dead)return;
  if(pawn.moodMemories){
    for(const memory of pawn.moodMemories)memory.seconds-=Math.max(0,seconds);
    pawn.moodMemories=pawn.moodMemories.filter(memory=>memory.seconds>1e-9);
  }
  pawn.needs.happiness=Math.max(0,Math.min(100,50+moodEffects(pawn).reduce((sum,effect)=>sum+effect.amount,0)));
}
export function rememberMood(pawn:MoodPawn,kind:MemoryKind):void {
  if(pawn.kind!=='human'||pawn.dead)return;
  const duration=MEMORIES[kind].hours*60/GAME_MINUTES_PER_SECOND;
  const memories=pawn.moodMemories??=[];
  const previous=kind!=='killedHuman'?memories.find(memory=>memory.kind===kind):undefined;
  if(previous)previous.seconds=duration;else memories.push({kind,seconds:duration});
  updateMood(pawn,0);
}
export function canGiveOrders(pawn:{dead?:boolean;needs?:{happiness?:number}}):boolean {
  return !pawn.dead&&(pawn.needs?.happiness??50)>=25;
}
