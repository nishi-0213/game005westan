import test from 'node:test';
import assert from 'node:assert/strict';
import {constructionHasClearance} from '../src/construction-clearance.ts';
import {Walls,BUILD_RECIPES} from '../src/walls.ts';
import {createMovement,advanceMovement,movementHasSafeExit} from '../src/movement.ts';
import {Construction} from './helpers/construction.mjs';
const tile=(column,row)=>({column,row});
const actor=(column,row)=>({movement:createMovement(tile(column,row)),faction:'player',mode:'automatic',inventory:null,job:null,retrySeconds:0});
for(const manual of [false,true])test(`${manual?'manual':'automatic'} construction completes while another pawn sleeps inside a blocked bed cell`,()=>{
 const walls=new Walls(12),bed=walls.plan(tile(2,2),'wood','bed');walls.complete(bed);
 const sleeper=actor(2,2);sleeper.sleep={phase:'sleeping',bed,goal:tile(1,2)};
 assert.equal(movementHasSafeExit(sleeper.movement,walls.isBlocked,walls.cannotStop),false);
 const worker=actor(6,7),target=walls.plan(tile(7,7),'wood','wall');target.delivered=2;
 const actors=[sleeper,worker],engine=new Construction(walls,[],plan=>constructionHasClearance(walls,plan,actors)&&walls.complete(plan));
 if(manual)assert.equal(engine.request(worker,target),true);
 for(let i=0;i<40&&target.state==='planned';i++){engine.update(worker,.1);advanceMovement(worker.movement,.1,walls.isBlocked,walls.cannotStop);}
 assert.equal(target.state,'completed');assert.equal(worker.job,null);assert.equal(engine.claims.size,0);assert.equal(sleeper.sleep.phase,'sleeping');
});
test('a distant corpse on a barricade does not prevent unrelated construction; a body on the plan still blocks it',()=>{
 const walls=new Walls(12),barricade=walls.plan(tile(2,2),'wood','barricade');walls.complete(barricade);
 const corpse={...actor(2,2),dead:true},plan=walls.plan(tile(7,7),'wood');
 assert.equal(constructionHasClearance(walls,plan,[corpse]),true);
 corpse.movement=createMovement(plan);assert.equal(constructionHasClearance(walls,plan,[corpse]),false);
 corpse.corpseStorage={};assert.equal(constructionHasClearance(walls,plan,[corpse]),true);
});
test('construction still protects living actors, destinations, and the corners of active diagonal steps',()=>{
 for(const kind of ['wall','bed','butcher','door','barricade']){
  const walls=new Walls(12),plan=walls.plan(tile(7,7),'wood',kind),pawn=actor(7,7);
  assert.equal(constructionHasClearance(walls,plan,[pawn]),false);
  pawn.movement=createMovement(tile(5,7));pawn.movement.destination=tile(7,7);assert.equal(constructionHasClearance(walls,plan,[pawn]),false);
 }
 const walls=new Walls(12),plan=walls.plan(tile(7,7),'wood'),walker=actor(6,7);walker.movement.nextTile=tile(7,8);walker.movement.destination=tile(7,8);walker.movement.progress=.5;
 assert.equal(constructionHasClearance(walls,plan,[walker]),false);
 walker.movement=createMovement(tile(6,8));assert.equal(constructionHasClearance(walls,plan,[walker]),true);
});
test('an animal crossing a barricade cannot lose its safe exit to a newly built door',()=>{
 const walls=new Walls(12),barricade=walls.plan(tile(2,2),'wood','barricade');walls.complete(barricade);
 const plan=walls.plan(tile(3,2),'wood','door'),animal=actor(2,2);animal.faction='wildlife';animal.movement.route=[tile(3,2),tile(4,2)];animal.movement.destination=tile(4,2);
 assert.equal(movementHasSafeExit(animal.movement,walls.nonPlayerBlocked,walls.cannotStop),true);
 assert.equal(constructionHasClearance(walls,plan,[animal]),false);
});
