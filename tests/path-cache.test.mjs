import test from 'node:test';
import assert from 'node:assert/strict';
import { findPaths, findPath, invalidatePaths, registerPathCache } from '../src/pathfinding.ts';
import { Walls } from '../src/walls.ts';
import { Harvesting } from '../src/harvesting.ts';
import { createMovement } from '../src/movement.ts';
import { demolishStructure } from '../src/demolition.ts';

test('repeated managed queries reuse the same exploration without rechecking every map tile',()=>{
 let checks=0;const blocked=()=>{checks++;return false;},cannotStop=()=>false;registerPathCache(blocked);const first=findPaths({column:2,row:2},32,blocked,cannotStop),before=checks;for(let i=0;i<100;i++)assert.equal(findPaths({column:2,row:2},32,blocked,cannotStop),first);assert.equal(checks,before);invalidatePaths(blocked);const refreshed=findPaths({column:2,row:2},32,blocked,cannotStop);assert.notEqual(refreshed,first);assert.ok(refreshed.get(3*32+3));assert.ok(checks>before);
});
test('completed walls and demolition invalidate cached routes and recover passage',()=>{
 const walls=new Walls(8),start={column:2,row:2},goal={column:5,row:2};const direct=findPath(start,goal,8,walls.isBlocked,walls.cannotStop);const wall=walls.plan({column:3,row:2},'wood');walls.complete(wall);const detour=findPath(start,goal,8,walls.isBlocked,walls.cannotStop);assert.ok(detour.distance>direct.distance);wall.demolition=true;demolishStructure(walls,[],wall);assert.equal(findPath(start,goal,8,walls.isBlocked,walls.cannotStop).distance,direct.distance);
});
test('harvesting invalidates no-stopping destinations without changing existing traversability',()=>{
 const walls=new Walls(8),node={column:3,row:2,type:'wildStrawberry',collect:true,collected:false,workSeconds:0};walls.environmentCannotStop=t=>!node.collected&&t.column===3&&t.row===2;
 const start={column:2,row:2};assert.equal(findPath(start,node,8,walls.isBlocked,walls.cannotStop),null);const harvesting=new Harvesting([node],[],walls);const worker={movement:createMovement(start),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0};harvesting.update(worker,0);harvesting.update(worker,1);assert.ok(findPath(start,node,8,walls.isBlocked,walls.cannotStop));
});
test('unregistered arbitrary mutable rules still run fresh searches',()=>{let wall=false;const blocked=t=>wall&&t.column===3;const noStop=()=>false;assert.ok(findPath({column:2,row:2},{column:5,row:2},8,blocked,noStop));wall=true;assert.equal(findPath({column:2,row:2},{column:5,row:2},8,blocked,noStop),null);});
