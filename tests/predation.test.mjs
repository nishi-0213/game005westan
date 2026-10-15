import test from 'node:test';import assert from 'node:assert/strict';
import {Wildlife,createDeer,createWolf} from '../src/wildlife.ts';import {Combat} from '../src/combat.ts';import {CorpseEating} from '../src/corpse-eating.ts';import {Butchery,corpseItemType} from '../src/butchery.ts';import {Walls} from '../src/walls.ts';import {Construction} from '../src/construction.ts';import {Harvesting} from '../src/harvesting.ts';import {Hauling} from '../src/hauling.ts';import {Storage} from '../src/storage.ts';import {createMovement} from '../src/movement.ts';import {advancePathMovement} from '../src/pathfinding.ts';import {initialNeeds,updateNeeds,killPawn} from '../src/needs.ts';import {countItems,foodNutrition} from '../src/items.ts';
const tile=(column,row)=>({column,row});
function scene(){const walls=new Walls(16),items=[],storage=new Storage(walls),construction=new Construction(walls,items,t=>walls.complete(t)),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,storage),combat=new Combat(construction,harvesting,hauling,()=>0),wildlife=new Wildlife(construction,harvesting,hauling,()=>.5),players=[];
construction.storage=storage;const eating=new CorpseEating(construction,harvesting,hauling,()=>[...players,...wildlife.animals]);wildlife.combat=combat;wildlife.corpseEating=eating;wildlife.players=()=>players;
const human=(column=2,row=3)=>{const p={kind:'human',faction:'player',movement:createMovement(tile(column,row)),mode:'automatic',weapon:'unarmed',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,needs:initialNeeds(),hp:100,eatJob:null};players.push(p);return p};
const move=p=>advancePathMovement(p.movement,.1,16,walls.isBlocked,walls.cannotStop);const feed=p=>{eating.updateClaims();updateNeeds(p,construction,harvesting,hauling,.1,true,eating.automatic);move(p)};
return{walls,items,storage,construction,harvesting,hauling,combat,wildlife,players,eating,human,move,feed};}
test('hungry wolves hunt deer and consume the defeated body for100nutrition in1second',()=>{
const s=scene(),wolf=createWolf(tile(3,3),1),deer=createDeer(tile(4,3),2);s.wildlife.wolves.push(wolf);s.wildlife.deer.push(deer);deer.hp=20;s.wildlife.updateWolf(wolf,.1);assert.equal(wolf.attackJob,undefined);wolf.needs.satiety=20;
for(let i=0;i<100&&!deer.consumed;i++){s.eating.updateClaims();s.wildlife.updateWolf(wolf,.1);s.move(wolf);}assert.equal(deer.dead,true);assert.equal(deer.consumed,true);assert.equal(wolf.needs.satiety,100);assert.equal(countItems(s.items).meat,0);assert.equal(wolf.faction,'wild');
});
test('wolves prefer deer over a closer player and fall back to players when no reachable deer exists',()=>{
const s=scene(),wolf=createWolf(tile(1,3),1),deer=createDeer(tile(6,3),2),human=s.human(2,3);s.wildlife.wolves.push(wolf);s.wildlife.deer.push(deer);wolf.needs.satiety=20;s.wildlife.updateWolf(wolf,0);assert.equal(wolf.attackJob.target,deer);
s.combat.cancel(wolf);wolf.prey=undefined;wolf.decisionSeconds=0;for(let row=0;row<16;row++){const wall=s.walls.plan(tile(4,row),'wood',row===3?'door':'wall');s.walls.complete(wall);}s.wildlife.updateWolf(wolf,0);assert.equal(wolf.attackJob.target,human);
});
test('normal food is used first; only when none is available humans automatically consume a corpse',()=>{
const s=scene(),p=s.human(),body=createDeer(tile(4,3),2);s.wildlife.deer.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);p.needs.satiety=10;const food={...tile(3,3),type:'meat',quantity:10,collect:true};s.items.push(food);s.feed(p);assert.equal(p.eatJob.source.type,'meat');assert.equal(body.corpseEater,undefined);
p.eatJob=null;food.quantity=0;for(let i=0;i<50&&!body.consumed;i++)s.feed(p);assert.equal(body.consumed,true);assert.equal(p.needs.satiety,100);assert.equal(foodNutrition('deerCorpse'),100);
});
test('drafted humans ignore corpses automatically but explicit devouring is available',()=>{
const s=scene(),p=s.human(),body=createDeer(tile(3,3),2);s.wildlife.deer.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);p.mode='drafted';p.needs.satiety=10;s.feed(p);assert.equal(p.eatJob,null);assert.equal(body.consumed,undefined);assert.equal(s.eating.request(p,body),true);
for(let i=0;i<50&&!body.consumed;i++)s.feed(p);assert.equal(body.consumed,true);assert.equal(p.mode,'drafted');assert.equal(p.needs.satiety,100);
});
test('corpse reservations prevent double eating and hauling; cancellation leaves the body intact',()=>{
const s=scene(),a=s.human(),b=s.human(2,4),body=createDeer(tile(4,3),2);s.wildlife.deer.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);body.deadPosition={column:4.3,row:3.2};body.collectCorpse=true;
const butchery=new Butchery(s.construction,s.hauling,()=>s.wildlife.deer,()=>[a,b]);const box=s.walls.plan(tile(6,3),'wood','storage');s.walls.complete(box);assert.equal(s.eating.request(a,body),true);assert.equal(s.eating.canEat(b,body),false);assert.equal(butchery.findStorage(b),null);a.eatJob=null;s.eating.updateClaims();assert.equal(body.consumed,undefined);assert.equal(s.eating.request(b,body),true);
});
test('stored wolf corpses are consumed once and return inventory and equipment instead of meat',()=>{
const s=scene(),p=s.human(),body=createWolf(tile(3,3),2);s.wildlife.wolves.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);body.inventory={type:'wood',quantity:7};body.weapon='rifle';const box=s.walls.plan(tile(5,3),'wood','storage');s.walls.complete(box);s.storage.depositCorpse(box,body,'wolfCorpse');assert.equal(corpseItemType(body),'wolfCorpse');assert.equal(s.eating.request(p,body),true);
for(let i=0;i<60&&!body.consumed;i++)s.feed(p);assert.equal(body.consumed,true);assert.equal(box.stored.wolfCorpse,0);assert.equal(box.storedCorpses.length,0);const counts=countItems(s.items);assert.equal(counts.wood,7);assert.equal(counts.rifle,1);assert.equal(counts.meat,0);
});
test('wolf waves use1to2animals every4minutes independently from deer2to3twice per minute',()=>{
const s=scene(),wolfIds=new Set(),deerIds=new Set(),exiting=new Set();s.wildlife.update(.01);assert.equal(s.wildlife.wolves.length,2);assert.equal(s.wildlife.deer.length,3);
for(let i=0;i<1201;i++){for(const wolf of s.wildlife.wolves)wolf.needs.satiety=100;s.wildlife.update(.1);for(const wolf of s.wildlife.wolves){wolfIds.add(wolf.id);if(wolf.leaving)exiting.add(wolf.id);}for(const deer of s.wildlife.deer)deerIds.add(deer.id);}
assert.equal(wolfIds.size,2);assert.equal(deerIds.size,15);assert.equal(exiting.size,2);
for(let i=0;i<1200;i++){for(const wolf of s.wildlife.wolves)wolf.needs.satiety=100;s.wildlife.update(.1);for(const wolf of s.wildlife.wolves)wolfIds.add(wolf.id);}
assert.equal(wolfIds.size,4);const newWolves=s.wildlife.wolves.filter(wolf=>wolf.id>Math.max(...exiting));assert.equal(newWolves.length,2);assert.ok(newWolves.every(wolf=>!wolf.leaving));
});
test('wolves share starvation/death behavior and stop attacking when told to leave',()=>{
const s=scene(),wolf=createWolf(tile(2,3),1),target=s.human(3,3);s.wildlife.wolves.push(wolf);wolf.needs.satiety=20;s.wildlife.updateWolf(wolf,0);assert.equal(wolf.attackJob.target,target);s.wildlife.markForExit(wolf);assert.equal(wolf.attackJob,null);for(let i=0;i<60&&!wolf.departed;i++){s.wildlife.updateWolf(wolf,.1);s.move(wolf);}assert.equal(wolf.departed,true);
const dying=createWolf(tile(4,4),3);dying.needs.satiety=0;dying.hp=.625;s.wildlife.updateWolf(dying,1);assert.equal(dying.dead,true);assert.equal(dying.hp,0);
});
test('wolves abandon a prey after its route is sealed and select another reachable target',()=>{
const s=scene(),wolf=createWolf(tile(1,3),1),deer=createDeer(tile(6,3),2),human=s.human(2,3);s.wildlife.wolves.push(wolf);s.wildlife.deer.push(deer);wolf.needs.satiety=20;s.wildlife.updateWolf(wolf,0);assert.equal(wolf.attackJob.target,deer);
for(let row=0;row<16;row++)s.walls.complete(s.walls.plan(tile(4,row),'wood'));
s.wildlife.updateWolf(wolf,.3);assert.equal(wolf.attackJob.target,human);assert.equal(wolf.prey,human);
});
test('wolves eat preexisting human and wolf corpses even when their collection flag is off',()=>{
for(const species of ['human','wolf']){const s=scene(),wolf=createWolf(tile(2,3),1),body=species==='human'?s.human(3,3):createWolf(tile(3,3),2);s.wildlife.wolves.push(wolf);if(species==='wolf')s.wildlife.wolves.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);body.collectCorpse=false;wolf.needs.satiety=10;
for(let i=0;i<40&&!body.consumed;i++){s.eating.updateClaims(.1);s.wildlife.updateWolf(wolf,.1);s.move(wolf);}assert.equal(body.consumed,true);assert.equal(wolf.needs.satiety,100);}
});
test('a sealed corpse eating route releases the claim and an alternative corpse can be chosen',()=>{
const s=scene(),p=s.human(1,3),a=createDeer(tile(6,3),1),b=createDeer(tile(2,4),2);s.wildlife.deer.push(a,b);for(const body of [a,b])killPawn(body,s.construction,s.harvesting,s.hauling);p.needs.satiety=10;assert.equal(s.eating.request(p,a,false),true);
for(let row=0;row<16;row++)s.walls.complete(s.walls.plan(tile(4,row),'wood'));s.eating.updateClaims(.3);assert.equal(p.eatJob,null);assert.equal(a.corpseEater,undefined);assert.equal(s.eating.automatic(p),true);assert.equal(b.corpseEater,p);
});
test('death drops equipped weapons nearby once and all attackers trigger a body motion even on misses',()=>{
for(const weapon of ['rifle','knife']){const s=scene(),p=s.human(3,3);p.weapon=weapon;killPawn(p,s.construction,s.harvesting,s.hauling);assert.equal(p.weapon,'unarmed');const item=s.items.find(i=>i.type===weapon);assert.equal(item.quantity,1);assert.ok(Math.max(Math.abs(item.column-3),Math.abs(item.row-3))===1);killPawn(p,s.construction,s.harvesting,s.hauling);assert.equal(countItems(s.items)[weapon],1);}
for(const kind of ['human','wolf']){const s=scene(),p=kind==='human'?s.human(2,3):createWolf(tile(2,3),1),target=s.human(3,3);if(kind==='human'){p.mode='drafted';assert.equal(s.combat.requestAttack(p,target),true);}else assert.equal(s.combat.requestPredation(p,target),true);s.combat.random=()=>1;s.combat.update(p,2.5);assert.equal(p.attackMotionSeconds,.25);assert.equal(target.hp,100);}
});
test('wolves cannot bite diagonally through a sealed wall corner',()=>{
const s=scene(),wolf=createWolf(tile(3,3),1),deer=createDeer(tile(4,4),2);for(const t of [tile(3,4),tile(4,3)])s.walls.complete(s.walls.plan(t,'wood'));assert.equal(s.combat.requestPredation(wolf,deer),true);assert.notDeepEqual(wolf.attackJob.goal,tile(3,3));s.combat.update(wolf,2.5);assert.equal(deer.hp,100);
});
test('deer and wolf diets include reachable ground and stored rations and their species-specific food',()=>{
for(const [kind,type]of [['deer','strawberry'],['deer','ration'],['wolf','meat'],['wolf','ration']])for(const stored of [false,true]){const s=scene(),animal=kind==='deer'?createDeer(tile(2,3),1):createWolf(tile(2,3),1);animal.needs.satiety=10;const source={...tile(3,3),type,quantity:10,collect:false};let box;if(stored){box=s.walls.plan(tile(3,3),'wood','storage');s.walls.complete(box);s.storage.deposit(box,type,10);}else s.items.push(source);for(let i=0;i<50&&animal.needs.satiety<50;i++){if(kind==='deer')s.wildlife.updateDeer(animal,.1);else s.wildlife.updateWolf(animal,.1);s.move(animal);}assert.equal(animal.needs.satiety,100);assert.ok(stored?box.stored[type]<10:source.quantity<10);}
});
test('animals reject food outside their diet and food behind an impassable wall',()=>{
for(const kind of ['deer','wolf']){const s=scene(),animal=kind==='deer'?createDeer(tile(2,3),1):createWolf(tile(2,3),1);animal.needs.satiety=10;const wrong={...tile(3,3),type:kind==='deer'?'meat':'strawberry',quantity:10,collect:true},blocked={...tile(6,3),type:'ration',quantity:10,collect:true};s.items.push(wrong,blocked);for(let r=0;r<16;r++)s.walls.complete(s.walls.plan(tile(4,r),'wood'));for(let i=0;i<20;i++){if(kind==='deer')s.wildlife.updateDeer(animal,.1);else s.wildlife.updateWolf(animal,.1);s.move(animal);}assert.equal(animal.eatJob,null);assert.equal(wrong.quantity,10);assert.equal(blocked.quantity,10);}
});
test('player pawns flee8tiles away from the attacker with the same routing algorithm as deer',()=>{
const s=scene(),human=s.human(8,8);human.mode='drafted';human.inventory={type:'wood',quantity:3};assert.equal(s.wildlife.flee(human,tile(7,8)),true);assert.deepEqual(human.fleeGoal,tile(15,8));assert.equal(human.mode,'drafted');assert.equal(human.inventory.quantity,3);for(let i=0;i<50&&human.movement.tile.column!==15;i++)s.move(human);assert.deepEqual(human.movement.tile,tile(15,8));
});
test('wolf retaliation ignores hunger, pursues an attacker using melee and cannot target buildings',()=>{
const s=scene(),wolf=createWolf(tile(2,3),1),attacker=s.human(5,3);s.wildlife.wolves.push(wolf);assert.equal(wolf.needs.satiety,100);assert.equal(s.combat.requestRetaliation(wolf,attacker),true);assert.equal(wolf.attackJob.retaliation,true);s.items.push({...tile(3,3),type:'ration',quantity:10,collect:true});wolf.needs.satiety=10;for(let i=0;i<70&&attacker.hp===100;i++){s.wildlife.updateWolf(wolf,.1);s.move(wolf);}assert.equal(attacker.hp,60);assert.equal(wolf.eatJob,null);assert.equal(s.items[0].quantity,10);const structure=s.walls.plan(tile(7,7),'wood');s.walls.complete(structure);assert.equal(s.combat.requestRetaliation(wolf,s.combat.structureTarget(structure)),false);
});
test('each wolf attack response uses50percent retaliation or the deer8tile escape, with no food detour',()=>{
for(const [roll,choice]of [[.499,'retaliate'],[.5,'flee']]){const s=scene(),wolf=createWolf(tile(8,8),1),attacker=s.human(7,8);s.wildlife.wolves.push(wolf);assert.equal(wolf.retaliationProbability,.5);s.wildlife.random=()=>roll;assert.equal(s.wildlife.reactToAttack(wolf,attacker),choice);
if(choice==='retaliate'){assert.equal(wolf.attackJob.retaliation,true);assert.equal(wolf.attackJob.target,attacker);assert.equal(wolf.fleeGoal,undefined);}else{assert.equal(wolf.attackJob,null);assert.deepEqual(wolf.fleeGoal,tile(15,8));wolf.needs.satiety=10;s.items.push({...tile(8,9),type:'ration',quantity:10});for(let i=0;i<10;i++){s.wildlife.updateWolf(wolf,.1);s.move(wolf);}assert.equal(wolf.eatJob,null);assert.ok(wolf.fleeGoal);assert.equal(s.items[0].quantity,10);for(let i=0;i<40&&wolf.fleeGoal;i++){s.wildlife.updateWolf(wolf,.1);s.move(wolf);}assert.equal(wolf.fleeGoal,undefined);}
}
});

test('wolves prefer reachable deer over closer meat and rations',()=>{
 const s=scene(),wolf=createWolf(tile(2,3),1),deer=createDeer(tile(8,3),2);
 s.wildlife.wolves.push(wolf);s.wildlife.deer.push(deer);wolf.needs.satiety=10;
 s.items.push({...tile(2,3),type:'ration',quantity:5},{...tile(3,3),type:'meat',quantity:5});
 s.wildlife.updateWolf(wolf,0);assert.equal(wolf.attackJob.target,deer);assert.equal(wolf.eatJob,null);
});

test('wolves prefer reachable meat over closer rations and fall back when meat is unreachable',()=>{
 const s=scene(),wolf=createWolf(tile(2,3),1);wolf.needs.satiety=10;
 const meat={...tile(8,3),type:'meat',quantity:5},ration={...tile(2,3),type:'ration',quantity:5};s.items.push(ration,meat);
 s.wildlife.updateWolf(wolf,0);assert.equal(wolf.eatJob.source,meat);
 wolf.eatJob=null;wolf.decisionSeconds=0;
 for(let row=0;row<16;row++)s.walls.complete(s.walls.plan(tile(5,row),'wood'));
 s.wildlife.updateWolf(wolf,0);assert.equal(wolf.eatJob.source,ration);
});

test('deer prefer grass then berry plants then strawberries then rations regardless of distance',()=>{
 for(const available of [4,3,2,1]){
  const s=scene(),deer=createDeer(tile(2,3),1);deer.needs.satiety=10;
  const grass={...tile(9,3),type:'grass',hp:100,collect:false,collected:false,workSeconds:0};
  const bush={...tile(7,3),type:'wildStrawberry',hp:100,collect:false,collected:false,workSeconds:0};
  const berry={...tile(4,3),type:'strawberry',quantity:5},ration={...tile(2,3),type:'ration',quantity:5};
  s.items.push(ration);if(available>=2)s.items.push(berry);if(available>=3)s.harvesting.objects.push(bush);if(available>=4)s.harvesting.objects.push(grass);
  s.wildlife.updateDeer(deer,0);
  if(available>=3){assert.equal(deer.harvestJob.target,available===4?grass:bush);assert.equal(deer.eatJob,null);}
  else assert.equal(deer.eatJob.source,available===2?berry:ration);
 }
});

test('unreachable grass lets deer select a reachable berry plant',()=>{
 const s=scene(),deer=createDeer(tile(2,3),1);deer.needs.satiety=10;
 const grass={...tile(9,3),type:'grass',hp:100,collect:false,collected:false,workSeconds:0},bush={...tile(3,3),type:'wildStrawberry',hp:100,collect:false,collected:false,workSeconds:0};
 s.harvesting.objects.push(grass,bush);for(let row=0;row<16;row++)s.walls.complete(s.walls.plan(tile(5,row),'wood'));
 s.wildlife.updateDeer(deer,0);assert.equal(deer.harvestJob.target,bush);
});

test('wolves fall back from unreachable deer to stored meat before carried rations',()=>{
 const s=scene(),wolf=createWolf(tile(2,3),1),deer=createDeer(tile(9,3),2);wolf.needs.satiety=10;wolf.inventory={type:'ration',quantity:2};s.wildlife.deer.push(deer);
 for(let row=0;row<16;row++)s.walls.complete(s.walls.plan(tile(5,row),'wood'));
 const box=s.walls.plan(tile(4,3),'wood','storage');s.walls.complete(box);s.storage.deposit(box,'meat',5);
 s.wildlife.updateWolf(wolf,0);assert.ok(!wolf.attackJob);assert.equal(wolf.eatJob.source.type,'meat');assert.equal(wolf.inventory.type,'ration');
});

test('wolves begin hunting at40percent and do not hunt above40',()=>{
 const s=scene(),wolf=createWolf(tile(2,3),1),deer=createDeer(tile(6,3),2);s.wildlife.deer.push(deer);
 wolf.needs.satiety=40.01;s.wildlife.updateWolf(wolf,0);assert.ok(!wolf.attackJob);
 wolf.needs.satiety=40;s.wildlife.updateWolf(wolf,0);assert.equal(wolf.attackJob.target,deer);
});

test('animals begin ordinary food seeking at the new hunger threshold',()=>{
 for(const kind of ['deer','wolf']){
  const s=scene(),animal=kind==='deer'?createDeer(tile(2,3),1):createWolf(tile(2,3),1);
  s.items.push({...tile(2,3),type:'ration',quantity:10});
  const update=()=>kind==='deer'?s.wildlife.updateDeer(animal,0):s.wildlife.updateWolf(animal,0);
  animal.needs.satiety=40.01;update();assert.equal(animal.eatJob,null);
  animal.needs.satiety=kind==='deer'?39.99:40;update();assert.equal(animal.eatJob.source.type,'ration');
 }
});

test('automatic human corpse fallback also starts at40percent',()=>{
 const s=scene(),p=s.human(),body=createDeer(tile(4,3),1);s.wildlife.deer.push(body);killPawn(body,s.construction,s.harvesting,s.hauling);
 p.needs.satiety=40.01;updateNeeds(p,s.construction,s.harvesting,s.hauling,0,true,s.eating.automatic);assert.equal(p.eatJob,null);
 p.needs.satiety=40;updateNeeds(p,s.construction,s.harvesting,s.hauling,0,true,s.eating.automatic);assert.equal(body.corpseEater,p);
});

test('a drafted defender also targets an animal eating a player corpse, and stops after interruption',()=>{
 const s=scene(),defender=s.human(2,3),victim=s.human(5,3),wolf=createWolf(tile(4,3),1);defender.mode='drafted';defender.weapon='rifle';
 killPawn(victim,s.construction,s.harvesting,s.hauling);assert.ok(s.eating.request(wolf,victim));assert.equal(wolf.eatJob.corpse,victim);
 s.combat.update(defender,0,[wolf,victim]);assert.equal(defender.attackJob.target,wolf);assert.equal(defender.attackJob.manual,false);
 wolf.eatJob=null;s.combat.update(defender,0,[wolf,victim]);assert.equal(defender.attackJob,null);
});
