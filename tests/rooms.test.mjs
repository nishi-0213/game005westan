import test from 'node:test';
import assert from 'node:assert/strict';
import {Walls} from '../src/walls.ts';
import {findPath} from '../src/pathfinding.ts';
import {destroyStructure} from '../src/demolition.ts';
const tile=(column,row)=>({column,row});
function ring(){const walls=new Walls(10);let door;for(let row=2;row<=6;row++)for(let column=2;column<=6;column++)if(row===2||row===6||column===2||column===6){const item=walls.plan(tile(column,row),'wood',column===4&&row===2?'door':'wall');walls.complete(item);if(item.kind==='door')door=item;}return{walls,door};}

test('closed rooms have area and outdoor status; opening a door changes faction access without merging rooms',()=>{
 const {walls,door}=ring(),inside=tile(4,4),outside=tile(4,0);const room=walls.rooms.roomAt(inside);assert.equal(room.area,9);assert.equal(room.outdoors,false);assert.equal(walls.rooms.roomAt(outside).outdoors,true);
 const generation=walls.rooms.generation;assert.equal(walls.rooms.doors.length,1);assert.equal(walls.rooms.doors[0].roomIds.length,2);
 assert.ok(findPath(outside,inside,10,walls.isBlocked,walls.cannotStop));assert.equal(findPath(outside,inside,10,walls.nonPlayerBlocked,walls.cannotStop),null);
 walls.setDoorOpenness(door,.01);assert.ok(findPath(outside,inside,10,walls.nonPlayerBlocked,walls.cannotStop));assert.equal(walls.rooms.roomAt(inside),room);assert.equal(walls.rooms.generation,generation);
 walls.setDoorOpenness(door,0);assert.equal(findPath(outside,inside,10,walls.nonPlayerBlocked,walls.cannotStop),null);
});

test('wall destruction merges rooms; planning does not change geometry and completed walls split it again',()=>{
 const {walls}=ring(),inside=tile(4,4),hole=tile(2,4);assert.equal(walls.rooms.roomAt(inside).outdoors,false);const generation=walls.rooms.generation;
 const plan=walls.plan(tile(8,8),'wood');walls.removePlan(plan);assert.equal(walls.rooms.roomAt(inside).outdoors,false);assert.equal(walls.rooms.generation,generation);
 destroyStructure(walls,[],hole);assert.equal(walls.rooms.roomAt(inside).outdoors,true);const replacement=walls.plan(hole,'wood');assert.equal(walls.rooms.roomAt(inside).outdoors,true);walls.complete(replacement);assert.equal(walls.rooms.roomAt(inside).outdoors,false);
});

test('furniture can divide movement inside one room; erasing it restores reachability',()=>{
 const walls=new Walls(5);for(let row=0;row<5;row++)if(row!==2){const wall=walls.plan(tile(2,row),'wood');walls.complete(wall);}
 const left=tile(0,2),right=tile(4,2),room=walls.rooms.roomAt(left);assert.equal(walls.rooms.roomAt(right).id,room.id);
 const table=walls.plan(tile(2,2),'wood','table');walls.complete(table);assert.equal(walls.rooms.roomAt(right),room);assert.equal(findPath(left,right,5,walls.isBlocked,walls.cannotStop),null);
 destroyStructure(walls,[],table);assert.ok(findPath(left,right,5,walls.isBlocked,walls.cannotStop));
});
