import test from 'node:test';
import assert from 'node:assert/strict';
import { PawnOccupancy, commandGroup } from '../src/pawn-occupancy.ts';
import { createMovement, setRoute, stopAtNextSafeTile, advanceMovement } from '../src/movement.ts';
import { commandMove, advancePathMovement, findPaths, registerPathCache } from '../src/pathfinding.ts';
import { Walls } from '../src/walls.ts';
import { Construction } from '../src/construction.ts';
import { Harvesting } from '../src/harvesting.ts';
import { Hauling } from '../src/hauling.ts';
import { Storage } from '../src/storage.ts';
import { createEnvironment } from '../src/environment.ts';
import { updateWork } from '../src/work-priorities.ts';
import { initialNeeds, requestEat, updateNeeds } from '../src/needs.ts';
import { Wildlife } from '../src/wildlife.ts';

const tile = (column, row) => ({ column, row });
const key = t => `${t.column},${t.row}`;
const open = () => false;
function scene() {
  const walls = new Walls(12), items = [], objects = [], occupancy = new PawnOccupancy();
  walls.environmentCannotStop = t => objects.some(o => !o.collected && key(o) === key(t));
  const storage = new Storage(walls), hauling = new Hauling(items, storage);
  const construction = new Construction(walls, items, t => walls.complete(t));
  construction.storage = storage;
  const harvesting = new Harvesting(objects, items, walls);
  const worker = (column, row) => {
    const pawn = { movement: createMovement(tile(column,row)), mode: 'automatic', inventory: null,
      job: null, retrySeconds: 0, harvestJob: null, harvestRetrySeconds: 0,
      priorities: { construction: 3, harvesting: 3, hauling: 3, free: 3 }, needs: initialNeeds(), eatJob: null };
    occupancy.track(pawn.movement); return pawn;
  };
  const move = (pawn, seconds = .1) => advancePathMovement(pawn.movement, seconds, 12, walls.isBlocked, walls.cannotStop);
  return { walls, items, objects, occupancy, construction, harvesting, hauling, storage, worker, move };
}

test('occupied cells are traversable, but neither current positions nor reserved destinations accept orders', () => {
  const occupancy = new PawnOccupancy(), a = createMovement(tile(1,2)), b = createMovement(tile(3,2));
  occupancy.track(a); occupancy.track(b);
  assert.equal(commandMove(a, b.tile, 8, open, open), false);
  assert.equal(commandMove(a, tile(5,2), 8, open, open), true);
  assert.ok(a.route.some(t => key(t) === key(b.tile)));
  assert.equal(commandMove(b, tile(5,2), 8, open, open), false);
  advancePathMovement(a, 2, 8, open, open);
  assert.deepEqual(a.tile, tile(5,2)); assert.deepEqual(b.tile, tile(3,2));
  assert.equal(occupancy.occupied(tile(1,2)), false);
  occupancy.untrack(b); assert.equal(occupancy.occupied(tile(3,2)), false);
});

test('group movement uses distinct reachable cells near the click; occupied clicks reject the entire order', () => {
  const occupancy = new PawnOccupancy(), moves = [1,2,3].map(row => createMovement(tile(1,row)));
  moves.forEach(m => occupancy.track(m));
  const goals = commandGroup(moves, tile(6,4), 8, open, open, occupancy);
  assert.equal(goals.length, 3); assert.equal(new Set(goals.map(key)).size, 3);
  assert.ok(goals.every(t => Math.hypot(t.column-6,t.row-4) <= 1));
  const before = moves.map(m => ({ ...m.destination }));
  assert.deepEqual(commandGroup(moves, moves[0].tile, 8, open, open, occupancy), []);
  assert.deepEqual(moves.map(m => m.destination), before);
  moves.forEach(m => advancePathMovement(m, 5, 8, open, open));
  assert.equal(new Set(moves.map(m => key(m.tile))).size, 3);
  const unreachable = t => t.column === 4;
  assert.deepEqual(commandGroup([moves[0]], tile(1,6), 8, unreachable, open, occupancy), []);
  assert.deepEqual(moves[0].destination, before[0]);
});

test('cancelling during a crossing continues beyond another pawn instead of stopping on it', () => {
  const occupancy = new PawnOccupancy(), a = createMovement(tile(1,2)), b = createMovement(tile(2,2));
  occupancy.track(a); occupancy.track(b);
  commandMove(a, tile(5,2), 8, open, open); advanceMovement(a, .125);
  stopAtNextSafeTile(a);
  assert.deepEqual(a.destination, tile(3,2));
  advanceMovement(a, 2); assert.deepEqual(a.tile, tile(3,2));
});

test('moving occupancy updates endpoint filters without recomputing cached terrain searches', () => {
  let checks = 0; const blocked = () => { checks++; return false; }; registerPathCache(blocked);
  const occupancy = new PawnOccupancy(), a = createMovement(tile(1,2)), b = createMovement(tile(3,2));
  occupancy.track(a); occupancy.track(b);
  findPaths(a.tile,8,blocked,open).get(2*8+3);
  const paths = findPaths(a.tile, 8, blocked, open, a), before = checks;
  assert.equal(paths.has(2*8+3), false);
  setRoute(b, [tile(4,2)]); advanceMovement(b, 1);
  assert.ok(paths.get(2*8+3)); assert.equal(paths.get(2*8+4), undefined);
  findPaths(a.tile, 8, blocked, open, a); assert.equal(checks, before);
});

test('gathering, construction and roaming workers keep distinct destinations and resting positions', () => {
  const s = scene(), workers = [s.worker(1,2), s.worker(1,3), s.worker(1,4)];
  for (const row of [2,4,6]) s.objects.push({ ...createEnvironment('tree', tile(4,row)), hp: 100, collect: true });
  for (const row of [2,4,6]) { const plan = s.walls.plan(tile(7,row),'wood'); plan.delivered = 10; }
  for (let i=0; i<800; i++) {
    for (const w of workers) {
      updateWork(w, s.construction, s.harvesting, .1, () => .5, .1, s.hauling); s.move(w);
    }
    assert.equal(new Set(workers.map(w => key(w.movement.destination))).size, 3);
    const resting = workers.filter(w => !w.movement.nextTile && key(w.movement.tile) === key(w.movement.destination));
    assert.equal(new Set(resting.map(w => key(w.movement.tile))).size, resting.length);
  }
  assert.ok(s.objects.every(o => o.collected));
  assert.ok([...s.walls.items.values()].every(w => w.state === 'completed'));
});

test('food and hauling use separate approach cells around an occupied resource or storage', () => {
  const s = scene(), a = s.worker(2,2), b = s.worker(4,2);
  const food = { ...tile(4,2), type:'strawberry', quantity:10, collect:true }; s.items.push(food);
  assert.ok(requestEat(a, food, s.construction, s.harvesting, s.hauling));
  assert.notDeepEqual(a.movement.destination, b.movement.tile);
  a.needs.satiety=10;
  for(let i=0;i<40;i++){s.move(a);updateNeeds(a,s.construction,s.harvesting,s.hauling,.1);}
  assert.ok(a.needs.satiety>20);
  const box = s.walls.plan(tile(6,6),'wood','storage'); s.walls.complete(box);
  a.inventory={type:'wood',quantity:10}; b.inventory={type:'wood',quantity:10};
  for(let i=0;i<80;i++)for(const w of [a,b]){s.hauling.update(w);s.move(w);}
  assert.equal(box.stored.wood,20);
  assert.notDeepEqual(a.movement.tile,b.movement.tile);
});

test('deer share human reservations and release occupancy after leaving the map', () => {
  const s=scene(), human=s.worker(0,0), wildlife=new Wildlife(s.construction,s.harvesting,s.hauling,()=>.5);
  wildlife.onSpawn=d=>s.occupancy.track(d.movement); wildlife.onDepart=d=>s.occupancy.untrack(d.movement);
  wildlife.update(.1,t=>s.occupancy.occupied(t));
  assert.equal(wildlife.deer.length,3);
  for(const deer of wildlife.deer){assert.notDeepEqual(deer.movement.tile,human.movement.tile);wildlife.markForExit(deer);}
  const departing=[...wildlife.deer];
  for(let i=0;i<100&&wildlife.deer.length;i++){wildlife.update(.1,t=>s.occupancy.occupied(t));for(const deer of wildlife.deer)s.move(deer);}
  assert.equal(wildlife.deer.length,0);
  for(const deer of departing)assert.equal(s.occupancy.occupied(deer.movement.tile),false);
});

test('a newly stationary occupant diverts an existing destination, while passing pawns do not displace waiting pawns', () => {
  const occupancy=new PawnOccupancy(), a=createMovement(tile(1,2)), b=createMovement(tile(5,2));
  occupancy.track(a);occupancy.track(b);
  commandMove(a,tile(7,2),10,open,open); commandMove(b,tile(8,2),10,open,open);
  // Simulate an interrupted pawn becoming stationary at a previously reserved cell.
  b.tile=tile(7,2); b.destination=tile(7,2); b.nextTile=null;b.route=[];b.changed();
  advancePathMovement(a,5,10,open,open);
  assert.notDeepEqual(a.tile,b.tile);
  const c=createMovement(tile(6,2));occupancy.track(c);
  commandMove(c,tile(9,2),10,open,open);advancePathMovement(c,.25,10,open,open);
  advancePathMovement(b,.1,10,open,open);assert.deepEqual(b.tile,tile(7,2));
});

test('a pawn dying during a crossing returns to the segment source even when another pawn occupies it', () => {
  const s=scene(), a=s.worker(2,2), b=s.worker(3,2);
  commandMove(a.movement,tile(5,2),12,s.walls.isBlocked,s.walls.cannotStop);
  s.move(a,.3);assert.deepEqual(a.movement.tile,b.movement.tile);
  a.needs.satiety=0;a.hp=.025;
  updateNeeds(a,s.construction,s.harvesting,s.hauling,.1);
  assert.equal(a.dead,true);
  assert.deepEqual(a.movement.tile,b.movement.tile);
  assert.deepEqual(a.deadPosition,b.movement.tile);
  assert.equal(a.movement.nextTile,null);
  assert.equal(a.movement.progress,0);
});
