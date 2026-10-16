import { createWolf, createDeer } from '../src/wildlife.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat, ATTACK_INTERVAL, WEAPONS, WOLF_BITE, rifleAccuracy, inWeaponRange } from '../src/combat.ts';
import { PawnOccupancy } from '../src/pawn-occupancy.ts';
import { createMovement } from '../src/movement.ts';
import { advancePathMovement, findPaths } from '../src/pathfinding.ts';
import { Walls } from '../src/walls.ts';
import { Construction } from '../src/construction.ts';
import { Storage } from '../src/storage.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Hauling } from '../src/hauling.ts';
import { carryCapacity, ITEM_APPEARANCE, countItems } from '../src/items.ts';
import {shootingObstacles} from '../src/shooting.ts';
import { initialNeeds, updateNeeds } from '../src/needs.ts';

const tile=(column,row)=>({column,row});
const key=t=>`${t.column},${t.row}`;
function scene(random=()=>0){
 const walls=new Walls(32),items=[],storage=new Storage(walls),construction=new Construction(walls,items,t=>walls.complete(t));construction.storage=storage;
 const harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,storage),combat=new Combat(construction,harvesting,hauling,random),occupancy=new PawnOccupancy();
 const pawn=(column,row,weapon='unarmed')=>{
  const p={movement:createMovement(tile(column,row)),mode:'drafted',faction:'player',weapon,hp:100,inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,needs:initialNeeds(),eatJob:null};occupancy.track(p.movement);return p;
 };
 const move=(p,seconds=.1)=>advancePathMovement(p.movement,seconds,32,walls.isBlocked,walls.cannotStop);
 const tick=(p,seconds=.1)=>{combat.update(p,seconds);move(p,seconds)};
 return{walls,items,storage,construction,harvesting,hauling,combat,occupancy,pawn,move,tick};
}

test('unarmed attacks include diagonal neighbors and rifle range uses the inclusive20tile circle',()=>{
 assert.ok(inWeaponRange('unarmed',tile(5,5),tile(6,6)));
 assert.equal(inWeaponRange('unarmed',tile(5,5),tile(7,5)),false);
 assert.equal(inWeaponRange('unarmed',tile(5,5),tile(5,5)),false);
 for(const t of [tile(20,0),tile(16,12),tile(14,14)])assert.ok(inWeaponRange('rifle',tile(0,0),t));
 assert.equal(inWeaponRange('rifle',tile(0,0),tile(20,1)),false);
 assert.equal(ATTACK_INTERVAL,.2);
});

test('unarmed hits do10HP damage every0.2seconds and exact30percent rolls miss',()=>{
 const s=scene(()=>.299),a=s.pawn(3,3),b=s.pawn(4,4);
 assert.ok(s.combat.requestAttack(a,b));s.combat.update(a,.199);assert.equal(b.hp,100);s.combat.update(a,.001);assert.equal(b.hp,90);
 s.combat.update(a,.4);assert.equal(b.hp,70);
 const t=scene(()=>.3),c=t.pawn(3,3),d=t.pawn(4,4);t.combat.requestAttack(c,d);t.combat.update(c,10);assert.equal(d.hp,100);
});

test('rifle hits at distance10 use50percent accuracy and30HP damage every0.4seconds',()=>{
 const s=scene(()=>.499),a=s.pawn(3,3,'rifle'),b=s.pawn(13,3);
 s.combat.requestAttack(a,b);s.combat.update(a,.399);assert.equal(b.hp,100);s.combat.update(a,.001);assert.equal(b.hp,70);
 s.combat.update(a,.4);assert.equal(b.hp,40);s.combat.update(a,.4);assert.equal(b.hp,10);assert.equal(b.dead,undefined);
 s.combat.update(a,.4);assert.equal(b.hp,0);assert.equal(b.dead,true);assert.equal(a.attackJob,null);
 const t=scene(()=>.5),c=t.pawn(3,3,'rifle'),d=t.pawn(13,3);t.combat.requestAttack(c,d);t.combat.update(c,1.2);assert.equal(d.hp,100);
});

test('out-of-range attacks choose the nearest reachable stopping cell in range and never stop on a pawn',()=>{
 const s=scene(),a=s.pawn(2,5,'rifle'),b=s.pawn(23,5);s.pawn(7,5);
 const wall=s.walls.plan(tile(8,5),'wood');s.walls.complete(wall);
 const paths=findPaths(a.movement.tile,32,s.walls.isBlocked,s.walls.cannotStop,a.movement);
 const candidates=[...paths].filter(([index])=>s.combat.canFireFrom('rifle',tile(index%32,Math.floor(index/32)),b.movement.tile));
 assert.ok(s.combat.requestAttack(a,b));const goal=a.movement.destination;
 assert.ok(inWeaponRange('rifle',goal,b.movement.tile));assert.notEqual(key(goal),key(b.movement.tile));assert.notEqual(key(goal),'7,5');
 assert.equal(paths.get(goal.row*32+goal.column).distance,Math.min(...candidates.map(([,p])=>p.distance)));
 for(let i=0;i<100&&b.hp===100;i++)s.tick(a);
 assert.equal(b.hp,70);
});

test('an unreachable target receives no attack and auto, wild, dead and self attacks are rejected',()=>{
 const s=scene(),a=s.pawn(2,2),b=s.pawn(5,5);
 for(let row=4;row<=6;row++)for(let column=4;column<=6;column++){if(row===5&&column===5)continue;const w=s.walls.plan(tile(column,row),'wood');s.walls.complete(w);}
 assert.equal(s.combat.requestAttack(a,b),false);assert.equal(a.attackJob,undefined);
 assert.equal(s.combat.requestAttack(a,a),false);a.mode='automatic';assert.equal(s.combat.requestAttack(a,b),false);
 a.mode='drafted';a.faction='wild';assert.equal(s.combat.requestAttack(a,b),false);a.faction='player';a.dead=true;assert.equal(s.combat.requestAttack(a,b),false);
});

test('drafted attacks hold their original firing position when targets leave range, and departure cancels the attack',()=>{
 const s=scene(),a=s.pawn(2,2),b=s.pawn(3,2);s.combat.requestAttack(a,b);
 b.movement.tile=tile(12,12);b.movement.destination=tile(12,12);b.movement.changed();s.combat.update(a,.3);
 assert.deepEqual(a.movement.destination,tile(2,2));assert.equal(b.hp,100);assert.ok(a.attackJob);
 b.departed=true;s.combat.update(a,.1);assert.equal(a.attackJob,null);
});

test('both modes can equip one ground rifle; equipped weight reduces transport to15kg and excess items stay on the ground',()=>{
 for(const mode of ['drafted','automatic']){
  const s=scene(),a=s.pawn(2,2),source={...tile(3,2),type:'rifle',quantity:1};s.items.push(source);a.mode=mode;a.inventory={type:'wood',quantity:20};
  assert.ok(s.combat.requestEquip(a,source));for(let i=0;i<20&&a.equipJob;i++)s.tick(a);
  assert.equal(source.quantity,0);assert.equal(a.weapon,'rifle');assert.equal(a.mode,mode);assert.equal(a.inventory.quantity,15);
  assert.equal(countItems(s.items).wood,5);assert.equal(ITEM_APPEARANCE.rifle.massKg,5);
  assert.equal(carryCapacity(a,'wood'),15);assert.equal(carryCapacity(a,'stone'),3);assert.equal(carryCapacity(a,'rifle'),3);
 }
});

test('two equip orders never duplicate the last weapon and replacement returns the old rifle',()=>{
 const s=scene(),a=s.pawn(2,2),b=s.pawn(2,3),source={...tile(3,2),type:'rifle',quantity:1};s.items.push(source);
 s.combat.requestEquip(a,source);s.combat.requestEquip(b,source);
 for(let i=0;i<20;i++){s.tick(a);s.tick(b);}
 assert.equal([a,b].filter(p=>p.weapon==='rifle').length,1);assert.equal(source.quantity,0);
 const equipped=[a,b].find(p=>p.weapon==='rifle');
 const replacement={...tile(4,2),type:'rifle',quantity:1};s.items.push(replacement);s.combat.requestEquip(equipped,replacement);
 for(let i=0;i<20&&equipped.equipJob;i++)s.tick(equipped);
 assert.equal(countItems(s.items).rifle,1);assert.equal(equipped.weapon,'rifle');
});

test('starvation HP drain counts only the time after satiety reaches zero and stops after feeding',()=>{
 const s=scene(),a=s.pawn(2,2);a.needs.satiety=.5;
 updateNeeds(a,s.construction,s.harvesting,s.hauling,1.5);assert.equal(a.hp,99.375);assert.equal(a.dead,undefined);
 a.needs.satiety=100;updateNeeds(a,s.construction,s.harvesting,s.hauling,1);assert.equal(a.hp,99.375);
 a.needs.satiety=0;a.hp=.625;updateNeeds(a,s.construction,s.harvesting,s.hauling,1);assert.equal(a.hp,0);assert.equal(a.dead,true);
});

test('equipped workers haul and build using real3stone batches without exceeding20kg including the weapon',()=>{
 const s=scene(),a=s.pawn(2,2,'rifle');a.mode='automatic';const source={...tile(4,2),type:'stone',quantity:8,collect:true};s.items.push(source);
 const box=s.walls.plan(tile(6,4),'wood','storage');s.walls.complete(box);let maximum=0;
 for(let i=0;i<200;i++){s.hauling.update(a);s.move(a);maximum=Math.max(maximum,a.inventory?.quantity??0);assert.ok(5+(a.inventory?.quantity??0)*4<=20);}
 assert.equal(maximum,3);assert.equal(source.quantity,0);assert.equal(box.stored.stone,8);
 s.storage.deposit(box,'stone',12);const wall=s.walls.plan(tile(9,6),'stone');maximum=0;
 for(let i=0;i<300&&wall.state!=='completed';i++){s.construction.update(a,.1);s.move(a);maximum=Math.max(maximum,a.inventory?.quantity??0);assert.ok(5+(a.inventory?.quantity??0)*4<=20);}
 assert.equal(maximum,3);assert.equal(wall.delivered,2);assert.equal(wall.state,'completed');
 assert.equal(box.stored.stone+(a.inventory?.quantity??0),18);
});

 test('knife has50percent accuracy,50damage and diagonal melee range; equip replacement and drop preserve both weapons',()=>{
 const s=scene(()=>.499),a=s.pawn(3,3,'knife'),b=s.pawn(4,4);s.combat.requestAttack(a,b);s.combat.update(a,.099);assert.equal(b.hp,100);s.combat.update(a,.001);assert.equal(b.hp,50);
 assert.equal(inWeaponRange('knife',tile(3,3),tile(5,3)),false);
 const t=scene(()=>.5),c=t.pawn(3,3,'knife'),d=t.pawn(4,4);t.combat.requestAttack(c,d);t.combat.update(c,2.5);assert.equal(d.hp,100);
 const e=scene(),p=e.pawn(2,2,'rifle'),knife={...tile(3,2),type:'knife',quantity:1};e.items.push(knife);e.combat.requestEquip(p,knife);
 for(let i=0;i<30&&p.equipJob;i++){e.move(p);e.combat.update(p,.1)}
 assert.equal(p.weapon,'knife');assert.equal(knife.quantity,0);assert.equal(countItems(e.items).rifle,1);assert.equal(ITEM_APPEARANCE.knife.massKg,2);assert.equal(carryCapacity(p,'wood'),18);
 e.construction.requestDrop(p);e.construction.update(p,.1);assert.equal(p.weapon,'unarmed');assert.equal(countItems(e.items).knife,1);
 });

test('rifles cannot fire through completed walls but barricades subtract40percentage points once',()=>{
 for(const roll of [.299,.301]){const s=scene(()=>roll),a=s.pawn(3,3,'rifle'),b=s.pawn(9,3);const barrier=s.walls.plan(tile(6,3),'wood','barricade');s.walls.complete(barrier);const second=s.walls.plan(tile(7,3),'wood','barricade');s.walls.complete(second);s.combat.requestAttack(a,b);s.combat.update(a,.4);assert.equal(b.hp,roll<.3?70:100);}
 const s=scene(),a=s.pawn(3,3,'rifle'),b=s.pawn(9,3);s.combat.requestAttack(a,b);const wall=s.walls.plan(tile(6,3),'wood');s.walls.complete(wall);let shots=0;s.combat.onAttack=()=>shots++;s.combat.update(a,10);assert.equal(b.hp,100);assert.equal(shots,0);assert.deepEqual(a.movement.destination,tile(3,3));
 s.walls.erase(wall);s.combat.update(a,.4);assert.equal(b.hp,70);
});
test('initial rifle approach chooses the nearest reachable point with an unobstructed shot',()=>{
 const s=scene(),a=s.pawn(3,3,'rifle'),b=s.pawn(9,3);const wall=s.walls.plan(tile(6,3),'wood');s.walls.complete(wall);assert.ok(s.combat.requestAttack(a,b));assert.notDeepEqual(a.movement.destination,a.movement.tile);assert.equal(shootingObstacles(s.walls,a.movement.destination,b.movement.tile).blocked,false);
});

test('completed doors block rifle shots while planned doors do not',()=>{
const s=scene(),a=s.pawn(3,3,'rifle'),b=s.pawn(9,3);const door=s.walls.plan(tile(6,3),'wood','door');assert.equal(s.combat.canFireFrom('rifle',a.movement.tile,b.movement.tile),true);s.walls.complete(door);assert.equal(s.combat.canFireFrom('rifle',a.movement.tile,b.movement.tile),false);assert.equal(s.combat.canFireFrom('knife',tile(5,3),tile(6,3)),true);
});

test('rifle accuracy interpolates all control points and interval midpoints and clamps close range',()=>{
 for(const [distance,accuracy] of [[0,.8],[1,.8],[4,.8],[7,.65],[10,.5],[12.5,.4],[15,.3],[17.5,.2],[20,.1],[20.01,0]])assert.ok(Math.abs(rifleAccuracy(distance)-accuracy)<1e-12,`${distance}: ${rifleAccuracy(distance)}`);
});

test('rifle shots use the accuracy at their actual tile distance including the maximum range',()=>{
 for(const [distance,accuracy] of [[1,.8],[4,.8],[7,.65],[10,.5],[15,.3],[20,.1]])for(const hit of [true,false]){
  const s=scene(()=>accuracy+(hit?-.0001:.0001)),a=s.pawn(1,3,'rifle'),b=s.pawn(1+distance,3);
  s.combat.requestAttack(a,b);s.combat.update(a,.4);assert.equal(b.hp,hit?70:100,`distance ${distance}, hit ${hit}`);
 }
});

test('every attack halves damage only when penetration is strictly below armor and reports actual damage',()=>{
 for(const weapon of ['unarmed','knife','rifle','fangs'])for(const difference of [-1,0,1]){
  const s=scene(),a=weapon==='fangs'?createWolf(tile(3,3),1):s.pawn(3,3,weapon),b=s.pawn(4,3);
  const stats=weapon==='fangs'?WOLF_BITE:WEAPONS[weapon];b.armor=stats.penetration+difference;let event;s.combat.onAttack=e=>event=e;
  assert.ok(weapon==='fangs'?s.combat.requestPredation(a,b):s.combat.requestAttack(a,b));
  s.combat.update(a,stats.interval);
  const expected=stats.damage*(difference>0?.5:1);assert.equal(b.hp,100-expected);assert.equal(event.damage,expected);
 }
});

test('wolf fangs have their own0.3second interval,50percent accuracy,40damage and3penetration',()=>{
 assert.equal(WOLF_BITE.penetration,3);
 for(const [roll,hit]of [[.499,true],[.5,false]]){
  const s=scene(()=>roll),wolf=createWolf(tile(3,3),1),target=s.pawn(4,3);
  assert.equal(wolf.armor,0);assert.equal(createDeer(tile(5,3),2).armor,0);
  s.combat.requestPredation(wolf,target);s.combat.update(wolf,.299);assert.equal(target.hp,100);
  s.combat.update(wolf,.001);assert.equal(target.hp,hit?60:100);
  s.combat.update(wolf,.3);assert.equal(target.hp,hit?20:100);
 }
});

test('equipping clothes consumes one, replaces its slot, preserves weapons and drops excess cargo',()=>{
 const s=scene(),p=s.pawn(3,3,'rifle');p.clothing={head:'hat',torso:'jacket',legs:'trousers'};p.inventory={type:'wood',quantity:12};
 const source={column:3,row:3,type:'ballisticVest',quantity:2};s.items.push(source);
 assert.equal(s.combat.requestEquip(p,source),true);s.combat.update(p,0);
 assert.equal(source.quantity,1);assert.equal(p.clothing.outerwear,'ballisticVest');assert.equal(p.weapon,'rifle');assert.equal(p.inventory.quantity,2);
 assert.equal(countItems(s.items).wood,10);
 const replacement={column:3,row:3,type:'jacket',quantity:1};s.items.push(replacement);
 assert.equal(s.combat.requestEquip(p,replacement),true);s.combat.update(p,0);
 assert.equal(replacement.quantity,1);assert.equal(p.clothing.torso,'jacket');
 assert.equal(p.clothing.outerwear,'ballisticVest');
});

test('clothes protect targets in real combat and removing clothes restores full damage',()=>{
 const s=scene(),a=s.pawn(3,3,'knife'),b=s.pawn(4,3);b.clothing={head:'hat',torso:'jacket',legs:'trousers'};
 assert.equal(s.combat.requestAttack(a,b),true);s.combat.update(a,.1);assert.equal(b.hp,75);
 b.clothing={};s.combat.update(a,.1);assert.equal(b.hp,25);
});
