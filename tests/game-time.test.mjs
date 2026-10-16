import test from 'node:test';import assert from 'node:assert/strict';import {GameTime,daylight} from '../src/game-time.ts';import {SimulationClock} from '../src/simulation-clock.ts';
test('one simulation second advances15minutes and96seconds advances a Gregorian calendar day',()=>{const t=new GameTime();assert.equal(t.label,'1年1月1日 08時');t.advance(1);assert.equal(t.label,'1年1月1日 08時');assert.equal(t.hour,8.25);t.advance(95);assert.equal(t.label,'1年1月2日 08時');t.advance(96*30);assert.equal(t.label,'1年2月1日 08時');t.advance(-5);assert.equal(t.label,'1年2月1日 08時');});
test('game dates follow pause and3x speed exactly',()=>{const c=new SimulationClock(),t=new GameTime();c.speed=0;c.advance(10,s=>t.advance(s));assert.equal(t.label,'1年1月1日 08時');c.speed=3;c.advance(1,s=>t.advance(s));assert.ok(Math.abs(t.hour-8.75)<1e-6);});
test('morning shadows extend left, noon centers them, evening right and night hides them',()=>{assert.ok(daylight(8).shadowX<0);assert.ok(Math.abs(daylight(12).shadowX)<1e-9);assert.ok(daylight(17).shadowX>0);for(const h of [0,4,5,19,20,23])assert.equal(daylight(h).shadowAlpha,0);assert.ok(daylight(12).shadowY>0);});
test('daytime preserves colors; sunset warms them and night makes the scene dark blue with continuous transitions',()=>{assert.deepEqual([daylight(12).red,daylight(12).green,daylight(12).blue],[1,1,1]);assert.ok(daylight(18.5).red>daylight(18.5).green);assert.ok(daylight(0).blue>daylight(0).green);assert.ok(daylight(0).green>daylight(0).red);for(const h of [4,4.5,5,18,18.5,19])for(const channel of ['red','green','blue'])assert.ok(Math.abs(daylight(h-.00001)[channel]-daylight(h+.00001)[channel])<.0001);});

test('daylight reaches full brightness at05and full darkness at19',()=>{
 const rgb=h=>{const light=daylight(h);return [light.red,light.green,light.blue];};
 assert.deepEqual(rgb(5),[1,1,1]);assert.deepEqual(rgb(18),[1,1,1]);assert.deepEqual(rgb(19),rgb(0));
 assert.ok(daylight(4.75).green<1);assert.ok(daylight(18.75).green<1);
 assert.equal(daylight(5).shadowAlpha,0);assert.equal(daylight(19).shadowAlpha,0);
});
