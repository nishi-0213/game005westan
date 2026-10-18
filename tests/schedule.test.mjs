import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSchedule,scheduleAt,nextSchedule} from '../src/schedule.ts';
test('schedules default to all activities, cycle per hour, and repeat daily',()=>{
 const a=initialSchedule(),b=initialSchedule();assert.equal(a.length,24);assert.ok(a.every(m=>m==='free'));a[8]=nextSchedule(a[8]);assert.equal(a[8],'work');assert.equal(b[8],'free');assert.equal(scheduleAt(a,8.9),'work');assert.equal(scheduleAt(a,32),'work');a[8]=nextSchedule(a[8]);assert.equal(a[8],'sleep');a[8]=nextSchedule(a[8]);assert.equal(a[8],'free');assert.equal(scheduleAt(undefined,23),'free');
});
