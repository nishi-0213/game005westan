import type { Tile } from './movement';
import { renderedPosition, setRoute, stopAtNextSafeTile } from './movement.ts';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';
import type { EatingWorker } from './needs';
import { killPawn } from './needs.ts';
import type { FactionMember } from './factions';
import { areHostile, isPlayerControlled } from './factions.ts';
import type { MapItem } from './items';
import { carryCapacity, returnItems } from './items.ts';
import type { Construction } from './construction';
import type { Harvesting } from './harvesting';
import type { Hauling } from './hauling';

export type Weapon = 'unarmed' | 'rifle';
export const WEAPONS = {
  unarmed: { name: '素手', damage: 10, accuracy: .30, range: 1 },
  rifle: { name: 'ライフル', damage: 40, accuracy: .10, range: 16 },
};
export const ATTACK_INTERVAL = 1 / .4;
export type CombatTarget = EatingWorker & FactionMember & { departed?: boolean };
export interface AttackEvent {
  attacker: CombatPawn;
  target: CombatTarget;
  weapon: Weapon;
  hit: boolean;
  from: Tile;
  to: Tile;
  damage: number;
}
export interface AttackOrder {
  target: CombatTarget;
  cooldown: number;
  retrySeconds: number;
  targetPosition?: string;
  goal?: Tile;
  manual?: boolean;
}
export type CombatPawn = CombatTarget & {
  weapon?: Weapon;
  freeSeconds?: number;
  attackJob?: AttackOrder | null;
  equipJob?: { source: MapItem; goal: Tile } | null;
  combatDecisionSeconds?: number;
};

export function inWeaponRange(weapon: Weapon, from: Tile, target: Tile): boolean {
  const dc = Math.abs(from.column - target.column), dr = Math.abs(from.row - target.row);
  if (!dc && !dr) return false;
  return weapon === 'unarmed' ? Math.max(dc, dr) <= 1 : dc * dc + dr * dr <= 16 * 16;
}

const stationary = (pawn: CombatPawn): boolean => !pawn.movement.nextTile
  && pawn.movement.tile.column === pawn.movement.destination.column && pawn.movement.tile.row === pawn.movement.destination.row;
const positionKey = (tile: Tile): string => `${tile.column},${tile.row}`;

export class Combat {
  readonly construction: Construction;
  readonly harvesting: Harvesting;
  readonly hauling: Hauling;
  readonly random: () => number;
  onAttack?: (event: AttackEvent) => void;

  constructor(construction: Construction, harvesting: Harvesting, hauling: Hauling, random: () => number = Math.random) {
    this.construction = construction; this.harvesting = harvesting; this.hauling = hauling; this.random = random;
  }

  cancel(pawn: CombatPawn): void {
    pawn.attackJob = null; pawn.equipJob = null;
  }

  private interrupt(pawn: CombatPawn): void {
    this.hauling.cancel(pawn); this.harvesting.cancel(pawn); this.construction.cancel(pawn);
    pawn.eatJob = null; pawn.dropRequested = false;
    pawn.freeSeconds = 0;
  }

  requestEquip(pawn: CombatPawn, source: MapItem): boolean {
    if (pawn.dead || !isPlayerControlled(pawn) || source.type !== 'rifle' || source.quantity <= 0) return false;
    const walls = this.construction.walls, from = pawn.movement.nextTile ?? pawn.movement.tile;
    const paths = findPaths(from, walls.mapSize, walls.isBlocked, walls.cannotStop, pawn.movement);
    const direct = paths.get(source.row * walls.mapSize + source.column);
    const approach = direct ? { goal: source, path: direct } : this.hauling.approach(from, source, paths);
    if (!approach) return false;
    this.interrupt(pawn); this.cancel(pawn);
    pawn.equipJob = { source, goal: approach.goal };
    return setRoute(pawn.movement, approach.path.tiles);
  }

  requestAttack(pawn: CombatPawn, target: CombatTarget): boolean {
    if (pawn === target || pawn.dead || target.dead || target.departed || pawn.mode !== 'drafted' || !isPlayerControlled(pawn)) return false;
    const approach = this.attackApproach(pawn, target);
    if (!approach) return false;
    this.interrupt(pawn); this.cancel(pawn);
    pawn.attackJob = { target, cooldown: ATTACK_INTERVAL, retrySeconds: .25,
      targetPosition: positionKey(target.movement.tile), goal: approach.goal, manual: true };
    return setRoute(pawn.movement, approach.path.tiles);
  }

  private attackApproach(pawn: CombatPawn, target: CombatTarget): { goal: Tile; path: Path } | null {
    const walls = this.construction.walls;
    const paths = findPaths(pawn.movement.nextTile ?? pawn.movement.tile, walls.mapSize, walls.isBlocked, walls.cannotStop, pawn.movement);
    // Dijkstra's endpoint order is nearest first. Only stopping cells are filtered.
    for (const [index, path] of paths) {
      const goal = { column: index % walls.mapSize, row: Math.floor(index / walls.mapSize) };
      if (inWeaponRange(pawn.weapon ?? 'unarmed', goal, target.movement.tile)) return { goal, path };
    }
    return null;
  }

  private automaticTarget(pawn: CombatPawn, targets: readonly CombatTarget[]): CombatTarget | null {
    let nearest: CombatTarget | null = null, distance = Infinity;
    for (const target of targets) {
      if (target === pawn || target.dead || target.departed || !areHostile(pawn, target)
        || !inWeaponRange(pawn.weapon ?? 'unarmed', pawn.movement.tile, target.movement.tile)) continue;
      const candidateDistance = Math.hypot(target.movement.tile.column - pawn.movement.tile.column, target.movement.tile.row - pawn.movement.tile.row);
      if (candidateDistance < distance) { distance = candidateDistance; nearest = target; }
    }
    return nearest;
  }

  update(pawn: CombatPawn, seconds: number, targets: readonly CombatTarget[] = []): boolean {
    if (pawn.dead || pawn.faction === 'wild') { this.cancel(pawn); return false; }
    const equip = pawn.equipJob;
    if (equip) {
      if (equip.source.quantity <= 0) { this.cancel(pawn); stopAtNextSafeTile(pawn.movement, this.construction.walls.cannotStop); return false; }
      if (!stationary(pawn)) return true;
      if (positionKey(pawn.movement.tile) !== positionKey(equip.goal)) { this.cancel(pawn); return false; }
      equip.source.quantity -= 1;
      if (pawn.weapon === 'rifle') returnItems(this.construction.items, pawn.movement.tile, 'rifle', 1);
      pawn.weapon = 'rifle'; pawn.equipJob = null;
      if (pawn.inventory) {
        const excess = Math.max(0, pawn.inventory.quantity - carryCapacity(pawn, pawn.inventory.type));
        if (excess) { returnItems(this.construction.items, pawn.movement.tile, pawn.inventory.type, excess); pawn.inventory.quantity -= excess; }
        if (!pawn.inventory.quantity) pawn.inventory = null;
      }
      return true;
    }
    if (!pawn.attackJob && pawn.forcedHaulSource) return false;
    if (!pawn.attackJob) {
      pawn.combatDecisionSeconds = (pawn.combatDecisionSeconds ?? 0) - seconds;
      if (pawn.combatDecisionSeconds <= 0) {
        pawn.combatDecisionSeconds = .25;
        const target = this.automaticTarget(pawn, targets);
        if (target) {
          this.interrupt(pawn);
          pawn.attackJob = { target, cooldown: ATTACK_INTERVAL, retrySeconds: .25, manual: false };
        }
      }
    }
    const job = pawn.attackJob;
    if (!job) return false;
    const manual = job.manual !== false;
    if (manual && pawn.mode !== 'drafted' || job.target.dead || job.target.departed
      || !manual && (!areHostile(pawn, job.target) || !inWeaponRange(pawn.weapon ?? 'unarmed', pawn.movement.tile, job.target.movement.tile))) {
      this.cancel(pawn); stopAtNextSafeTile(pawn.movement, this.construction.walls.cannotStop); return false;
    }
    const weapon = pawn.weapon ?? 'unarmed';
    if (!manual && !stationary(pawn)) return true;
    if (!stationary(pawn) || !inWeaponRange(weapon, pawn.movement.tile, job.target.movement.tile)) {
      job.retrySeconds -= seconds;
      const movedTarget = job.targetPosition !== positionKey(job.target.movement.tile);
      const changedGoal = job.goal && positionKey(job.goal) !== positionKey(pawn.movement.destination);
      if (job.retrySeconds <= 0 && (movedTarget || stationary(pawn) || changedGoal)) {
        job.retrySeconds = .25;
        const approach = this.attackApproach(pawn, job.target);
        if (approach) {
          job.goal = approach.goal; job.targetPosition = positionKey(job.target.movement.tile);
          setRoute(pawn.movement, approach.path.tiles);
        }
      }
      return true;
    }
    job.cooldown -= seconds;
    if (job.cooldown > 1e-9) return true;
    while (job.cooldown <= 1e-9) {
      job.cooldown += ATTACK_INTERVAL;
      const hit = this.random() < WEAPONS[weapon].accuracy;
      const event: AttackEvent = { attacker: pawn, target: job.target, weapon, hit,
        from: renderedPosition(pawn.movement), to: renderedPosition(job.target.movement),
        damage: hit ? WEAPONS[weapon].damage : 0 };
      if (hit) {
        job.target.hp = Math.max(0, (job.target.hp ?? 100) - WEAPONS[weapon].damage);
        if (job.target.hp <= 0) {
          killPawn(job.target, this.construction, this.harvesting, this.hauling);
          this.cancel(job.target);
          this.cancel(pawn);
          this.onAttack?.(event);
          break;
        }
      }
      this.onAttack?.(event);
    }
    return true;
  }
}
