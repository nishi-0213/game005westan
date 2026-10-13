import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClock } from '../src/simulation-clock.ts';
import { createMovement, setDestination, advanceMovement, renderedPosition } from '../src/movement.ts';
import { initialNeeds, SATIETY_LOSS_PER_SECOND } from '../src/needs.ts';

test('1x and3x advance both movement and hunger by the same scaled time',()=>{
 for(const speed of [1,3]){const clock=new SimulationClock();clock.speed=speed;const movement=createMovement({column:0,row:0});setDestination(movement,{column:20,row:0});const needs=initialNeeds();let steps=0;
 clock.advance(1,seconds=>{steps++;advanceMovement(movement,seconds);needs.satiety-=seconds*SATIETY_LOSS_PER_SECOND;});assert.equal(steps,60*speed);assert.ok(Math.abs(renderedPosition(movement).column-4*speed)<1e-8);assert.ok(Math.abs(needs.satiety-(100-speed))<1e-8);}
});
test('pause performs no work, consumes no time and does not accumulate a catch-up interval',()=>{
 const clock=new SimulationClock();let elapsed=0;clock.speed=0;clock.advance(100,seconds=>elapsed+=seconds);assert.equal(elapsed,0);clock.speed=1;clock.advance(1,seconds=>elapsed+=seconds);assert.ok(Math.abs(elapsed-1)<1e-8);
});
test('switching speed keeps partial steps and gives the same result regardless of frame sizes',()=>{
 for(const frames of [[.3,.7],Array(100).fill(.01)]){const clock=new SimulationClock();let time=0;for(const dt of frames)clock.advance(dt,seconds=>time+=seconds);clock.speed=3;clock.advance(1,seconds=>time+=seconds);assert.ok(Math.abs(time-4)<1e-8);}
});
