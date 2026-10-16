import test from 'node:test';
import assert from 'node:assert/strict';
import { unequipClothing } from '../src/clothing-drop.ts';
import { initialClothing } from '../src/items.ts';
import { createMovement } from '../src/movement.ts';
import { Walls } from '../src/walls.ts';

test('removing multiple clothes uses distinct empty cells, never the pawn cell or an existing stack',()=>{
 const walls=new Walls(8),worker={movement:createMovement({column:3,row:3}),clothing:initialClothing()},items=[{column:3,row:3,type:'wood',quantity:5},{column:2,row:3,type:'hat',quantity:2}];
 for(const slot of ['head','torso','legs'])assert.equal(unequipClothing(worker,slot,items,walls),true);
 assert.deepEqual(worker.clothing,{});assert.equal(items.length,5);assert.equal(items[1].quantity,2);
 assert.equal(new Set(items.map(i=>`${i.column},${i.row}`)).size,5);assert.ok(items.slice(2).every(i=>i.column!==3||i.row!==3));
});
test('no empty reachable cell preserves the clothing and every item',()=>{
 const walls=new Walls(5),worker={movement:createMovement({column:2,row:2}),clothing:initialClothing()},items=[];
 for(let row=0;row<5;row++)for(let column=0;column<5;column++)if(column!==2||row!==2)items.push({column,row,type:'stone',quantity:1});
 const before=structuredClone(items);assert.equal(unequipClothing(worker,'head',items,walls),false);assert.equal(worker.clothing.head,'hat');assert.deepEqual(items,before);
});
test('drops avoid blocked ground and storage zones but allow completed floors',()=>{
 const walls=new Walls(5),worker={movement:createMovement({column:2,row:2}),clothing:initialClothing()},items=[];
 const floor=walls.plan({column:1,row:2},'wood','woodFloor');walls.complete(floor);
 for(let row=0;row<5;row++)for(let column=0;column<5;column++){
  if(column===1&&row===2||column===2&&row===2)continue;
  walls.plan({column,row},'wood','storageArea');
 }
 assert.equal(unequipClothing(worker,'head',items,walls),true);assert.deepEqual(items,[{column:1,row:2,type:'hat',quantity:1}]);
});
