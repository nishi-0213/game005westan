export const SKILL_LABELS={shooting:'射撃',melee:'近接',cooking:'調理',crafting:'加工',harvesting:'収穫',hunting:'狩猟'} as const;
export const TRAITS={cautious:{name:'用心深い',description:'腹痛にかからない'},bigEater:{name:'大食い',description:'必要な食事量120％'},athletic:{name:'運動好き',description:'歩く速度120％'},dexterous:{name:'器用',description:'射撃命中率＋20ポイント'},meticulous:{name:'凝り性',description:'建築成功率96％（基本80％の1.2倍）'}} as const;
export type Skill=keyof typeof SKILL_LABELS;
export type Trait=keyof typeof TRAITS;
export interface Personality {skills:Record<Skill,number>;traits:Trait[]}
export interface PersonalityCarrier {personality?:Personality}
export function randomPersonality(random:()=>number=Math.random):Personality {
 const index=(size:number)=>Math.min(size-1,Math.max(0,Math.floor(random()*size)));
 const skills=Object.fromEntries(Object.keys(SKILL_LABELS).map(skill=>[skill,index(21)])) as Record<Skill,number>;
 const pool=Object.keys(TRAITS) as Trait[],traits:Trait[]=[];
 for(let i=0;i<2;i++)traits.push(pool.splice(index(pool.length),1)[0]);
 return {skills,traits};
}
export function isPersonality(value:unknown):value is Personality {
 const p=value as Personality;
 return !!p&&!!p.skills&&Object.keys(SKILL_LABELS).every(k=>Number.isInteger(p.skills[k as Skill])&&p.skills[k as Skill]>=0&&p.skills[k as Skill]<=20)&&Array.isArray(p.traits)&&p.traits.length===2&&new Set(p.traits).size===2&&p.traits.every(t=>Object.hasOwn(TRAITS,t));
}
export function hasTrait(actor:PersonalityCarrier,trait:Trait):boolean {return actor.personality?.traits.includes(trait)??false;}
export const foodRequirement=(actor:PersonalityCarrier):number=>hasTrait(actor,'bigEater')?1.2:1;
export const movementRate=(actor:PersonalityCarrier):number=>hasTrait(actor,'athletic')?1.2:1;
export const shootingBonus=(actor:PersonalityCarrier):number=>hasTrait(actor,'dexterous')?.2:0;
export const constructionSuccessChance=(actor:PersonalityCarrier,base=.8):number=>Math.min(1,Math.max(0,base)*(hasTrait(actor,'meticulous')?1.2:1));
export function skillModifier(actor:PersonalityCarrier,skill:Skill):number {return ((actor.personality?.skills[skill]??10)-10)*.02;}
export const skillRate=(actor:PersonalityCarrier,skill:Skill):number=>1+skillModifier(actor,skill);
export const huntingRetaliationChance=(actor:PersonalityCarrier,base:number):number=>Math.max(0,Math.min(1,base-skillModifier(actor,'hunting')));
