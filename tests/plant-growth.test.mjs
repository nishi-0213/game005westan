import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironment, harvestYield, initialEnvironment } from '../src/environment.ts';
import { PlantGrowth } from '../src/plant-growth.ts';
import { Walls } from '../src/walls.ts';
import { findPath } from '../src/pathfinding.ts';
import { Harvesting } from '../src/harvesting.ts';
import { createMovement } from '../src/movement.ts';

test('initial plants have independently randomized growth and remaining lifetimes while rocks stay fully grown',()=>{
 let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
 const objects=initialEnvironment(32,random),plants=objects.filter(o=>o.type!=='rock');
 assert.ok(plants.every(o=>o.hp>=1&&o.hp<=100&&o.ageSeconds>=0&&o.ageSeconds<180));
 for(const type of ['tree','wildStrawberry']){const group=plants.filter(o=>o.type===type);assert.ok(new Set(group.map(o=>o.hp)).size>5);assert.ok(new Set(group.map(o=>o.ageSeconds)).size>5);}
 assert.ok(objects.filter(o=>o.type==='rock').every(o=>o.hp===100&&o.ageSeconds===undefined));
});

test('plants grow from1 to100HP in exactly60daylight seconds and pause without elapsed time', () => {
  const tree = createEnvironment('tree', { column: 3, row: 3 });
  const berry = createEnvironment('wildStrawberry', { column: 4, row: 4 });
  const rock = createEnvironment('rock', { column: 5, row: 5 });
  const growth = new PlantGrowth([tree, berry, rock], new Walls(8), () => true);
  growth.update(0); assert.equal(tree.hp, 1);
  growth.update(30); assert.equal(tree.hp, 50.5); assert.equal(berry.hp, 50.5); assert.equal(rock.hp, 100);
  growth.update(30); assert.equal(tree.hp, 100); assert.equal(berry.hp, 100);
  growth.update(120); assert.equal(tree.hp, 100); assert.equal(growth.growing.size, 0);
});

test('each minute spawns five times as many trees as berries without overlapping objects, structures or occupied tiles', () => {
  for (const random of [() => 0, () => .999]) {
    const walls = new Walls(8), objects = [createEnvironment('rock', { column: 0, row: 0 })];
    walls.plan({ column: 1, row: 0 }, 'wood');
    const growth = new PlantGrowth(objects, walls, tile => tile.column === 2 && tile.row === 0, () => {}, random);
    growth.update(59.9); assert.equal(objects.length, 1);
    growth.update(.1);
    const count = random() === 0 ? 2 : 3;
    for (const type of ['tree', 'wildStrawberry']) assert.equal(objects.filter(object => object.type === type).length, count * (type === 'tree' ? 5 : 1));
    assert.equal(new Set(objects.map(object => `${object.column},${object.row}`)).size, objects.length);
    for (const object of objects.slice(1)) {
      assert.equal(object.hp, 1);
      assert.ok(object.row !== 0 || object.column > 2);
    }
    growth.update(60);
    for (const object of objects.slice(1, 1 + count * 6)) assert.equal(object.hp, 100);
    assert.equal(objects.length, 1 + count * 12);
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
  assert.equal(object.hp, 50.5);
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
 growth.update(2,17);assert.equal(tree.hp,1+99/60*2);const before=tree.hp;growth.update(24,18);assert.equal(tree.hp,before);assert.equal(berry.hp,before);assert.equal(tree.ageSeconds,26);growth.update(2,6);assert.equal(tree.hp,before+99/60*2);assert.equal(berry.ageSeconds,28);
});
test('long updates split dawn, dusk and spawn boundaries without night growth',()=>{
 const a=createEnvironment('tree',{column:2,row:2}),b={...a},ga=new PlantGrowth([a],new Walls(8),()=>true),gb=new PlantGrowth([b],new Walls(8),()=>true);
 ga.update(100,17);for(let i=0;i<200;i++)gb.update(.5,(17+i*.25)%24);assert.ok(Math.abs(a.hp-b.hp)<1e-9);assert.equal(a.ageSeconds,100);assert.equal(b.ageSeconds,100);
});
test('a plant with little remaining lifetime expires at night without growing',()=>{
 const tree={...createEnvironment('tree',{column:2,row:2}),hp:32,ageSeconds:179},growth=new PlantGrowth([tree],new Walls(8),()=>true);growth.update(1,0);assert.equal(tree.collected,true);assert.equal(tree.hp,32);assert.equal(growth.living.size,0);
});
