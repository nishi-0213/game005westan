import assert from 'node:assert/strict';
import test from 'node:test';
import { Walls, dragTiles } from '../src/walls.ts';
import { advanceMovement, createMovement, setDestination } from '../src/movement.ts';

test('wall plans preserve material and become solid only on explicit completion', () => {
  const walls = new Walls(32);
  const wood = walls.plan({ column: 10, row: 10 }, 'wood');
  const stone = walls.plan({ column: 11, row: 10 }, 'stone');
  assert.equal(wood.material, 'wood');
  assert.equal(stone.material, 'stone');
  assert.equal(walls.isBlocked(wood), false);
  assert.equal(walls.complete(wood), true);
  assert.equal(wood.state, 'completed');
  assert.equal(walls.isBlocked(wood), true);
  assert.equal(stone.state, 'planned');
  assert.equal(walls.complete(wood), false);
  assert.equal(walls.complete({ column: 0, row: 0 }), false);
});

test('duplicate and out-of-bounds plans do not change existing walls', () => {
  const walls = new Walls(32);
  walls.plan({ column: 0, row: 0 }, 'wood');
  assert.equal(walls.plan({ column: 0, row: 0 }, 'stone'), null);
  for (const tile of [{ column: -1, row: 0 }, { column: 32, row: 0 }, { column: 0, row: 32 }, { column: 0.5, row: 0 }]) {
    assert.equal(walls.plan(tile, 'wood'), null);
  }
  assert.equal(walls.items.size, 1);
  assert.equal(walls.items.get('0,0').material, 'wood');
});

test('fast horizontal, vertical and diagonal drags leave a continuous line of tiles', () => {
  for (const destination of [{ column: 8, row: 3 }, { column: 3, row: 8 }, { column: 8, row: 8 }, { column: 8, row: 5 }]) {
    const line = dragTiles({ column: 3, row: 3 }, destination);
    assert.deepEqual(line.at(-1), destination);
    assert.equal(line.length, 6);
    for (let i = 1; i < line.length; i++) {
      assert.equal(Math.max(Math.abs(line[i].column - line[i-1].column), Math.abs(line[i].row - line[i-1].row)), 1);
    }
  }
  assert.deepEqual(dragTiles({ column: 2, row: 2 }, { column: 2, row: 2 }), [{ column: 2, row: 2 }]);
});

test('pawns walk across plans but stop before completed walls', () => {
  const walls = new Walls(32);
  walls.plan({ column: 17, row: 15 }, 'stone');
  const pawn = createMovement({ column: 15, row: 15 });
  setDestination(pawn, { column: 18, row: 15 });
  advanceMovement(pawn, 1, walls.isBlocked);
  assert.deepEqual(pawn.tile, { column: 18, row: 15 });
  walls.complete({ column: 17, row: 15 });
  setDestination(pawn, { column: 15, row: 15 });
  advanceMovement(pawn, 1, walls.isBlocked);
  assert.deepEqual(pawn.tile, { column: 18, row: 15 });
  assert.equal(pawn.nextTile, null);
  assert.equal(pawn.progress, 0);
});

test('diagonal movement cannot cut across either edge of a completed wall', () => {
  for (const tile of [{ column: 16, row: 15 }, { column: 15, row: 16 }, { column: 16, row: 16 }]) {
    const walls = new Walls(32);
    walls.plan(tile, 'wood'); walls.complete(tile);
    const pawn = createMovement({ column: 15, row: 15 });
    setDestination(pawn, { column: 17, row: 17 });
    advanceMovement(pawn, 1, walls.isBlocked);
    assert.deepEqual(pawn.tile, { column: 15, row: 15 });
  }
});

test('only planned structures can be removed, including partially built barricades',()=>{
 const walls=new Walls(32);const target=walls.plan({column:5,row:5},'stone','barricade');target.delivered=5;target.workSeconds=.5;
 assert.equal(walls.removePlan(target),target);assert.equal(target.state,'cancelled');assert.equal(target.delivered,5);assert.equal(walls.items.size,0);
 const completed=walls.plan({column:6,row:5},'wood');walls.complete(completed);
 assert.equal(walls.removePlan(completed),null);assert.equal(walls.isBlocked(completed),true);
});
