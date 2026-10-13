import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceMovement, createMovement, renderedPosition, setDestination, stopAtNextSafeTile } from '../src/movement.ts';

test('idle coordinates stay on a tile center', () => {
  const state = createMovement({ column: 15, row: 15 });
  advanceMovement(state, 10);
  assert.deepEqual(renderedPosition(state), { column: 15, row: 15 });
  assert.equal(state.nextTile, null);
});

test('stopping cancels a pending order when the pawn is still at a safe tile', () => {
  const state = createMovement({ column: 15, row: 15 });
  setDestination(state, { column: 20, row: 15 });
  stopAtNextSafeTile(state);
  advanceMovement(state, 5);
  assert.deepEqual(state.tile, { column: 15, row: 15 });
});

test('stopping during movement finishes the active segment without teleporting', () => {
  const state = createMovement({ column: 15, row: 15 });
  setDestination(state, { column: 20, row: 15 });
  advanceMovement(state, 0.125);
  const before = renderedPosition(state);
  stopAtNextSafeTile(state);
  assert.deepEqual(renderedPosition(state), before);
  advanceMovement(state, 5);
  assert.deepEqual(state.tile, { column: 16, row: 15 });
  assert.equal(state.progress, 0);
});

test('stopping while entering barricades continues through to the first safe tile', () => {
  const state = createMovement({ column: 15, row: 15 });
  const cannotStop = ({ column, row }) => row === 15 && (column === 16 || column === 17);
  setDestination(state, { column: 20, row: 15 });
  advanceMovement(state, 0.125, undefined, cannotStop);
  stopAtNextSafeTile(state, cannotStop);
  assert.deepEqual(state.destination, { column: 18, row: 15 });
  advanceMovement(state, 5, undefined, cannotStop);
  assert.deepEqual(state.tile, { column: 18, row: 15 });
});

test('rendering interpolates while logical position remains an integer tile', () => {
  const state = createMovement({ column: 15, row: 15 });
  setDestination(state, { column: 17, row: 15 });
  advanceMovement(state, 0.125);
  assert.deepEqual(state.tile, { column: 15, row: 15 });
  assert.deepEqual(renderedPosition(state), { column: 15.5, row: 15 });
  advanceMovement(state, 0.125);
  assert.deepEqual(state.tile, { column: 16, row: 15 });
  assert.deepEqual(renderedPosition(state), state.tile);
});

test('a turn passes through the tile center and arrival has no residual offset', () => {
  const state = createMovement({ column: 15, row: 15 });
  setDestination(state, { column: 17, row: 16 });
  advanceMovement(state, Math.SQRT2 / 4);
  assert.deepEqual(renderedPosition(state), { column: 16, row: 16 });
  advanceMovement(state, 0.125);
  assert.deepEqual(renderedPosition(state), { column: 16.5, row: 16 });
  advanceMovement(state, 2);
  assert.deepEqual(state.tile, { column: 17, row: 16 });
  assert.equal(state.progress, 0);
  assert.equal(state.nextTile, null);
});

test('retargeting during movement does not jump or cut across a corner', () => {
  const state = createMovement({ column: 15, row: 15 });
  setDestination(state, { column: 18, row: 15 });
  advanceMovement(state, 0.125);
  const before = renderedPosition(state);
  setDestination(state, { column: 15, row: 17 });
  assert.deepEqual(renderedPosition(state), before);
  advanceMovement(state, 0.125);
  assert.deepEqual(state.tile, { column: 16, row: 15 });
  advanceMovement(state, Math.SQRT2 / 8);
  assert.deepEqual(renderedPosition(state), { column: 15.5, row: 15.5 });
  advanceMovement(state, 5);
  assert.deepEqual(state.tile, { column: 15, row: 17 });
});

test('variable frame durations produce the same movement', () => {
  const first = createMovement({ column: 15, row: 15 });
  const second = createMovement({ column: 15, row: 15 });
  for (const state of [first, second]) setDestination(state, { column: 0, row: 0 });
  advanceMovement(first, 0.375);
  for (let index = 0; index < 3; index++) advanceMovement(second, 0.125);
  assert.deepEqual(first.tile, second.tile);
  assert.ok(Math.abs(first.progress - second.progress) < 1e-12);
  advanceMovement(first, 100);
  assert.deepEqual(first.tile, { column: 0, row: 0 });
});

test('diagonal movement interpolates both axes at the same physical speed', () => {
  const state = createMovement({ column: 15, row: 15 });
  setDestination(state, { column: 16, row: 16 });
  advanceMovement(state, Math.SQRT2 / 8);
  assert.deepEqual(state.tile, { column: 15, row: 15 });
  assert.deepEqual(renderedPosition(state), { column: 15.5, row: 15.5 });
  advanceMovement(state, Math.SQRT2 / 8);
  assert.deepEqual(state.tile, { column: 16, row: 16 });
  assert.equal(state.progress, 0);
});

test('diagonal routes reach destinations in all four directions', () => {
  for (const column of [12, 18]) {
    for (const row of [12, 18]) {
      const state = createMovement({ column: 15, row: 15 });
      setDestination(state, { column, row });
      advanceMovement(state, 20);
      assert.deepEqual(state.tile, { column, row });
      assert.deepEqual(renderedPosition(state), state.tile);
      assert.equal(state.nextTile, null);
    }
  }
});
