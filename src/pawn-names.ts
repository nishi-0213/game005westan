import { SURNAMES, GIVEN_NAMES, NICKNAMES } from './data/pawn-name-pool.ts';

export interface PawnName { surname: string; givenName: string; nickname: string }
export function generatePawnNames(count: number, random: () => number = Math.random): PawnName[] {
  const surnames = [...SURNAMES], givenNames = [...GIVEN_NAMES], nicknames = [...NICKNAMES];
  const take = (list: string[]) => list.splice(Math.floor(random() * list.length), 1)[0];
  return Array.from({ length: count }, () => ({ surname: take(surnames), givenName: take(givenNames), nickname: take(nicknames) }));
}
export function formatPawnName(name: PawnName): string { return `${name.surname} ${name.givenName}「${name.nickname}」`; }
