import test from 'node:test';
import assert from 'node:assert/strict';
import { Wildlife, createDeer, deerAction } from '../src/wildlife.ts';
import { FACTIONS, isPlayerControlled } from '../src/factions.ts';
import { Walls } from '../src/walls.ts';
import { Storage } from '../src/storage.ts';
import { Construction } from '../src/construction.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Hauling } from '../src/hauling.ts';
import { createEnvironment } from '../src/environment.ts';
import { advancePathMovement } from '../src/pathfinding.ts';
import { updateRoaming } from '../src/roaming.ts';
import { createMovement } from '../src/movement.ts';
import { demolishStructure } from '../src/demolition.ts';

function scene() {
  const walls = new Walls(8), items = [], objects = [];
  walls.environmentCannotStop = tile => objects.some(object => !object.collected && object.column === tile.column && object.row === tile.row);
  const construction = new Construction(walls, items, tile => walls.complete(tile));
  const harvesting = new Harvesting(objects, items, walls), hauling = new Hauling(items, new Storage(walls));
  const wildlife = new Wildlife(construction, harvesting, hauling, () => .5);
  const deer = createDeer({ column: 2, row: 3 }, 1);
  const move = seconds => advancePathMovement(deer.movement, seconds, walls.mapSize, walls.isBlocked, walls.cannotStop);
  const tick = seconds => { wildlife.updateDeer(deer, seconds); if (!deer.dead && !deer.departed) move(seconds); };
  const berry = (hp = 100) => {
    const object = { ...createEnvironment('wildStrawberry', { column: 3, row: 3 }), hp };
    objects.push(object); return object;
  };
  return { walls, items, objects, construction, harvesting, hauling, wildlife, deer, tick, berry };
}

test('three factions exist and wild deer cannot be player controlled', () => {
  assert.deepEqual(Object.values(FACTIONS), ['プレイヤー', '敵１', '野生']);
  assert.equal(isPlayerControlled({ faction: 'player' }), true);
  assert.equal(isPlayerControlled({ faction: 'enemy1' }), false);
  assert.equal(isPlayerControlled(createDeer({ column: 0, row: 0 }, 1)), false);
});

test('deer and humans share the same five-second nearby roaming behavior', () => {
  const s = scene(), human = { movement: createMovement(s.deer.movement.tile) };
  s.wildlife.updateDeer(s.deer, 4.9); updateRoaming(human, s.walls, 4.9, () => .5);
  assert.deepEqual(s.deer.movement.destination, { column: 2, row: 3 });
  s.wildlife.updateDeer(s.deer, .2); updateRoaming(human, s.walls, .2, () => .5);
  assert.deepEqual(s.deer.movement.route, human.movement.route);
  assert.notDeepEqual(s.deer.movement.destination, s.deer.movement.tile);
});

test('below40satiety deer harvest unmarked berries and eat them in place for one second', () => {
  const s = scene(), berry = s.berry();
  s.deer.needs.satiety = 40; s.tick(0); assert.equal(s.deer.harvestJob, null);
  s.deer.needs.satiety = 39; s.tick(0);
  assert.equal(s.deer.harvestJob.target, berry); assert.equal(berry.collect, false);
  s.tick(.9); assert.equal(berry.collected, false);
  s.tick(.1); assert.equal(berry.collected, true); assert.equal(s.deer.inventory.quantity, 5);
  const tile = { ...s.deer.movement.tile };
  s.tick(.9); assert.equal(deerAction(s.deer), '食事中'); assert.equal(s.deer.inventory.quantity, 5);
  s.tick(.1); assert.equal(s.deer.needs.satiety, 88); assert.equal(s.deer.inventory, null);
  assert.deepEqual(s.deer.movement.tile, tile);
  assert.equal(s.items.reduce((sum, item) => sum + item.quantity, 0), 0);
});

test('deer consume only their proportional harvest and ignore plants with zero yield', () => {
  const s = scene(), berry = s.berry(1);
  s.deer.needs.satiety = 19; s.tick(0); assert.equal(s.deer.harvestJob, null);
  berry.hp = 40;
  s.tick(.25); s.tick(.75);
  assert.equal(s.deer.inventory.quantity, 2);
  s.tick(1); assert.equal(s.deer.inventory, null);
  assert.equal(s.deer.needs.satiety, 38);
});

test('human and deer harvesting claims are exclusive; deer now eat reachable ground berries', () => {
  const s = scene(), berry = s.berry(); berry.collect = true;
  const human = createDeer({ column: 2, row: 3 }, 2);
  s.harvesting.update(human, 0);
  s.deer.needs.satiety = 19; s.tick(0);
  assert.equal(s.deer.harvestJob, null);
  s.harvesting.cancel(human); berry.collected = true;
  s.items.push({ column: 2, row: 3, type: 'strawberry', quantity: 5, collect: true });
  s.tick(0);assert.ok(s.deer.eatJob);s.tick(1);assert.equal(s.items[0].quantity,0);assert.equal(s.deer.eatJob,null);assert.equal(s.deer.needs.satiety,68.5);
});

test('departure cancels work and follows the shortest path to the closest map edge then outside', () => {
  const s = scene(); s.berry(); s.deer.needs.satiety = 19; s.tick(0);
  assert.ok(s.deer.harvestJob);
  s.wildlife.markForExit(s.deer); s.tick(0);
  assert.equal(s.deer.harvestJob, null); assert.equal(s.harvesting.claims.size, 0);
  assert.deepEqual(s.deer.exitGoal, { column: 0, row: 3 });
  assert.deepEqual(s.deer.movement.route, [{ column: 1, row: 3 }, { column: 0, row: 3 }]);
  for (let i = 0; i < 30 && !s.deer.departed; i++) s.tick(.1);
  assert.equal(s.deer.departed, true); assert.equal(s.deer.movement.tile.column, -1);
});

test('deer cannot exit through an enclosure and retry once an edge becomes reachable', () => {
  const s = scene();
  for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) if (!row || !column || row === 7 || column === 7) {
    const wall = s.walls.plan({ column, row }, 'wood'); s.walls.complete(wall);
  }
  s.wildlife.markForExit(s.deer);
  for (let i = 0; i < 10; i++) s.tick(.1);
  assert.equal(s.deer.departed, false); assert.equal(s.deer.exitGoal, undefined);
  s.walls.items.get('0,3').demolition = true;
  demolishStructure(s.walls, s.items, { column: 0, row: 3 });
  for (let i = 0; i < 30 && !s.deer.departed; i++) s.tick(.1);
  assert.equal(s.deer.departed, true);
});

test('starvation and death release a deer harvest claim and prevent further actions', () => {
  const s = scene(); s.berry(); s.deer.needs.satiety = 19; s.tick(0);
  s.deer.needs.satiety = 0; s.deer.hp = .3125; s.deer.bodyHp.torso=.3125; s.tick(1);
  assert.equal(s.deer.dead, true); assert.equal(deerAction(s.deer), '死亡');
  assert.equal(s.harvesting.claims.size, 0);
  const tile = { ...s.deer.movement.tile }; s.tick(100); assert.deepEqual(s.deer.movement.tile, tile);
});

test('random waves spawn2to3deer once per minute and mark2to3for departure around one minute', () => {
  const s = scene();
  s.wildlife.update(0); assert.equal(s.wildlife.deer.length, 0);
  s.wildlife.update(.01, tile => tile.row === 0);
  assert.equal(s.wildlife.deer.length, 3);
  for (const deer of s.wildlife.deer) {
    const { column, row } = deer.movement.tile;
    assert.ok(column === 0 || column === 7 || row === 7); assert.notEqual(row, 0);
  }
  const ids = new Set(s.wildlife.deer.map(deer => deer.id)), exiting = new Set();
  for (let i = 0; i < 601; i++) {
    s.wildlife.update(.1);
    for (const deer of s.wildlife.deer) {
      ids.add(deer.id); if (deer.leaving) exiting.add(deer.id);
      advancePathMovement(deer.movement, .1, 8, s.walls.isBlocked, s.walls.cannotStop);
    }
  }
  assert.equal(ids.size, 6); assert.equal(exiting.size, 3);
});

test('deer graze grass at any growth stage for five nutrition without dropping items',()=>{
 for(const hp of [1,50,100]){
  const s=scene(),grass={...createEnvironment('grass',{column:3,row:3}),hp};s.objects.push(grass);
  s.deer.needs.satiety=19;s.tick(0);assert.equal(s.deer.harvestJob.target,grass);
  s.tick(.9);assert.equal(grass.collected,false);s.tick(.1);
  assert.equal(grass.collected,true);assert.equal(s.deer.needs.satiety,23.5);assert.equal(s.deer.inventory,null);assert.equal(s.items.length,0);
 }
});
