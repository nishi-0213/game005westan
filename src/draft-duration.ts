import { GAME_MINUTES_PER_SECOND } from './game-time.ts';
export const DRAFT_DURATION_SECONDS=12*60/GAME_MINUTES_PER_SECOND;
export interface DraftTimer {mode:'drafted'|'automatic';dead?:boolean;draftedSeconds:number}
/** Count continuous drafting in simulation time; mode transitions reset this timer. */
export function draftExpired(pawn:DraftTimer,seconds:number):boolean {
  if(pawn.dead||pawn.mode!=='drafted'){pawn.draftedSeconds=0;return false;}
  pawn.draftedSeconds+=Math.max(0,seconds);
  return pawn.draftedSeconds>=DRAFT_DURATION_SECONDS-1e-9;
}
