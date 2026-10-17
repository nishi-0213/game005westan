import { damageBodyPart, type BodyPart, type Health } from './health.ts';
import { GAME_MINUTES_PER_SECOND } from './game-time.ts';
import type { ItemType } from './items';
export const CONDITION_LABELS={bleeding:'出血',bruise:'打撲',stomachache:'腹痛'} as const;
export type ConditionKind=keyof typeof CONDITION_LABELS;
export interface BodyCondition {kind:ConditionKind;part:BodyPart;seconds:number}
export interface ConditionHealth extends Health {sleep?:{phase:string;bed?:{state?:string;kind?:string}};dead?:boolean;conditions?:BodyCondition[]}
const HOUR_SECONDS=60/GAME_MINUTES_PER_SECOND;
export function addCondition(actor:ConditionHealth,kind:ConditionKind,part:BodyPart):void {
  if(actor.dead||!actor.bodyHp)return;
  (actor.conditions??=[]).push({kind,part,seconds:(kind==='bleeding'?24:48)*HOUR_SECONDS});
}
export function attackConditions(actor:ConditionHealth,part:BodyPart,random:()=>number=Math.random):void {
  if(actor.dead||!actor.bodyHp)return;
  if(random()<.3)addCondition(actor,'bleeding',part);
  if(random()<.2)addCondition(actor,'bruise',part);
}
export function mealConditions(actor:ConditionHealth,type:ItemType,random:()=>number=Math.random):void {
  const chance=type==='ration'?.05:type==='meat'?.4:type.endsWith('Corpse')?.8:type==='strawberry'?.1:0;
  if(chance&&actor.bodyHp&&!actor.dead&&random()<chance)addCondition(actor,'stomachache','torso');
}
export function recoveryFactor(actor:ConditionHealth):number {return actor.sleep?.phase==='sleeping'&&actor.sleep.bed?.kind==='bed'&&actor.sleep.bed.state==='completed' ? .8 : 1;}
export function conditionRemaining(actor:ConditionHealth,condition:BodyCondition):number {return Math.max(0,condition.seconds)*recoveryFactor(actor);}
export function updateConditions(actor:ConditionHealth,seconds:number):void {
  if(actor.dead||!actor.conditions)return;
  const elapsed=Math.max(0,seconds),factor=recoveryFactor(actor);
  for(const condition of actor.conditions){
    const active=Math.min(elapsed,Math.max(0,condition.seconds)*factor);
    if(condition.kind==='bleeding')damageBodyPart(actor,condition.part,5*active/HOUR_SECONDS);
    condition.seconds-=elapsed/factor;
  }
  actor.conditions=actor.conditions.filter(condition=>condition.seconds>1e-9);
}
