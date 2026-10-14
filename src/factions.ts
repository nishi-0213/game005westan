export const FACTIONS = { player: 'プレイヤー', enemy1: '敵１', wild: '野生' } as const;
export type Faction = keyof typeof FACTIONS;
export interface FactionMember { faction: Faction }
export function isPlayerControlled(pawn: FactionMember): boolean { return pawn.faction === 'player'; }
export function areHostile(a: FactionMember, b: FactionMember): boolean {
  return a.faction === 'player' && b.faction === 'enemy1' || a.faction === 'enemy1' && b.faction === 'player';
}
