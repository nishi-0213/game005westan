import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat, ATTACK_INTERVAL, inWeaponRange } from '../src/combat.ts';
import { PawnOccupancy } from '../src/pawn-occupancy.ts';
import { createMovement } from '../src/movement.ts';
import { advancePathMovement, findPaths } from '../src/pathfinding.ts';
import { Walls } from '../src/walls.ts';
import { Construction } from '../src/construction.ts';
import { Storage } from '../src/storage.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Hauling } from '../src/hauling.ts';
import { carryCapacity, ITEM_APPEARANCE, countItems } from '../src/items.ts';
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

test('unarmed attacks include diagonal neighbors and rifle range uses the inclusive16tile circle',()=>{
 assert.ok(inWeaponRange('unarmed',tile(5,5),tile(6,6)));
 assert.equal(inWeaponRange('unarmed',tile(5,5),tile(7,5)),false);
 assert.equal(inWeaponRange('unarmed',tile(5,5),tile(5,5)),false);
 for(const t of [tile(16,0),tile(15,5),tile(11,11)])assert.ok(inWeaponRange('rifle',tile(0,0),t));
 assert.equal(inWeaponRange('rifle',tile(0,0),tile(16,1)),false);
 assert.equal(ATTACK_INTERVAL,2.5);
});

test('unarmed hits do10HP damage every2.5seconds and exact80percent rolls miss',()=>{
 const s=scene(()=>.799),a=s.pawn(3,3),b=s.pawn(4,4);
 assert.ok(s.combat.requestAttack(a,b));s.combat.update(a,2.49);assert.equal(b.hp,100);s.combat.update(a,.01);assert.equal(b.hp,90);
 s.combat.update(a,5);assert.equal(b.hp,70);assert.equal(b.needs.health,100);
 const t=scene(()=>.8),c=t.pawn(3,3),d=t.pawn(4,4);t.combat.requestAttack(c,d);t.combat.update(c,10);assert.equal(d.hp,100);
});

test('rifle hits use50percent accuracy and40HP damage, killing immediately at zero even when health is100',()=>{
 const s=scene(()=>.499),a=s.pawn(3,3,'rifle'),b=s.pawn(15,3);
 s.combat.requestAttack(a,b);s.combat.update(a,2.5);assert.equal(b.hp,60);s.combat.update(a,2.5);assert.equal(b.hp,20);assert.equal(b.dead,undefined);
 s.combat.update(a,2.5);assert.equal(b.hp,0);assert.equal(b.dead,true);assert.equal(b.needs.health,100);assert.equal(a.attackJob,null);
 const t=scene(()=>.5),c=t.pawn(3,3,'rifle'),d=t.pawn(15,3);t.combat.requestAttack(c,d);t.combat.update(c,10);assert.equal(d.hp,100);
});

test('out-of-range attacks choose the nearest reachable stopping cell in range and never stop on a pawn',()=>{
 const s=scene(),a=s.pawn(2,5,'rifle'),b=s.pawn(23,5);s.pawn(7,5);
 const wall=s.walls.plan(tile(8,5),'wood');s.walls.complete(wall);
 const paths=findPaths(a.movement.tile,32,s.walls.isBlocked,s.walls.cannotStop,a.movement);
 const candidates=[...paths].filter(([index])=>inWeaponRange('rifle',tile(index%32,Math.floor(index/32)),b.movement.tile));
 assert.ok(s.combat.requestAttack(a,b));const goal=a.movement.destination;
 assert.ok(inWeaponRange('rifle',goal,b.movement.tile));assert.notEqual(key(goal),key(b.movement.tile));assert.notEqual(key(goal),'7,5');
 assert.equal(paths.get(goal.row*32+goal.column).distance,Math.min(...candidates.map(([,p])=>p.distance)));
 for(let i=0;i<100&&b.hp===100;i++)s.tick(a);
 assert.equal(b.hp,60);
});

test('an unreachable target receives no attack and auto, wild, dead and self attacks are rejected',()=>{
 const s=scene(),a=s.pawn(2,2),b=s.pawn(5,5);
 for(let row=4;row<=6;row++)for(let column=4;column<=6;column++){if(row===5&&column===5)continue;const w=s.walls.plan(tile(column,row),'wood');s.walls.complete(w);}
 assert.equal(s.combat.requestAttack(a,b),false);assert.equal(a.attackJob,undefined);
 assert.equal(s.combat.requestAttack(a,a),false);a.mode='automatic';assert.equal(s.combat.requestAttack(a,b),false);
 a.mode='drafted';a.faction='wild';assert.equal(s.combat.requestAttack(a,b),false);a.faction='player';a.dead=true;assert.equal(s.combat.requestAttack(a,b),false);
});

test('moving targets are approached again, and death or departure cancels the attack',()=>{
 const s=scene(),a=s.pawn(2,2),b=s.pawn(3,2);s.combat.requestAttack(a,b);
 b.movement.tile=tile(12,12);b.movement.destination=tile(12,12);b.movement.changed();s.combat.update(a,.3);
 assert.ok(inWeaponRange('unarmed',a.movement.destination,b.movement.tile));assert.notEqual(key(a.movement.destination),key(b.movement.tile));
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

test('health0 drains HP at10percent per second, counting only the part after health reaches zero',()=>{
 const s=scene(),a=s.pawn(2,2);a.needs.satiety=.5;a.needs.health=.5;
 updateNeeds(a,s.construction,s.harvesting,s.hauling,1.5);assert.equal(a.needs.health,0);assert.equal(a.hp,95);assert.equal(a.dead,undefined);
 updateNeeds(a,s.construction,s.harvesting,s.hauling,.1);assert.equal(a.hp,94);
 a.needs.satiety=100;updateNeeds(a,s.construction,s.harvesting,s.hauling,.4);assert.equal(a.hp,90);
 updateNeeds(a,s.construction,s.harvesting,s.hauling,9);assert.equal(a.hp,0);assert.equal(a.dead,true);
});

test('equipped workers haul and build using real3stone batches without exceeding20kg including the weapon',()=>{
 const s=scene(),a=s.pawn(2,2,'rifle');a.mode='automatic';const source={...tile(4,2),type:'stone',quantity:8,collect:true};s.items.push(source);
 const box=s.walls.plan(tile(6,4),'wood','storage');s.walls.complete(box);let maximum=0;
 for(let i=0;i<200;i++){s.hauling.update(a);s.move(a);maximum=Math.max(maximum,a.inventory?.quantity??0);assert.ok(5+(a.inventory?.quantity??0)*4<=20);}
 assert.equal(maximum,3);assert.equal(source.quantity,0);assert.equal(box.stored.stone,8);
 s.storage.deposit(box,'stone',12);const wall=s.walls.plan(tile(9,6),'stone');maximum=0;
 for(let i=0;i<300&&wall.state!=='completed';i++){s.construction.update(a,.1);s.move(a);maximum=Math.max(maximum,a.inventory?.quantity??0);assert.ok(5+(a.inventory?.quantity??0)*4<=20);}
 assert.equal(maximum,3);assert.equal(wall.delivered,10);assert.equal(wall.state,'completed');
 assert.equal(box.stored.stone+(a.inventory?.quantity??0),10);
});

 test('knife has90percent accuracy,40damage and diagonal melee range; equip replacement and drop preserve both weapons',()=>{
 const s=scene(()=>.899),a=s.pawn(3,3,'knife'),b=s.pawn(4,4);s.combat.requestAttack(a,b);s.combat.update(a,.99);assert.equal(b.hp,100);s.combat.update(a,.01);assert.equal(b.hp,60);
 assert.equal(inWeaponRange('knife',tile(3,3),tile(5,3)),false);
 const t=scene(()=>.9),c=t.pawn(3,3,'knife'),d=t.pawn(4,4);t.combat.requestAttack(c,d);t.combat.update(c,2.5);assert.equal(d.hp,100);
 const e=scene(),p=e.pawn(2,2,'rifle'),knife={...tile(3,2),type:'knife',quantity:1};e.items.push(knife);e.combat.requestEquip(p,knife);
 for(let i=0;i<30&&p.equipJob;i++){e.move(p);e.combat.update(p,.1)}
 assert.equal(p.weapon,'knife');assert.equal(knife.quantity,0);assert.equal(countItems(e.items).rifle,1);assert.equal(ITEM_APPEARANCE.knife.massKg,2);assert.equal(carryCapacity(p,'wood'),18);
 e.construction.requestDrop(p);e.construction.update(p,.1);assert.equal(p.weapon,'unarmed');assert.equal(countItems(e.items).knife,1);
 });
