import test from 'node:test';
import assert from 'node:assert/strict';
import {Walls,BUILD_RECIPES} from '../src/walls.ts';
import {Construction} from './helpers/construction.mjs';
import {createMovement,setDestination,advanceMovement,renderedPosition} from '../src/movement.ts';
import {findPath} from '../src/pathfinding.ts';
const tile=(column,row)=>({column,row});
test('floors use one matching material and0.2seconds, have no HP and coexist with structures without occupying their layer',()=>{
 for(const kind of ['stoneFloor','woodFloor']){
  const material=kind==='stoneFloor'?'stone':'wood';
  const walls=new Walls(8),floor=walls.plan(tile(3,2),material==='stone'?'wood':'stone',kind),engine=new Construction(walls,[],target=>walls.complete(target));
  const worker={movement:createMovement(tile(2,2)),mode:'automatic',inventory:{type:material,quantity:1},job:null,retrySeconds:0};
  assert.equal(floor.material,material);assert.equal('hp' in floor,false);assert.deepEqual(BUILD_RECIPES[kind],{materialCount:1,seconds:.2});
  engine.update(worker,.01);engine.update(worker,.01);assert.equal(floor.delivered,1);assert.equal(worker.inventory,null);
  engine.update(worker,.19);assert.equal(floor.state,'planned');engine.update(worker,.01);assert.equal(floor.state,'completed');
  assert.equal(walls.at(tile(3,2)),undefined);assert.equal(walls.isBlocked(floor),false);assert.equal(walls.cannotStop(floor),false);
  assert.ok(findPath(tile(1,2),tile(3,2),8,walls.isBlocked,walls.cannotStop));
  const wall=walls.plan(tile(3,2),'wood');walls.complete(wall);assert.equal(walls.at(floor),floor);assert.equal(walls.at(tile(3,2)),wall);
  walls.erase(floor);assert.equal(walls.at(tile(3,2)),wall);assert.equal(walls.isBlocked(tile(3,2)),true);
 }
});
test('completed floor speeds every faction by1.2 while unfinished floors do not; surface transitions preserve elapsed time',()=>{
 for(const faction of ['player','enemy1','wild']){
  const walls=new Walls(8);for(let column=1;column<=6;column++)walls.complete(walls.plan(tile(column,2),'wood','woodFloor'));
  const m=createMovement(tile(1,2));walls.bindMovement(m,faction);setDestination(m,tile(6,2));advanceMovement(m,.5,walls.isBlocked,walls.cannotStop);assert.ok(Math.abs(renderedPosition(m).column-3.4)<1e-10);
 }
 const walls=new Walls(8),floor=walls.plan(tile(2,2),'wood','stoneFloor'),m=createMovement(tile(1,2));walls.bindMovement(m,'player');setDestination(m,tile(3,2));advanceMovement(m,.125);assert.equal(m.progress,.5);walls.complete(floor);advanceMovement(m,.5/(4*1.2));assert.deepEqual(m.tile,tile(2,2));
});
