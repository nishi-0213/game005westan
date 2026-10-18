import test from 'node:test';
import assert from 'node:assert/strict';
import {Recruitment} from '../src/recruitment.ts';
test('recruitment counts down for up to five living players and waits above that limit',()=>{
 const events=new Recruitment(()=>0);events.update(90,6);assert.equal(events.remainingSeconds,96);
 events.update(90,5);assert.equal(events.pending,false);events.update(6,5);assert.equal(events.pending,true);
 events.update(100,3);assert.equal(events.remainingSeconds,0);events.resolve();assert.equal(events.remainingSeconds,96);
 events.update(96,0);assert.equal(events.pending,true);
});
test('recruitment delays vary from one to two days and saved countdowns survive reload',()=>{
 const events=new Recruitment(()=>.5);assert.equal(events.remainingSeconds,144);events.update(40,3);
 const loaded=new Recruitment(()=>0);loaded.restoreState(JSON.parse(JSON.stringify(events.saveState())));loaded.update(103,3);assert.equal(loaded.pending,false);loaded.update(1,3);assert.equal(loaded.pending,true);
});
