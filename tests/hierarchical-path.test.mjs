import test from 'node:test';
import assert from 'node:assert/strict';
import {Walls} from '../src/walls.ts';
import {findPath,commandMove,advancePathRequests,advancePathMovement} from '../src/pathfinding.ts';
import {createMovement,stopAtNextSafeTile} from '../src/movement.ts';
import {PawnOccupancy,commandGroup} from '../src/pawn-occupancy.ts';
const tile=(column,row)=>({column,row});
function barrier(){const walls=new Walls(320);for(let row=0;row<320;row++)if(row!==317){const wall=walls.plan(tile(160,row),'wood');walls.complete(wall);}return walls;}
function valid(path,start,blocked){let previous=start;for(const t of path.tiles){assert.ok(!blocked(t));const dx=Math.abs(t.column-previous.column),dy=Math.abs(t.row-previous.row);assert.ok(Math.max(dx,dy)===1);if(dx&&dy){assert.ok(!blocked(tile(t.column,previous.row)));assert.ok(!blocked(tile(previous.column,t.row)));}previous=t;}}

test('hierarchical detours cross the real opening and update after construction, destruction and faction-door changes',()=>{
 const walls=barrier(),start=tile(80,80),goal=tile(240,80);let path=findPath(start,goal,320,walls.isBlocked,walls.cannotStop);assert.ok(path);valid(path,start,walls.isBlocked);assert.ok(path.tiles.some(t=>t.column===160&&t.row===317));
 const door=walls.plan(tile(160,317),'wood','door');walls.complete(door);assert.ok(findPath(start,goal,320,walls.isBlocked,walls.cannotStop));assert.equal(findPath(start,goal,320,walls.nonPlayerBlocked,walls.cannotStop),null);
 walls.setDoorOpenness(door,.1);path=findPath(start,goal,320,walls.nonPlayerBlocked,walls.cannotStop);assert.ok(path);valid(path,start,walls.nonPlayerBlocked);
 walls.setDoorOpenness(door,0);assert.equal(findPath(start,goal,320,walls.nonPlayerBlocked,walls.cannotStop),null);
 walls.erase(walls.at(tile(160,200)));path=findPath(start,goal,320,walls.isBlocked,walls.cannotStop);assert.ok(path.tiles.some(t=>t.column===160&&t.row===200));valid(path,start,walls.isBlocked);
 walls.erase(walls.at(tile(160,80)));path=findPath(start,goal,320,walls.isBlocked,walls.cannotStop);assert.equal(path.distance,160);valid(path,start,walls.isBlocked);
});

test('queued routes obey a shared step budget, reserve distinct goals, restart on edits and cancel on interruption',()=>{
 const walls=barrier(),occupancy=new PawnOccupancy(),a=createMovement(tile(80,80)),b=createMovement(tile(81,80));a.queuedPlanning=b.queuedPlanning=true;occupancy.track(a);occupancy.track(b);
 const goals=commandGroup([a,b],tile(240,80),320,walls.isBlocked,walls.cannotStop,occupancy);assert.equal(goals.length,2);assert.notDeepEqual(goals[0],goals[1]);assert.ok(occupancy.occupied(goals[0]));
 let slice=advancePathRequests(8,Infinity);assert.equal(slice.steps,8);assert.equal(slice.pending,2);assert.deepEqual(a.tile,tile(80,80));
 walls.erase(walls.at(tile(160,80)));
 for(let i=0;i<10000&&(a.pendingRoute||b.pendingRoute);i++){slice=advancePathRequests(32,Infinity);assert.ok(slice.steps<=32);}
 assert.equal(a.pendingRoute,undefined);assert.equal(b.pendingRoute,undefined);assert.deepEqual(a.destination,goals[0]);valid({tiles:a.route},a.tile,walls.isBlocked);
 assert.ok(commandMove(a,tile(200,200),320,walls.isBlocked,walls.cannotStop));stopAtNextSafeTile(a,walls.cannotStop);assert.equal(a.pendingRoute,undefined);advancePathRequests(32,Infinity);assert.notDeepEqual(a.destination,tile(200,200));
 assert.ok(commandMove(a,tile(220,220),320,walls.isBlocked,walls.cannotStop));assert.ok(commandMove(a,tile(210,210),320,walls.isBlocked,walls.cannotStop));for(let i=0;i<10000&&a.pendingRoute;i++){advancePathMovement(a,1/60,320,walls.isBlocked,walls.cannotStop);advancePathRequests(64,Infinity);}assert.deepEqual(a.destination,tile(210,210));assert.equal(advancePathRequests(32,Infinity).pending,0);
 assert.ok(commandMove(a,tile(215,215),320,walls.isBlocked,walls.cannotStop));occupancy.untrack(a);assert.equal(a.pendingRoute,undefined);assert.equal(advancePathRequests(32,Infinity).pending,0);
});
