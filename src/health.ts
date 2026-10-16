export const BODY_PARTS = { head:'頭', torso:'胴', arms:'腕', legs:'脚' } as const;
export type BodyPart = keyof typeof BODY_PARTS;
export type BodyHp = Record<BodyPart,number>;
export interface Health { hp?:number; bodyHp?:BodyHp }
export function initialBodyHp():BodyHp { return {head:100,torso:100,arms:100,legs:100}; }
export function healthHp(actor:Health):number {
  return actor.bodyHp ? Math.min(actor.bodyHp.head,actor.bodyHp.torso) : actor.hp??100;
}
export function damageBodyPart(actor:Health,part:BodyPart,damage:number):void {
  if(actor.bodyHp){actor.bodyHp[part]=Math.max(0,actor.bodyHp[part]-Math.max(0,damage));actor.hp=healthHp(actor);}
  else actor.hp=Math.max(0,(actor.hp??100)-Math.max(0,damage));
}
export function damageAllBodyParts(actor:Health,damage:number):void {
  if(actor.bodyHp){
    for(const part of Object.keys(BODY_PARTS) as BodyPart[])actor.bodyHp[part]=Math.max(0,actor.bodyHp[part]-Math.max(0,damage));
    actor.hp=healthHp(actor);
  }else actor.hp=Math.max(0,(actor.hp??100)-Math.max(0,damage));
}
