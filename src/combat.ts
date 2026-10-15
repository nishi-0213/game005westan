import {isFloor} from './walls.ts';
import { canPlan } from './path-schedule.ts';
import { canGiveOrders, rememberMood } from './mood.ts';
import { footprint } from './walls.ts';
import { rayTiles, shootingObstacles } from './shooting.ts';
import type { Tile } from './movement';
import { renderedPosition, setRoute, stopAtNextSafeTile } from './movement.ts';
import { findPaths } from './pathfinding.ts';
import type { Path } from './pathfinding';
import type { EatingWorker } from './needs';
import { killPawn } from './needs.ts';
import type { FactionMember } from './factions';
import { areHostile, isPlayerControlled } from './factions.ts';
import type { MapItem } from './items';
import { carryCapacity, returnItems, isWeaponItem } from './items.ts';
import { createMovement } from './movement.ts';
import type {Wall} from './walls';
import type { Construction } from './construction';
import type { Harvesting } from './harvesting';
import type { Hauling } from './hauling';

export type Weapon = 'unarmed' | 'rifle' | 'knife';
export const WEAPONS = {
  unarmed: { name: '素手', damage: 10, accuracy: .30, range: 1, interval: .2, penetration: 1 },
  knife: { name: 'ナイフ', damage: 50, accuracy: .50, range: 1, interval: .1, penetration: 2 },
  rifle: { name: 'ライフル', damage: 30, accuracy: .80, range: 20, interval: .4, penetration: 4 },
};
export const WOLF_BITE = { name: '牙', damage: 40, accuracy: .50, range: 1, interval: .3, penetration: 3 };
export const ATTACK_INTERVAL = WEAPONS.unarmed.interval;
export function attackStats(pawn: { kind?: string; weapon?: Weapon }) {
  return pawn.kind === 'wolf' ? WOLF_BITE : WEAPONS[pawn.weapon ?? 'unarmed'];
}
export function rifleAccuracy(distance: number): number {
  if (distance > WEAPONS.rifle.range) return 0;
  const points = [[4,.8],[10,.5],[15,.3],[20,.1]];
  if (distance <= points[0][0]) return points[0][1];
  for (let i=1;i<points.length;i++) {
    const [end,accuracy]=points[i], [start,previous]=points[i-1];
    if (distance <= end) return previous + (accuracy-previous)*(distance-start)/(end-start);
  }
  return 0;
}
export function attackDamage(damage: number, penetration: number, armor = 0): number {
  return damage * (penetration < armor ? .5 : 1);
}
export type CombatTarget = EatingWorker & FactionMember & { departed?: boolean; hunt?: boolean; structure?:Wall };
export interface AttackEvent {
  attacker: CombatPawn;
  target: CombatTarget;
  weapon: Weapon;
  hit: boolean;
  from: Tile;
  to: Tile;
  damage: number;
  impactStructure?:Wall;
}
export interface AttackOrder {
  target: CombatTarget;
  cooldown: number;
  retrySeconds: number;
  targetPosition?: string;
  goal?: Tile;
  manual?: boolean;
  hunting?: boolean;
  predation?: boolean;
  retaliation?:boolean;
  holdPosition?: Tile;
}
export type CombatPawn = CombatTarget & {
  weapon?: Weapon;
  freeSeconds?: number;
  attackJob?: AttackOrder | null;
  equipJob?: { source: MapItem; goal: Tile } | null;
  combatDecisionSeconds?: number;
  attackMotionSeconds?: number;
};

export function inWeaponRange(weapon: Weapon, from: Tile, target: Tile): boolean {
  const dc = Math.abs(from.column - target.column), dr = Math.abs(from.row - target.row);
  if (!dc && !dr) return false;
  return WEAPONS[weapon].range === 1 ? Math.max(dc, dr) <= 1 : dc * dc + dr * dr <= WEAPONS[weapon].range ** 2;
}

const stationary = (pawn: CombatPawn): boolean => !pawn.movement.nextTile
  && pawn.movement.tile.column === pawn.movement.destination.column && pawn.movement.tile.row === pawn.movement.destination.row;
const positionKey = (tile: Tile): string => `${tile.column},${tile.row}`;

export class Combat {
  readonly construction: Construction;
  readonly harvesting: Harvesting;
  readonly hauling: Hauling;
  readonly random: () => number;
  private structureTargets=new WeakMap<Wall,CombatTarget>();
  onDestroyStructure?:(structure:Wall)=>void;
  onAttack?: (event: AttackEvent) => void;

  constructor(construction: Construction, harvesting: Harvesting, hauling: Hauling, random: () => number = Math.random) {
    this.construction = construction; this.harvesting = harvesting; this.hauling = hauling; this.random = random;
  }

  structureTarget(structure:Wall):CombatTarget {
    let target=this.structureTargets.get(structure);if(target)return target;
    const walls=this.construction.walls;
    target={structure,faction:'player',mode:'automatic',movement:createMovement(structure),needs:{satiety:100},eatJob:null,inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,
      get hp(){return structure.hp??100;},set hp(value:number){structure.hp=value;},
      get dead(){return (structure.hp??100)<=0||structure.state!=='completed'||walls.at(structure)!==structure;}};
    this.structureTargets.set(structure,target);return target;
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
    if (!canGiveOrders(pawn) || pawn.dead || pawn.sleep || !isPlayerControlled(pawn) || !isWeaponItem(source.type) || source.quantity <= 0) return false;
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
    if(target.structure&&(!isPlayerControlled(pawn)||'kind' in pawn&&pawn.kind!=='human'||target.structure.state!=='completed'||isFloor(target.structure.kind)))return false;
    if (!canGiveOrders(pawn)||pawn.sleep||pawn === target || pawn.dead || target.dead || target.departed || pawn.mode !== 'drafted' || !isPlayerControlled(pawn)) return false;
    this.construction.walls.bindMovement(pawn.movement,pawn.faction);
    const approach = this.attackApproach(pawn, target);
    if (!approach) return false;
    this.interrupt(pawn); this.cancel(pawn);
    pawn.attackJob = { target, cooldown: attackStats(pawn).interval, retrySeconds: .25,
      targetPosition: positionKey(target.movement.tile), goal: approach.goal, manual: true,
      holdPosition:stationary(pawn)&&positionKey(pawn.movement.tile)===positionKey(approach.goal)?{...approach.goal}:undefined };
    return setRoute(pawn.movement, approach.path.tiles);
  }

  canFireFrom(weapon:Weapon,from:Tile,to:Tile,structure?:Wall):boolean {
    return Boolean(this.aimPoint(weapon,from,to,structure));
  }

  canReachAttack(pawn:CombatPawn,target:CombatTarget):boolean {
    this.construction.walls.bindMovement(pawn.movement,pawn.faction);
    return Boolean(this.attackApproach(pawn,target));
  }
  requestHunt(pawn:CombatPawn,target:CombatTarget):boolean {
    if(pawn.dead||pawn.mode!=='automatic'||!isPlayerControlled(pawn)||!target.hunt||target.dead||target.departed)return false;
    this.construction.walls.bindMovement(pawn.movement,pawn.faction);
    const approach=this.attackApproach(pawn,target);if(!approach)return false;
    this.interrupt(pawn);this.cancel(pawn);
    pawn.attackJob={target,cooldown:attackStats(pawn).interval,retrySeconds:.25,targetPosition:positionKey(target.movement.tile),goal:approach.goal,manual:false,hunting:true};
    return setRoute(pawn.movement,approach.path.tiles);
  }

  requestPredation(pawn:CombatPawn,target:CombatTarget):boolean {
    if(pawn.dead||target.dead||target.departed||target.structure||pawn.faction!=='wild')return false;
    this.construction.walls.bindMovement(pawn.movement,pawn.faction);
    const approach=this.attackApproach(pawn,target);if(!approach)return false;
    this.interrupt(pawn);this.cancel(pawn);
    pawn.attackJob={target,cooldown:attackStats(pawn).interval,retrySeconds:.25,targetPosition:positionKey(target.movement.tile),goal:approach.goal,manual:false,predation:true};
    return setRoute(pawn.movement,approach.path.tiles);
  }

  requestRetaliation(pawn:CombatPawn,target:CombatTarget):boolean {
    if(!('kind' in pawn)||pawn.kind!=='wolf'||!this.requestPredation(pawn,target))return false;
    pawn.attackJob!.predation=false;pawn.attackJob!.retaliation=true;return true;
  }

  private aimPoint(weapon:Weapon,from:Tile,to:Tile,structure?:Wall):Tile|undefined {
    const cells=structure?footprint(structure):[to];
    let best:Tile|undefined,distance=Infinity;
    for(const cell of cells){
      if(!inWeaponRange(weapon,from,cell)||(weapon==='rifle'&&shootingObstacles(this.construction.walls,from,cell,structure).blocked))continue;
      const next=Math.hypot(cell.column-from.column,cell.row-from.row);
      if(next<distance){best=cell;distance=next;}
    }
    return best;
  }

  private attackApproach(pawn: CombatPawn, target: CombatTarget): { goal: Tile; path: Path } | null {
    const walls = this.construction.walls;
    const paths = findPaths(pawn.movement.nextTile ?? pawn.movement.tile, walls.mapSize, walls.isBlocked, walls.cannotStop, pawn.movement);
    // Dijkstra's endpoint order is nearest first. Only stopping cells are filtered.
    for (const [index, path] of paths) {
      const goal = { column: index % walls.mapSize, row: Math.floor(index / walls.mapSize) };
      if (this.canFireFrom(pawn.weapon ?? 'unarmed', goal, target.movement.tile,target.structure)
        && (pawn.faction!=='wild'||this.predationClear(goal,target.movement.tile,pawn))) return { goal, path };
    }
    return null;
  }

  private predationClear(from:Tile,to:Tile,pawn:CombatPawn):boolean {
    return !rayTiles(from,to).slice(1).some(pawn.movement.terrainBlocked??this.construction.walls.isBlocked);
  }

  private automaticTarget(pawn: CombatPawn, targets: readonly CombatTarget[]): CombatTarget | null {
    let nearest: CombatTarget | null = null, distance = Infinity;
    for (const target of targets) {
      if (target === pawn || target.dead || target.departed || !areHostile(pawn, target)
        || !this.canFireFrom(pawn.weapon ?? 'unarmed', pawn.movement.tile, target.movement.tile,target.structure)) continue;
      const candidateDistance = Math.hypot(target.movement.tile.column - pawn.movement.tile.column, target.movement.tile.row - pawn.movement.tile.row);
      if (candidateDistance < distance) { distance = candidateDistance; nearest = target; }
    }
    return nearest;
  }

  update(pawn: CombatPawn, seconds: number, targets: readonly CombatTarget[] = []): boolean {
    if (pawn.dead || pawn.sleep || pawn.faction === 'wild' && !pawn.attackJob?.predation&&!pawn.attackJob?.retaliation) { this.cancel(pawn); return false; }
    this.construction.walls.bindMovement(pawn.movement,pawn.faction);
    const equip = pawn.equipJob;
    if (equip) {
      if (equip.source.quantity <= 0) { this.cancel(pawn); stopAtNextSafeTile(pawn.movement, this.construction.walls.cannotStop); return false; }
      if (!stationary(pawn)) return true;
      if (positionKey(pawn.movement.tile) !== positionKey(equip.goal)) { this.cancel(pawn); return false; }
      equip.source.quantity -= 1;
      if (pawn.weapon && pawn.weapon !== 'unarmed') returnItems(this.construction.items, pawn.movement.tile, pawn.weapon, 1);
      pawn.weapon = equip.source.type as Exclude<Weapon, 'unarmed'>; pawn.equipJob = null;
      if (pawn.inventory) {
        const excess = Math.max(0, pawn.inventory.quantity - carryCapacity(pawn, pawn.inventory.type));
        if (excess) { returnItems(this.construction.items, pawn.movement.tile, pawn.inventory.type, excess); pawn.inventory.quantity -= excess; }
        if (!pawn.inventory.quantity) pawn.inventory = null;
      }
      return true;
    }
    if (!pawn.attackJob && (pawn.forcedHaulSource || pawn.forcedCorpse || pawn.forcedConstruction)) return false;
    if (!pawn.attackJob) {
      pawn.combatDecisionSeconds = (pawn.combatDecisionSeconds ?? 0) - seconds;
      if (pawn.combatDecisionSeconds <= 0) {
        pawn.combatDecisionSeconds = .25;
        const target = this.automaticTarget(pawn, targets);
        if (target) {
          this.interrupt(pawn);
          pawn.attackJob = { target, cooldown: attackStats(pawn).interval, retrySeconds: .25, manual: false };
        }
      }
    }
    const job = pawn.attackJob;
    if (!job) return false;
    const manual = job.manual !== false;
    if (manual && pawn.mode !== 'drafted' || job.target.dead || job.target.departed
      || job.hunting && (pawn.mode!=='automatic'||!job.target.hunt)
      || !manual && !job.hunting && !job.predation && !job.retaliation && (!areHostile(pawn, job.target) || !this.canFireFrom(pawn.weapon ?? 'unarmed', pawn.movement.tile, job.target.movement.tile,job.target.structure))) {
      this.cancel(pawn); stopAtNextSafeTile(pawn.movement, this.construction.walls.cannotStop); return false;
    }
    const weapon = pawn.kind === 'wolf' ? 'unarmed' : pawn.weapon ?? 'unarmed';
    const stats = attackStats(pawn);
    if(manual&&!job.holdPosition&&stationary(pawn)&&job.goal&&positionKey(pawn.movement.tile)===positionKey(job.goal))job.holdPosition={...pawn.movement.tile};
    if(manual&&job.holdPosition&&!this.canFireFrom(weapon,pawn.movement.tile,job.target.movement.tile,job.target.structure))return true;
    if (!manual && !job.hunting && !job.predation && !job.retaliation && !stationary(pawn)) return true;
    if (!stationary(pawn) || (!this.canFireFrom(weapon, pawn.movement.tile, job.target.movement.tile,job.target.structure)
      || (job.predation||job.retaliation)&&!this.predationClear(pawn.movement.tile,job.target.movement.tile,pawn))) {
      job.retrySeconds -= seconds;
      const movedTarget = job.targetPosition !== positionKey(job.target.movement.tile);
      const changedGoal = job.goal && positionKey(job.goal) !== positionKey(pawn.movement.destination);
      const blocked=pawn.movement.terrainBlocked??this.construction.walls.isBlocked;
      const sealedRoute=(job.predation||job.retaliation)&&job.retrySeconds<=0&&((pawn.movement.nextTile&&blocked(pawn.movement.nextTile))||pawn.movement.route?.some(blocked));
      if (canPlan(pawn.movement) && job.retrySeconds <= 0 && (movedTarget || stationary(pawn) || changedGoal || sealedRoute)) {
        job.retrySeconds = .25;
        const approach = this.attackApproach(pawn, job.target);
        if (approach) {
          job.goal = approach.goal; job.targetPosition = positionKey(job.target.movement.tile);
          setRoute(pawn.movement, approach.path.tiles);
        } else if(job.predation||job.retaliation) {
          this.cancel(pawn);
          stopAtNextSafeTile(pawn.movement,this.construction.walls.cannotStop);
          return false;
        }
      }
      return true;
    }
    job.cooldown -= seconds;
    if (job.cooldown > 1e-9) return true;
    while (job.cooldown <= 1e-9) {
      job.cooldown += stats.interval;
      const aim=job.target.structure?this.aimPoint(weapon,pawn.movement.tile,job.target.movement.tile,job.target.structure)!:job.target.movement.tile;
      const covered=weapon==='rifle'&&shootingObstacles(this.construction.walls,pawn.movement.tile,aim,job.target.structure).covered;
      const distance=Math.hypot(aim.column-pawn.movement.tile.column,aim.row-pawn.movement.tile.row);
      const accuracy=Math.max(0,(weapon==='rifle'?rifleAccuracy(distance):stats.accuracy)-(covered?.4:0));
      const hit = this.random() < accuracy;
      const event: AttackEvent = { attacker: pawn, target: job.target, weapon, hit,
        from: renderedPosition(pawn.movement), to: job.target.structure?aim:renderedPosition(job.target.movement),
        damage: hit ? attackDamage(stats.damage, stats.penetration, job.target.armor) : 0 };
      if(!hit&&weapon==='rifle'){
        const angle=this.random()*Math.PI*2,offset=.6+this.random()*.9;
        event.to={column:event.to.column+Math.cos(angle)*offset,row:event.to.row+Math.sin(angle)*offset};
        const start={column:Math.floor(event.from.column+.5),row:Math.floor(event.from.row+.5)};
        const end={column:Math.floor(event.to.column+.5),row:Math.floor(event.to.row+.5)};
        // A missed bullet can strike a wall/door before its sampled landing point.
        for(const cell of rayTiles(start,end)){
          const obstacle=this.construction.walls.at(cell);
          if(obstacle?.state==='completed'&&(obstacle.kind==='wall'||obstacle.kind==='door')){
            event.to={...cell};break;
          }
        }
        const impact=this.construction.walls.at({column:Math.floor(event.to.column+.5),row:Math.floor(event.to.row+.5)});
        if(impact?.state==='completed'){
          event.impactStructure=impact;event.damage=attackDamage(stats.damage,stats.penetration);
          impact.hp=Math.max(0,(impact.hp??100)-event.damage);
          if(impact.hp<=0)this.onDestroyStructure?.(impact);
        }
      }
      if (hit) {
        job.target.hp = Math.max(0, (job.target.hp ?? 100) - event.damage);
        if (job.target.hp <= 0) {
          if(job.hunting){job.target.collectCorpse=true;job.target.hunt=false;}
          if(job.target.structure)this.onDestroyStructure?.(job.target.structure);
          else{if(job.target.kind==='human')rememberMood(pawn,'killedHuman');killPawn(job.target, this.construction, this.harvesting, this.hauling);this.cancel(job.target);}
          this.cancel(pawn);
          pawn.attackMotionSeconds=.25;
          this.onAttack?.(event);
          break;
        }
      }
      pawn.attackMotionSeconds=.25;
      this.onAttack?.(event);
      if(job.target.dead){this.cancel(pawn);break;}
    }
    return true;
  }
}
