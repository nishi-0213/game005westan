import test from 'node:test';
import assert from 'node:assert/strict';
import {initialBodyHp,healthHp} from '../src/health.ts';
import {addCondition,attackConditions,mealConditions,updateConditions} from '../src/body-conditions.ts';
import {updateMood,moodEffects} from '../src/mood.ts';
import {GAME_MINUTES_PER_SECOND} from '../src/game-time.ts';
const hour=60/GAME_MINUTES_PER_SECOND;
const pawn=()=>({kind:'human',bodyHp:initialBodyHp(),needs:{satiety:100,wakefulness:100,happiness:50}});
test('attack debuffs roll independently at30percent and20percent on the struck part',()=>{
 for(const [rolls,kinds] of [[[.299,.199],['bleeding','bruise']],[[.3,.2],[]],[[.1,.9],['bleeding']],[[.9,.1],['bruise']]]){
  const p=pawn();attackConditions(p,'arms',()=>rolls.shift());assert.deepEqual((p.conditions??[]).map(c=>c.kind),kinds);assert.ok((p.conditions??[]).every(c=>c.part==='arms'));
 }
 const animal={hp:100};attackConditions(animal,'torso',()=>0);assert.equal(animal.conditions,undefined);
});
test('bleeding stacks on individual parts at5HP per game hour, expires after24hours and caps elapsed damage',()=>{
 const p=pawn();addCondition(p,'bleeding','arms');addCondition(p,'bleeding','arms');addCondition(p,'bleeding','torso');
 updateConditions(p,hour);assert.deepEqual(p.bodyHp,{head:100,torso:95,arms:90,legs:100});assert.equal(healthHp(p),95);
 updateConditions(p,-hour);assert.equal(p.bodyHp.torso,95);
 const q=pawn();q.conditions=[{kind:'bleeding',part:'head',seconds:hour/2}];updateConditions(q,10*hour);assert.equal(q.bodyHp.head,97.5);assert.deepEqual(q.conditions,[]);
 const r=pawn();addCondition(r,'bleeding','legs');updateConditions(r,24*hour);assert.deepEqual(r.conditions,[]);assert.equal(r.bodyHp.head,100);
});
test('bruise and stomachache last2days without HP damage; injuries stack mood while illness does not',()=>{
 const p=pawn();addCondition(p,'bruise','head');addCondition(p,'bruise','legs');addCondition(p,'stomachache','torso');addCondition(p,'stomachache','torso');updateMood(p,0);
 assert.deepEqual(moodEffects(p),[{label:'怪我をした',amount:-20,count:2},{label:'病気になった',amount:-15,count:1}]);assert.equal(p.needs.happiness,15);
 updateConditions(p,47*hour);assert.deepEqual(p.bodyHp,initialBodyHp());assert.equal(p.conditions.length,4);
 updateConditions(p,hour);updateMood(p,0);assert.equal(p.needs.happiness,50);assert.deepEqual(p.conditions,[]);
 const q=pawn();addCondition(q,'bleeding','arms');addCondition(q,'bruise','arms');updateMood(q,0);assert.equal(q.needs.happiness,30);updateConditions(q,24*hour);updateMood(q,0);assert.equal(q.needs.happiness,40);
});
for(const [type,chance] of [['ration',.05],['meat',.4],['humanCorpse',.8],['deerCorpse',.8],['wolfCorpse',.8],['strawberry',.1]])test(`${type} causes torso stomachache at probability${chance}`,()=>{
 const p=pawn();mealConditions(p,type,()=>chance-.001);assert.deepEqual(p.conditions,[{kind:'stomachache',part:'torso',seconds:48*hour}]);
 const q=pawn();mealConditions(q,type,()=>chance);assert.equal(q.conditions,undefined);
});
test('dead actors retain conditions without taking more damage or generating new conditions',()=>{
 const p=pawn();addCondition(p,'bleeding','head');p.dead=true;updateConditions(p,hour);attackConditions(p,'head',()=>0);mealConditions(p,'meat',()=>0);assert.equal(p.bodyHp.head,100);assert.equal(p.conditions.length,1);assert.equal(p.conditions[0].seconds,24*hour);
});

test('animal conditions stack and bleed without adding human mood penalties',async()=>{
 const {createDeer,createWolf}=await import('../src/wildlife.ts');
 for(const create of [createDeer,createWolf]){
  const p=create({column:1,row:1},1);attackConditions(p,'legs',()=>0);mealConditions(p,'strawberry',()=>0);
  assert.deepEqual(p.conditions.map(c=>[c.kind,c.part]),[['bleeding','legs'],['bruise','legs'],['stomachache','torso']]);
  updateConditions(p,hour);assert.equal(p.bodyHp.legs,95);assert.equal(p.bodyHp.head,100);updateMood(p,0);assert.equal(p.needs.happiness,undefined);
 }
});
