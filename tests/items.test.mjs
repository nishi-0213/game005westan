import assert from 'node:assert/strict';
import test from 'node:test';
import { countItems, initialItems, returnItems } from '../src/items.ts';

test('initial map has central stacks totaling 100 wood and 200 stone', () => {
  const items = initialItems();
  assert.deepEqual(countItems(items), {wood:100,stone:200,strawberry:0});
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.ok(item.column >= 15 && item.column <= 17 && item.row >= 15 && item.row <= 17);
  }
});

test('counts add every stack including stacks at distant map edges', () => {
  const items = [
    { type: 'wood', quantity: 100, column: 16, row: 16 },
    { type: 'wood', quantity: 25, column: 0, row: 0 },
    { type: 'stone', quantity: 200, column: 17, row: 16 },
    { type: 'stone', quantity: 75, column: 31, row: 31 },
  ];
  assert.deepEqual(countItems(items), {wood:125,stone:275,strawberry:0});
  items[0].quantity = 40;
  items.pop();
  assert.deepEqual(countItems(items), {wood:65,stone:200,strawberry:0});
});

test('empty map reports zero totals', () => {
  assert.deepEqual(countItems([]), {wood:0,stone:0,strawberry:0});
});

test('returned building materials merge with an existing stack without losing quantities', () => {
  const items = [{type:'wood',quantity:90,column:5,row:5}];
  returnItems(items,{column:5,row:5},'wood',10);
  returnItems(items,{column:5,row:5},'stone',5);
  assert.equal(items.length,2);
  assert.deepEqual(countItems(items),{wood:100,stone:5,strawberry:0});
});
