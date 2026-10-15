import { GAME_MINUTES_PER_SECOND } from './game-time.ts';
export const DRAFT_MIN_SECONDS=12*60/GAME_MINUTES_PER_SECOND;
export const DRAFT_MAX_SECONDS=18*60/GAME_MINUTES_PER_SECOND;
export interface DraftTimer {mode:'drafted'|'automatic';dead?:boolean;draftedSeconds:number;draftLimitSeconds?:number}
export function resetDraftTimer(pawn:DraftTimer,random:()=>number=Math.random):void {
  pawn.draftedSeconds=0;
  pawn.draftLimitSeconds=pawn.mode==='drafted'&&!pawn.dead?DRAFT_MIN_SECONDS+random()*(DRAFT_MAX_SECONDS-DRAFT_MIN_SECONDS):undefined;
}
/** Sample one deadline per continuous drafted period; never reroll every frame. */
export function draftExpired(pawn:DraftTimer,seconds:number,random:()=>number=Math.random):boolean {
  if(pawn.dead||pawn.mode!=='drafted'){resetDraftTimer(pawn,random);return false;}
  pawn.draftLimitSeconds??=DRAFT_MIN_SECONDS+random()*(DRAFT_MAX_SECONDS-DRAFT_MIN_SECONDS);
  pawn.draftedSeconds+=Math.max(0,seconds);
  return pawn.draftedSeconds>=pawn.draftLimitSeconds-1e-9;
}
