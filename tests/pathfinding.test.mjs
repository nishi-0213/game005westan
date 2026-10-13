import assert from 'node:assert/strict';
import test from 'node:test';
import { commandMove, advancePathMovement } from '../src/pathfinding.ts';
import { createMovement, advanceMovement, renderedPosition } from '../src/movement.ts';
import { Walls } from '../src/walls.ts';

const noBlock=()=>false;
test('manual movement follows a shortest route around walls and reaches the requested tile',()=>{
 const walls=new Walls(8);walls.plan({column:3,row:2},'wood');walls.complete({column:3,row:2});
 const movement=createMovement({column:2,row:2});assert.equal(commandMove(movement,{column:5,row:2},8,walls.isBlocked,walls.cannotStop),true);
 assert.ok(!movement.route.some(t=>t.column===3&&t.row===2));advancePathMovement(movement,5,8,walls.isBlocked,walls.cannotStop);assert.deepEqual(movement.tile,{column:5,row:2});
});
test('trees and rocks can be crossed but cannot be commanded as destinations',()=>{
 const walls=new Walls(8);const objects=[{column:3,row:2},{column:4,row:2}];walls.environmentCannotStop=t=>objects.some(o=>o.column===t.column&&o.row===t.row);
 const movement=createMovement({column:2,row:2});assert.equal(commandMove(movement,{column:3,row:2},8,walls.isBlocked,walls.cannotStop),false);
 assert.equal(commandMove(movement,{column:5,row:2},8,walls.isBlocked,walls.cannotStop),true);
 advancePathMovement(movement,.375,8,walls.isBlocked,walls.cannotStop);assert.deepEqual(renderedPosition(movement),{column:3.5,row:2});
 advancePathMovement(movement,2,8,walls.isBlocked,walls.cannotStop);assert.deepEqual(movement.tile,{column:5,row:2});
});
test('retargeting preserves the active segment and does not jump between tile centers',()=>{
 const movement=createMovement({column:2,row:2});commandMove(movement,{column:5,row:2},8,noBlock,noBlock);advanceMovement(movement,.125);
 const before=renderedPosition(movement);assert.equal(commandMove(movement,{column:3,row:2},8,noBlock,noBlock),true);assert.deepEqual(renderedPosition(movement),before);
 advancePathMovement(movement,1,8,noBlock,noBlock);assert.deepEqual(movement.tile,{column:3,row:2});
});
test('new obstacles cause replanning toward the original target',()=>{
 const walls=new Walls(8);const movement=createMovement({column:2,row:2});commandMove(movement,{column:5,row:2},8,walls.isBlocked,walls.cannotStop);
 walls.plan({column:3,row:2},'wood');walls.complete({column:3,row:2});advancePathMovement(movement,.1,8,walls.isBlocked,walls.cannotStop);
 assert.deepEqual(movement.destination,{column:5,row:2});advancePathMovement(movement,5,8,walls.isBlocked,walls.cannotStop);assert.deepEqual(movement.tile,{column:5,row:2});
});
test('unreachable and invalid destinations leave the current order intact',()=>{
 const walls=new Walls(8);const movement=createMovement({column:2,row:2});commandMove(movement,{column:1,row:2},8,walls.isBlocked,walls.cannotStop);
 for(let r=0;r<8;r++){walls.plan({column:3,row:r},'wood');walls.complete({column:3,row:r});}
 assert.equal(commandMove(movement,{column:5,row:2},8,walls.isBlocked,walls.cannotStop),false);assert.equal(commandMove(movement,{column:-1,row:2},8,walls.isBlocked,walls.cannotStop),false);
 assert.deepEqual(movement.destination,{column:1,row:2});
});
