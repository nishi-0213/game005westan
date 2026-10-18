import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat, ATTACK_INTERVAL } from '../src/combat.ts';
import { areHostile } from '../src/factions.ts';
import { attackRangeEdges } from '../src/attack-range.ts';
import { Wildlife, createDeer, createWolf, deerAction } from '../src/wildlife.ts';
import { createMovement } from '../src/movement.ts';
import { advancePathMovement } from '../src/pathfinding.ts';
import { Walls } from '../src/walls.ts';
import { Construction } from './helpers/construction.mjs';
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
  s.combat.update(a,.4,[ally,wild,enemy]);assert.equal(enemy.hp,70);assert.equal(ally.hp,100);assert.equal(wild.hp,100);
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
 s.combat.onAttack=e=>{event=e;assert.equal(target.hp,70)};s.combat.requestAttack(a,target);s.combat.update(a,.4);
 assert.equal(event.hit,true);assert.equal(event.damage,30);assert.deepEqual(event.from,tile(5,5));assert.deepEqual(event.to,tile(9,5));
 const m=scene(()=>.8),b=m.pawn(5,5,'player','rifle'),other=m.pawn(9,5);m.combat.onAttack=e=>event=e;m.combat.requestAttack(b,other);m.combat.update(b,.4);
 assert.equal(event.hit,false);assert.equal(event.damage,0);assert.equal(other.hp,100);
});

test('deer flee8tiles away on a hit or miss, preserve HP and return to ordinary behavior after arrival',()=>{
 for(const random of [()=>0,()=>.5]){
  const s=scene(random),a=s.pawn(5,15,'player','rifle'),deer=createDeer(tile(15,15),1);s.occupancy.track(deer.movement);
  s.combat.onAttack=e=>s.wildlife.flee(deer,e.from);s.combat.requestAttack(a,deer);s.combat.update(a,.4);
  assert.deepEqual(deer.fleeGoal,tile(23,15));assert.equal(deerAction(deer),'逃走中');assert.equal(deer.hp,random()===0?70:100);
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

test('deer share direct starvation HP loss at30per game day with humans',()=>{
 const s=scene(),deer=createDeer(tile(15,15),1);deer.needs.satiety=0;
 s.wildlife.updateDeer(deer,96);assert.equal(deer.hp,70);assert.equal(deer.dead,undefined);
 deer.hp=.3125;deer.bodyHp.torso=.3125;s.wildlife.updateDeer(deer,1);assert.equal(deer.hp,0);assert.equal(deer.dead,true);
});

test('unarmed range outlines exactly the3by3outer square and rifle outlines stay inside map bounds',()=>{
 const edges=attackRangeEdges(tile(5,5),'unarmed',32);assert.equal(edges.length,12);
 assert.ok(edges.every(e=>[e.from,e.to].every(t=>t.column>=4&&t.column<=7&&t.row>=4&&t.row<=7)));
 const rifle=attackRangeEdges(tile(0,0),'rifle',32);assert.ok(rifle.length>12);
 assert.ok(rifle.every(e=>[e.from,e.to].every(t=>t.column>=0&&t.row>=0&&t.column<=32&&t.row<=32)));
 assert.ok(rifle.some(e=>e.from.column===21||e.to.column===21));
 assert.equal(attackRangeEdges(tile(5,5),'unarmed',32).some(e=>e.from.column===5&&e.from.row===5),false);
});

test('drafted defenders prioritize animals preying on players over closer enemies and peaceful animals',()=>{
 const s=scene(),defender=s.pawn(2,3,'player','rifle'),victim=s.pawn(9,3,'player','unarmed','automatic'),enemy=s.pawn(3,4,'enemy1'),wolf=createWolf(tile(8,3),1),peaceful=createWolf(tile(3,2),2);
 assert.ok(s.combat.requestPredation(wolf,victim));
 s.combat.update(defender,0,[enemy,peaceful,wolf,victim]);assert.equal(defender.attackJob.target,wolf);assert.equal(defender.attackJob.manual,false);
 s.combat.update(defender,.4,[enemy,peaceful,wolf,victim]);assert.equal(wolf.hp,70);assert.equal(enemy.hp,100);assert.equal(peaceful.hp,100);
});

test('automatic player pawns do not acquire predators until drafted',()=>{
 const s=scene(),defender=s.pawn(2,3,'player','rifle','automatic'),victim=s.pawn(9,3),wolf=createWolf(tile(8,3),1);s.combat.requestPredation(wolf,victim);
 s.combat.update(defender,0,[wolf,victim]);assert.ok(!defender.attackJob);
 defender.mode='drafted';s.combat.update(defender,.25,[wolf,victim]);assert.equal(defender.attackJob.target,wolf);
 defender.mode='automatic';s.combat.update(defender,0,[wolf,victim]);assert.equal(defender.attackJob,null);
});

test('manual attack targets are never replaced by an animal preying on a player',()=>{
 const s=scene(),defender=s.pawn(2,3,'player','rifle'),victim=s.pawn(9,3),enemy=s.pawn(3,4,'enemy1'),wolf=createWolf(tile(8,3),1);
 s.combat.requestAttack(defender,enemy);s.combat.requestPredation(wolf,victim);
 s.combat.update(defender,.25,[wolf,victim,enemy]);assert.equal(defender.attackJob.target,enemy);assert.equal(defender.attackJob.manual,true);
});

test('automatic enemy targeting yields to a new predation threat and stops when predation ends',()=>{
 const s=scene(),defender=s.pawn(2,3,'player','rifle'),victim=s.pawn(9,3),enemy=s.pawn(3,4,'enemy1'),wolf=createWolf(tile(8,3),1);
 s.combat.update(defender,0,[enemy,wolf,victim]);assert.equal(defender.attackJob.target,enemy);
 s.combat.requestPredation(wolf,victim);s.combat.update(defender,.25,[enemy,wolf,victim]);assert.equal(defender.attackJob.target,wolf);
 s.combat.cancel(wolf);s.combat.update(defender,0,[wolf,victim]);assert.equal(defender.attackJob,null);
});

test('preying on wildlife or enemies does not make an animal an automatic defense target',()=>{
 for(const faction of ['wild','enemy1']){
  const s=scene(),defender=s.pawn(2,3,'player','rifle'),victim=s.pawn(9,3,faction),wolf=createWolf(tile(8,3),1);
  s.combat.requestPredation(wolf,victim);s.combat.update(defender,0,[wolf,victim]);
  if(faction==='wild')assert.ok(!defender.attackJob);else assert.equal(defender.attackJob.target,victim);
 }
});

test('defense targeting respects rifle range and walls and is independent of animal species names',()=>{
 for(const scenario of ['range','wall','futureSpecies']){
  const s=scene(),defender=s.pawn(1,3,'player','rifle'),column=scenario==='range'?24:8,victim=s.pawn(column+1,3),animal=createWolf(tile(column,3),1);
  if(scenario==='futureSpecies')animal.kind='futurePredator';
  s.combat.requestPredation(animal,victim);
  if(scenario==='wall')s.walls.complete(s.walls.plan(tile(4,3),'wood'));
  s.combat.update(defender,0,[animal,victim]);
  if(scenario==='futureSpecies')assert.equal(defender.attackJob.target,animal);else assert.ok(!defender.attackJob);
 }
});
