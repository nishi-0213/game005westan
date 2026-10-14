import test from 'node:test';
import assert from 'node:assert/strict';
import {Walls,BUILD_RECIPES} from '../src/walls.ts';
import {createMovement,setRoute} from '../src/movement.ts';
import {findPath,findPaths,commandMove,advancePathMovement,invalidatePaths} from '../src/pathfinding.ts';
const tile=(column,row)=>({column,row});
function scene(){const walls=new Walls(7);for(let row=0;row<7;row++){const wall=walls.plan(tile(3,row),'stone',row===3?'door':'wall');walls.complete(wall)}return walls;}
test('wood15 doors allow only player routes through a wall corridor; removing doors refreshes both faction caches',()=>{
 const walls=scene(),door=walls.at(tile(3,3));assert.equal(door.material,'wood');assert.deepEqual(BUILD_RECIPES.door,{materialCount:15,seconds:1});
 const player=createMovement(tile(1,3));walls.bindMovement(player,'player');assert.ok(findPath(player.tile,tile(5,3),7,walls.isBlocked,walls.cannotStop,player));
 for(const faction of ['enemy1','wild']){const m=createMovement(tile(1,3));walls.bindMovement(m,faction);assert.equal(findPath(m.tile,tile(5,3),7,walls.isBlocked,walls.cannotStop,m),null);assert.equal(findPath(m.tile,tile(3,3),7,walls.isBlocked,walls.cannotStop,m),null);}
 walls.erase(door);const wild=createMovement(tile(1,3));walls.bindMovement(wild,'wild');assert.ok(findPath(wild.tile,tile(5,3),7,walls.isBlocked,walls.cannotStop,wild));
});
test('new doors stop an already issued nonplayer route but remain traversable by players',()=>{
 for(const faction of ['player','enemy1','wild']){const walls=scene(),m=createMovement(tile(2,3));walls.bindMovement(m,faction);setRoute(m,[tile(3,3),tile(4,3)]);advancePathMovement(m,.5,7,walls.isBlocked,walls.cannotStop);assert.equal(m.tile.column,faction==='player'?4:2);}
});
test('environment invalidation refreshes both cached faction policies',()=>{
 const walls=new Walls(7),blockedStops=new Set();walls.environmentCannotStop=t=>blockedStops.has(`${t.column},${t.row}`);
 const m=createMovement(tile(1,1));walls.bindMovement(m,'wild');assert.ok(findPaths(m.tile,7,walls.isBlocked,walls.cannotStop,m).has(16));blockedStops.add('2,2');invalidatePaths(walls.isBlocked);assert.equal(findPaths(m.tile,7,walls.isBlocked,walls.cannotStop,m).has(16),false);
});

test('players can stop on a completed door while enemy and wild pawns cannot',()=>{
const walls=scene();for(const faction of ['player','enemy1','wild']){const m=createMovement(tile(2,3));walls.bindMovement(m,faction);assert.equal(commandMove(m,tile(3,3),7,walls.isBlocked,walls.cannotStop),faction==='player');if(faction==='player'){advancePathMovement(m,1,7,walls.isBlocked,walls.cannotStop);assert.deepEqual(m.tile,tile(3,3));assert.equal(m.nextTile,null);}}
});
