import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSchedule,scheduleAt,nextSchedule} from '../src/schedule.ts';
test('schedules default to sleep at21through05, cycle per hour, and repeat daily',()=>{
 const a=initialSchedule(),b=initialSchedule();assert.equal(a.length,24);assert.deepEqual(a,Array.from({length:24},(_,h)=>h<=5||h>=21?'sleep':'free'));assert.equal(a.filter(m=>m==='sleep').length,9);a[8]=nextSchedule(a[8]);assert.equal(a[8],'work');assert.equal(b[8],'free');assert.equal(scheduleAt(a,8.9),'work');assert.equal(scheduleAt(a,32),'work');a[8]=nextSchedule(a[8]);assert.equal(a[8],'sleep');a[8]=nextSchedule(a[8]);assert.equal(a[8],'free');assert.equal(scheduleAt(undefined,23),'free');
});
