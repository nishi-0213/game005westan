import test from 'node:test';
import assert from 'node:assert/strict';
import {findPath,findPaths,findNearest,registerPathCache} from '../src/pathfinding.ts';
import {Walls} from '../src/walls.ts';

test('320-square near goals stop early; incremental searches resume and keep shortest paths',()=>{
 let checks=0;const open=()=>{checks++;return false;},noStop=()=>false,start={column:160,row:160};
 const path=findPath(start,{column:163,row:162},320,open,noStop);assert.ok(Math.abs(path.distance-(1+2*Math.SQRT2))<1e-9);assert.ok(checks<500);
 checks=0;const nearest=findNearest(start,320,open,noStop,[{target:'far',goal:{column:0,row:0}},{target:'near',goal:{column:161,row:160}}]);assert.equal(nearest.target,'near');assert.equal(nearest.path.distance,1);assert.ok(checks<500);
 registerPathCache(open);const paths=findPaths(start,320,open,noStop);assert.equal(paths.get(160*320+161).distance,1);assert.ok(paths.get(162*320+163));assert.equal(findPaths(start,320,open,noStop),paths);
 const iterator=paths.entries();assert.equal(iterator.next().value[1].distance,0);assert.equal(iterator.next().value[1].distance,1);
});

test('failed A-star routes are reused, then invalidated when a barrier opens; occupancy is not cached as terrain failure',()=>{
 const walls=new Walls(12);for(let row=0;row<12;row++){const wall=walls.plan({column:6,row},'wood');walls.complete(wall);}
 let checks=0;const blocked=tile=>{checks++;return walls.isBlocked(tile);};registerPathCache(blocked,walls.isBlocked);
 const start={column:2,row:2},goal={column:8,row:2};assert.equal(findPath(start,goal,12,blocked,walls.cannotStop),null);checks=0;assert.equal(findPath(start,goal,12,blocked,walls.cannotStop),null);assert.ok(checks<5);
 const otherStart={column:3,row:3};assert.equal(findPaths(otherStart,12,blocked,walls.cannotStop).get(goal.row*12+goal.column),undefined);
 for(let i=0;i<17;i++)findPaths({column:i%12,row:Math.floor(i/12)},12,blocked,walls.cannotStop);
 checks=0;assert.equal(findPaths(otherStart,12,blocked,walls.cannotStop).get(goal.row*12+goal.column),undefined);assert.ok(checks<5);
 walls.erase(walls.at({column:6,row:2}));assert.ok(findPath(start,goal,12,blocked,walls.cannotStop));
 const movement={stopBlocked:()=>true};assert.equal(findPath(start,goal,12,blocked,walls.cannotStop,movement),null);movement.stopBlocked=()=>false;assert.ok(findPath(start,goal,12,blocked,walls.cannotStop,movement));
});
