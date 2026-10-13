import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceMovement, createMovement, renderedPosition, setDestination } from '../src/movement.ts';

test('idle coordinates stay on a tile center', () => {
  const state = createMovement({ column: 15, row: 15 });
  advanceMovement(state, 10);
  assert.deepEqual(renderedPosition(state), { column: 15, row: 15 });
  assert.equal(state.nextTile, null);
});

test('rendering interpolates while logical position remains an integer tile', () => {
  const state = createMovement({ column: 15, row: 15 });
  setDestination(state, { column: 17, row: 16 });
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
  advanceMovement(state, 0.5);
  assert.deepEqual(renderedPosition(state), { column: 17, row: 15 });
  advanceMovement(state, 0.125);
  assert.deepEqual(renderedPosition(state), { column: 17, row: 15.5 });
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
  advanceMovement(state, 0.125);
  assert.deepEqual(renderedPosition(state), { column: 15.5, row: 15 });
  advanceMovement(state, 5);
  assert.deepEqual(state.tile, { column: 15, row: 17 });
});

test('variable frame durations produce the same movement', () => {
  const first = createMovement({ column: 15, row: 15 });
  const second = createMovement({ column: 15, row: 15 });
  for (const state of [first, second]) setDestination(state, { column: 0, row: 0 });
  advanceMovement(first, 0.375);
  for (let index = 0; index < 3; index++) advanceMovement(second, 0.125);
  assert.deepEqual(first, second);
  advanceMovement(first, 100);
  assert.deepEqual(first.tile, { column: 0, row: 0 });
});
