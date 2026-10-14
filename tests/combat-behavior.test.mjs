import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat, ATTACK_INTERVAL } from '../src/combat.ts';
import { areHostile } from '../src/factions.ts';
import { attackRangeEdges } from '../src/attack-range.ts';
import { Wildlife, createDeer, deerAction } from '../src/wildlife.ts';
import { createMovement } from '../src/movement.ts';
import { advancePathMovement } from '../src/pathfinding.ts';
import { Walls } from '../src/walls.ts';
import { Construction } from '../src/construction.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Hauling } from '../src/hauling.ts';
import { Storage } from '../src/storage.ts';
import { PawnOccupancy } from '../src/pawn-occupancy.ts';
import { initialNeeds } from '../src/needs.ts';
const tile=(column,row)=>({column,row});
function scene(random=()=>0){
 const walls=new Walls(32),items=[],storage=new Storage(walls),construction=new Construction(walls,items,t=>walls.complete(t));
 const harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,storage),combat=new Combat(construction,harvesting,hauling,random),wildlife=new Wildlife(construction,harvesting,hauling),occupancy=new PawnOccupancy();
 const pawn=(column,row,faction='player',weapon='unarmed',mode='drafted')=>{const p={movement:createMovement(tile(column,row)),faction,weapon,mode,hp:100,needs:initialNeeds(),eatJob:null,inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0};occupancy.track(p.movement);return p};
 const move=(p,seconds=.1)=>advancePathMovement(p.movement,seconds,32,walls.isBlocked,walls.cannotStop);
 return{walls,items,construction,harvesting,hauling,combat,wildlife,occupancy,pawn,move};
}

test('automatic hostility is reciprocal player/enemy only; wildlife and allies stay neutral',()=>{
 for(const a of ['player','enemy1','wild'])for(const b of ['player','enemy1','wild'])assert.equal(areHostile({faction:a},{faction:b}),a!==b&&a!=='wild'&&b!=='wild');
});

test('automatic and drafted humans automatically attack only enemies inside their own range',()=>{
 for(const mode of ['drafted','automatic']){
  const s=scene(),a=s.pawn(5,5,'player','rifle',mode),ally=s.pawn(6,5),wild=createDeer(tile(7,5),1),enemy=s.pawn(12,5,'enemy1');
  s.combat.update(a,0,[ally,wild,enemy]);assert.equal(a.attackJob.target,enemy);assert.equal(a.attackJob.manual,false);
  s.combat.update(a,ATTACK_INTERVAL,[ally,wild,enemy]);assert.equal(enemy.hp,60);assert.equal(ally.hp,100);assert.equal(wild.hp,100);
  enemy.movement.tile=tile(31,31);enemy.movement.destination=tile(31,31);enemy.movement.changed();s.combat.update(a,.1,[enemy]);assert.equal(a.attackJob,null);
  assert.deepEqual(a.movement.destination,tile(5,5));
 }
 const s=scene(),enemy=s.pawn(5,5,'enemy1','unarmed','automatic'),player=s.pawn(6,5);
 s.combat.update(enemy,0,[player]);s.combat.update(enemy,ATTACK_INTERVAL,[player]);assert.equal(player.hp,90);
});

test('manual attacks keep the same target despite faction changes and holding position when targets leave range and resuming when they return',()=>{
 const s=scene(),a=s.pawn(5,5,'player','rifle'),target=s.pawn(10,5,'player');s.combat.requestAttack(a,target);
 target.faction='wild';target.movement.tile=tile(30,5);target.movement.destination=tile(30,5);target.movement.changed();
 const rival=s.pawn(5,6,'enemy1');
 for(let i=0;i<300&&!target.dead;i++){s.combat.update(a,.1,[rival]);s.move(a);}
 assert.equal(rival.hp,100);
 assert.equal(target.hp,100);assert.deepEqual(a.movement.tile,tile(5,5));assert.equal(a.attackJob.target,target);
 target.movement.tile=tile(10,5);target.movement.destination=tile(10,5);target.movement.changed();
 for(let i=0;i<100&&!target.dead;i++){s.combat.update(a,.1,[rival]);s.move(a);}
 assert.equal(target.dead,true);assert.equal(a.attackJob,null);
});

test('every shot reports a hit or miss at fire time and hit damage is already applied before visuals',()=>{
 const s=scene(()=>.05),a=s.pawn(5,5,'player','rifle'),target=s.pawn(9,5);let event;
 s.combat.onAttack=e=>{event=e;assert.equal(target.hp,60)};s.combat.requestAttack(a,target);s.combat.update(a,2.5);
 assert.equal(event.hit,true);assert.equal(event.damage,40);assert.deepEqual(event.from,tile(5,5));assert.deepEqual(event.to,tile(9,5));
 const m=scene(()=>.5),b=m.pawn(5,5,'player','rifle'),other=m.pawn(9,5);m.combat.onAttack=e=>event=e;m.combat.requestAttack(b,other);m.combat.update(b,2.5);
 assert.equal(event.hit,false);assert.equal(event.damage,0);assert.equal(other.hp,100);
});

test('deer flee8tiles away on a hit or miss, preserve health/HP and return to ordinary behavior after arrival',()=>{
 for(const random of [()=>0,()=>.5]){
  const s=scene(random),a=s.pawn(5,15,'player','rifle'),deer=createDeer(tile(15,15),1);s.occupancy.track(deer.movement);
  s.combat.onAttack=e=>s.wildlife.flee(deer,e.from);s.combat.requestAttack(a,deer);s.combat.update(a,2.5);
  assert.deepEqual(deer.fleeGoal,tile(23,15));assert.equal(deerAction(deer),'逃走中');assert.equal(deer.needs.health,100);assert.equal(deer.hp,random()===0?60:100);
  for(let i=0;i<25;i++){s.wildlife.updateDeer(deer,.1);s.move(deer)}
  assert.equal(deer.fleeGoal,undefined);assert.deepEqual(deer.movement.tile,tile(23,15));assert.equal(deerAction(deer),'自由');
 }
});

test('fleeing avoids blocked/reserved endpoints and can move along a map edge instead of toward the attacker',()=>{
 const s=scene(),deer=createDeer(tile(15,15),1);s.occupancy.track(deer.movement);s.pawn(23,15);
 const wall=s.walls.plan(tile(22,15),'wood');s.walls.complete(wall);assert.ok(s.wildlife.flee(deer,tile(5,15)));
 assert.notDeepEqual(deer.fleeGoal,tile(23,15));assert.ok(deer.fleeGoal.column>15);assert.ok(Math.hypot(deer.fleeGoal.column-15,deer.fleeGoal.row-15)<=8);
 const edge=createDeer(tile(31,15),2);s.occupancy.track(edge.movement);assert.ok(s.wildlife.flee(edge,tile(30,15)));
 assert.equal(edge.fleeGoal.column,31);assert.equal(Math.abs(edge.fleeGoal.row-15),8);
});

test('deer use the same satiety-to-health-to-HP death sequence as humans',()=>{
 const s=scene(),deer=createDeer(tile(15,15),1);deer.needs.satiety=0;deer.needs.health=1;
 s.wildlife.updateDeer(deer,1);assert.equal(deer.needs.health,0);assert.equal(deer.hp,100);assert.equal(deer.dead,undefined);
 s.wildlife.updateDeer(deer,.1);assert.equal(deer.hp,99);s.wildlife.updateDeer(deer,9.9);assert.equal(deer.hp,0);assert.equal(deer.dead,true);
});

test('unarmed range outlines exactly the3by3outer square and rifle outlines stay inside map bounds',()=>{
 const edges=attackRangeEdges(tile(5,5),'unarmed',32);assert.equal(edges.length,12);
 assert.ok(edges.every(e=>[e.from,e.to].every(t=>t.column>=4&&t.column<=7&&t.row>=4&&t.row<=7)));
 const rifle=attackRangeEdges(tile(0,0),'rifle',32);assert.ok(rifle.length>12);
 assert.ok(rifle.every(e=>[e.from,e.to].every(t=>t.column>=0&&t.row>=0&&t.column<=32&&t.row<=32)));
 assert.ok(rifle.some(e=>e.from.column===17||e.to.column===17));
 assert.equal(attackRangeEdges(tile(5,5),'unarmed',32).some(e=>e.from.column===5&&e.from.row===5),false);
});
