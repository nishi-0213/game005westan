import assert from 'node:assert/strict';
import test from 'node:test';
import { Walls } from '../src/walls.ts';
import { advanceMovement, createMovement, setDestination, renderedPosition } from '../src/movement.ts';

function completedBarricades(tiles) {
  const items = new Walls(32);
  for (const tile of tiles) { items.plan(tile, 'wood', 'barricade'); items.complete(tile); }
  return items;
}

test('barricades share the plan lifecycle but permit passage and forbid stopping only when completed', () => {
  const items = new Walls(32);
  for (const [column, material] of [[10,'wood'],[11,'stone']]) {
    const item = items.plan({column,row:10},material,'barricade');
    assert.equal(item.kind,'barricade'); assert.equal(item.material,material);
    assert.equal(items.cannotStop(item),false);
    items.complete(item);
    assert.equal(items.isBlocked(item),false); assert.equal(items.cannotStop(item),true);
    assert.equal(items.plan(item,'stone','wall'),null);
  }
});

test('a pawn can cross consecutive barricades and stop beyond them', () => {
  const items = completedBarricades([{column:16,row:15},{column:17,row:15}]);
  const pawn = createMovement({column:15,row:15});
  assert.equal(setDestination(pawn,{column:19,row:15},items.isBlocked,items.cannotStop),true);
  advanceMovement(pawn,.375,items.isBlocked,items.cannotStop);
  assert.deepEqual(renderedPosition(pawn),{column:16.5,row:15});
  advanceMovement(pawn,2,items.isBlocked,items.cannotStop);
  assert.deepEqual(pawn.tile,{column:19,row:15});
});

test('a completed barricade cannot be a destination; rejected orders keep the current order', () => {
  const items = completedBarricades([{column:16,row:15}]);
  const pawn = createMovement({column:15,row:15});
  assert.equal(setDestination(pawn,{column:18,row:15},items.isBlocked,items.cannotStop),true);
  assert.equal(setDestination(pawn,{column:16,row:15},items.isBlocked,items.cannotStop),false);
  assert.deepEqual(pawn.destination,{column:18,row:15});
});

test('a wall beyond barricades causes a stop before entering the barricades', () => {
  const items = completedBarricades([{column:17,row:15},{column:18,row:15}]);
  items.plan({column:19,row:15},'stone');items.complete({column:19,row:15});
  const pawn = createMovement({column:15,row:15});
  setDestination(pawn,{column:20,row:15},items.isBlocked,items.cannotStop);
  advanceMovement(pawn,5,items.isBlocked,items.cannotStop);
  assert.deepEqual(pawn.tile,{column:16,row:15});
  assert.deepEqual(pawn.destination,pawn.tile);assert.equal(pawn.progress,0);
});

test('diagonal passage preserves continuous movement and stops beyond a barricade', () => {
  const items = completedBarricades([{column:16,row:16}]);
  const pawn = createMovement({column:15,row:15});
  setDestination(pawn,{column:17,row:17},items.isBlocked,items.cannotStop);
  advanceMovement(pawn,Math.SQRT2*1.5/4,items.isBlocked,items.cannotStop);
  assert.deepEqual(renderedPosition(pawn),{column:16.5,row:16.5});
  advanceMovement(pawn,2,items.isBlocked,items.cannotStop);
  assert.deepEqual(pawn.tile,{column:17,row:17});
});

test('retargeting cannot strand a pawn in a barricade corridor', () => {
  const items = completedBarricades([{column:16,row:15},{column:16,row:16}]);
  items.plan({column:16,row:17},'stone');items.complete({column:16,row:17});
  const pawn = createMovement({column:15,row:15});
  setDestination(pawn,{column:18,row:15},items.isBlocked,items.cannotStop);
  advanceMovement(pawn,.125,items.isBlocked,items.cannotStop);
  assert.equal(setDestination(pawn,{column:16,row:18},items.isBlocked,items.cannotStop),false);
  advanceMovement(pawn,2,items.isBlocked,items.cannotStop);
  assert.deepEqual(pawn.tile,{column:18,row:15});
});
