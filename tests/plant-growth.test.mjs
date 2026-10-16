import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironment, harvestYield, initialEnvironment } from '../src/environment.ts';
import { PlantGrowth } from '../src/plant-growth.ts';
import { Walls } from '../src/walls.ts';
import { findPath } from '../src/pathfinding.ts';
import { Harvesting } from '../src/harvesting.ts';
import { createMovement } from '../src/movement.ts';
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('initial plants have independently randomized growth and remaining lifetimes while rocks stay fully grown',()=>{
 let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
 const objects=initialEnvironment(32,random),plants=objects.filter(o=>o.type!=='rock');
 assert.ok(plants.every(o=>o.hp>=1&&o.hp<=100&&o.ageSeconds>=0&&o.ageSeconds<180));
 for(const type of ['tree','wildStrawberry','grass']){const group=plants.filter(o=>o.type===type);assert.ok(new Set(group.map(o=>o.hp)).size>5);assert.ok(new Set(group.map(o=>o.ageSeconds)).size>5);}
 assert.ok(objects.filter(o=>o.type==='rock').every(o=>o.hp===100&&o.ageSeconds===undefined));
});

test('plants grow from1 to100HP in exactly60daylight seconds and pause without elapsed time', () => {
  const tree = createEnvironment('tree', { column: 3, row: 3 });
  const berry = createEnvironment('wildStrawberry', { column: 4, row: 4 });
  const rock = createEnvironment('rock', { column: 5, row: 5 });
  const growth = new PlantGrowth([tree, berry, rock], new Walls(8), () => true);
  growth.update(0); assert.equal(tree.hp, 1);
  growth.update(30); close(tree.hp, 50.5); close(berry.hp, 50.5); assert.equal(rock.hp, 100);
  growth.update(30); assert.equal(tree.hp, 100); assert.equal(berry.hp, 100);
  growth.update(120); assert.equal(tree.hp, 100); assert.equal(growth.growing.size, 0);
});

test('births are spread throughout each minute with100-150trees,6-9berries and200-300grass', () => {
  for (const random of [() => 0, () => .999]) {
    const walls = new Walls(32), objects = [createEnvironment('rock', { column: 0, row: 0 })];
    walls.plan({ column: 1, row: 0 }, 'wood');
    const growth = new PlantGrowth(objects, walls, tile => tile.column === 2 && tile.row === 0, () => {}, random);
    growth.update(0);assert.equal(objects.length,1);
    growth.update(30);
    const count = random() === 0 ? 2 : 3;
    for(const [type,multiplier] of [['tree',50],['wildStrawberry',3],['grass',100]]) {
      const half=objects.filter(object=>object.type===type).length;
      assert.ok(half>0&&half<count*multiplier);
    }
    growth.update(30);
    for (const [type,multiplier] of [['tree',50],['wildStrawberry',3],['grass',100]]) assert.equal(objects.filter(object => object.type === type).length, count * multiplier);
    assert.equal(new Set(objects.map(object => `${object.column},${object.row}`)).size, objects.length);
    for (const object of objects.slice(1)) {
      assert.ok(object.hp>1&&object.hp<100);
      assert.ok(object.row !== 0 || object.column > 2);
    }
    const firstMinute=objects.slice(1);
    assert.ok(new Set(firstMinute.map(object=>object.hp)).size>100);
    growth.update(60);
    for(const object of firstMinute)assert.equal(object.hp,100);
    assert.equal(objects.length,1+count*306);
  }
});

test('plant birth invalidates cached stopping destinations and full maps skip births safely', () => {
  const walls = new Walls(8), objects = [];
  walls.environmentCannotStop = tile => objects.some(object => !object.collected && object.column === tile.column && object.row === tile.row);
  const from = { column: 3, row: 3 }, goal = { column: 0, row: 0 };
  assert.ok(findPath(from, goal, 8, walls.isBlocked, walls.cannotStop));
  const growth = new PlantGrowth(objects, walls, () => false, () => {}, () => 0);
  growth.update(60);
  assert.equal(findPath(from, goal, 8, walls.isBlocked, walls.cannotStop), null);
  const full = new PlantGrowth([], walls, () => true);
  full.update(180); assert.equal(full.objects.length, 0);
});

test('yield scales withHP and truncates fractions; early harvesting produces the shown amount', () => {
  for (const [type, hp, expected] of [['tree', 1, 0], ['tree', 50, 6], ['tree', 100, 12], ['wildStrawberry', 19, 0], ['wildStrawberry', 20, 1], ['wildStrawberry', 50, 2], ['wildStrawberry', 100, 5]]) {
    const object = { ...createEnvironment(type, { column: 3, row: 2 }), hp, collect: true };
    assert.equal(harvestYield(object), expected);
    const items = [], harvesting = new Harvesting([object], items, new Walls(8));
    const worker = { movement: createMovement({ column: 2, row: 2 }), mode: 'automatic', inventory: null, job: null, retrySeconds: 0, harvestJob: null, harvestRetrySeconds: 0 };
    harvesting.update(worker, 0); harvesting.update(worker, 4);
    assert.equal(object.collected, true);
    assert.equal(items.reduce((sum, item) => sum + item.quantity, 0), expected);
    if (expected > 0) assert.equal(items[0].collect, true);
  }
});

test('harvested plants stop growing', () => {
  const object = createEnvironment('wildStrawberry', { column: 3, row: 2 });
  const walls = new Walls(8), growth = new PlantGrowth([object], walls, () => true);
  growth.update(30);
  assert.equal(harvestYield(object), 2);
  object.collected = true;
  growth.update(30);
  close(object.hp, 50.5);
  assert.equal(growth.growing.size, 0);
});

test('harvest yield uses theHP at completion, including growth during the harvest', () => {
  const object = { ...createEnvironment('wildStrawberry', { column: 3, row: 2 }), collect: true };
  const walls = new Walls(8), items = [], growth = new PlantGrowth([object], walls, () => true);
  const harvesting = new Harvesting([object], items, walls);
  const worker = { movement: createMovement({ column: 2, row: 2 }), mode: 'automatic', inventory: null, job: null, retrySeconds: 0, harvestJob: null, harvestRetrySeconds: 0 };
  growth.update(23.5); assert.equal(harvestYield(object), 1);
  harvesting.update(worker, 0);
  growth.update(1); harvesting.update(worker, 1);
  assert.equal(object.collected, true);
  assert.equal(items[0].quantity, 2);
});

 test('trees and berries expire at180game seconds, rocks remain and new plants have their own lifetime',()=>{
 const tree=createEnvironment('tree',{column:1,row:1}),berry=createEnvironment('wildStrawberry',{column:2,row:1}),rock=createEnvironment('rock',{column:3,row:1});
 const objects=[tree,berry,rock],walls=new Walls(8),growth=new PlantGrowth(objects,walls,()=>false,()=>{},()=>0);
 growth.update(179.9);assert.equal(tree.collected,false);assert.equal(berry.collected,false);
 const newer=objects.find(o=>o!==tree&&o.type==='tree');growth.update(.1);
 assert.equal(tree.collected,true);assert.equal(berry.collected,true);assert.equal(rock.collected,false);assert.equal(newer.collected,false);assert.equal(growth.living.has(tree),false);
 growth.update(60);assert.equal(newer.collected,true);
 });

test('plants stop growing at18and resume at6 while lifespan continues at night',()=>{
 const tree=createEnvironment('tree',{column:2,row:2}),berry=createEnvironment('wildStrawberry',{column:3,row:2}),growth=new PlantGrowth([tree,berry],new Walls(8),()=>true);
 growth.update(2,17);close(tree.hp,1+99/60*2);const before=tree.hp;growth.update(24,18);close(tree.hp,before);close(berry.hp,before);close(tree.ageSeconds,26);growth.update(2,6);close(tree.hp,before+99/60*2);close(berry.ageSeconds,28);
});
test('long updates split dawn, dusk and spawn boundaries without night growth',()=>{
 const a=createEnvironment('tree',{column:2,row:2}),b={...a},ga=new PlantGrowth([a],new Walls(8),()=>true),gb=new PlantGrowth([b],new Walls(8),()=>true);
 ga.update(100,17);for(let i=0;i<200;i++)gb.update(.5,(17+i*.125)%24);assert.ok(Math.abs(a.hp-b.hp)<1e-9);close(a.ageSeconds,100);close(b.ageSeconds,100);
});
test('a plant with little remaining lifetime expires at night without growing',()=>{
 const tree={...createEnvironment('tree',{column:2,row:2}),hp:32,ageSeconds:179},growth=new PlantGrowth([tree],new Walls(8),()=>true);growth.update(1,0);assert.equal(tree.collected,true);assert.equal(tree.hp,32);assert.equal(growth.living.size,0);
});

test('grass shares berry daylight growth and lifetime and cannot be harvested by players',()=>{
 const grass=createEnvironment('grass',{column:3,row:2}),berry=createEnvironment('wildStrawberry',{column:4,row:2});
 const walls=new Walls(8),growth=new PlantGrowth([grass,berry],walls,()=>true);
 growth.update(30,6);assert.equal(grass.hp,berry.hp);growth.update(12,20);assert.equal(grass.hp,berry.hp);
 grass.collect=true;
 const harvesting=new Harvesting([grass],[],walls),worker={movement:createMovement({column:2,row:2}),mode:'automatic',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0};
 harvesting.update(worker,10);assert.equal(worker.harvestJob,null);assert.equal(grass.collected,false);
 growth.update(138);assert.equal(grass.collected,true);assert.equal(berry.collected,true);
});

test('neither planned nor completed floors allow plants to spawn',()=>{
 for(const kind of ['stoneFloor','woodFloor'])for(const completed of [false,true]){
  const walls=new Walls(8),objects=[];
  for(let row=0;row<8;row++)for(let column=0;column<8;column++){const floor=walls.plan({column,row},'wood',kind);if(completed)walls.complete(floor);}
  new PlantGrowth(objects,walls,()=>false).update(120);assert.equal(objects.length,0);
 }
});

test('laying either floor over existing grass removes it and prevents regrowth',()=>{
 for(const kind of ['woodFloor','stoneFloor']){
  const walls=new Walls(8),grass=createEnvironment('grass',{column:3,row:3}),objects=[grass];
  const growth=new PlantGrowth(objects,walls,()=>false,()=>{},()=>0);
  const floor=walls.plan(grass,'wood',kind);walls.complete(floor);
  growth.update(.1);assert.equal(grass.collected,true);assert.equal(growth.living.has(grass),false);assert.equal(growth.growing.has(grass),false);
  growth.update(180);
  assert.ok(objects.every(object=>object.collected||object.column!==3||object.row!==3));
 }
});

test('each initial plant species covers young, middle and mature stages in shuffled spatial order',()=>{
 for(const initialSeed of [17,42,99]){
  let seed=initialSeed;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const objects=initialEnvironment(32,random);
  for(const type of ['tree','wildStrawberry','grass']){
   const plants=objects.filter(object=>object.type===type);
   assert.ok(plants.some(object=>object.hp<15));assert.ok(plants.some(object=>object.hp>85));assert.ok(plants.some(object=>object.hp>=40&&object.hp<=60));
   assert.ok(plants.some((object,index)=>index>0&&object.hp<plants[index-1].hp));
  }
 }
});

test('randomized individual births are independent across species and large updates preserve their ages',()=>{
 const make=()=>{
  let seed=123;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const objects=[],growth=new PlantGrowth(objects,new Walls(32),()=>false,()=>{},random);return {objects,growth};
 };
 const large=make(),small=make();large.growth.update(60);for(let i=0;i<600;i++)small.growth.update(.1);
 assert.equal(large.objects.length,small.objects.length);
 for(let i=0;i<large.objects.length;i++){
  const a=large.objects[i],b=small.objects[i];assert.equal(a.type,b.type);assert.equal(a.column,b.column);assert.equal(a.row,b.row);close(a.hp,b.hp);close(a.ageSeconds??0,b.ageSeconds??0);
 }
 assert.equal(new Set(large.objects.map(object=>(object.ageSeconds??0).toFixed(6))).size,large.objects.length);
 for(const type of ['tree','wildStrawberry','grass']){
  const plants=large.objects.filter(object=>object.type===type);
  assert.ok(plants.some(object=>object.ageSeconds<20));assert.ok(plants.some(object=>object.ageSeconds>40));
 }
});

test('sparse128x128 maps spawn plants without checking every tile',()=>{
 const walls=new Walls(128),objects=[];let checks=0;
 const growth=new PlantGrowth(objects,walls,()=>{checks++;return false;},()=>{},()=>.999);
 growth.update(.3);assert.equal(objects.length,1);assert.ok(checks<32,`${checks} occupancy checks for one birth`);
 assert.equal(objects[0].column,111);assert.equal(objects[0].row,127);
});
