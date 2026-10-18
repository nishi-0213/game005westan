import test from 'node:test';
import assert from 'node:assert/strict';
import {randomPersonality,isPersonality,movementRate,foodRequirement,shootingBonus,constructionSuccessChance} from '../src/personality.ts';
import {createMovement,advanceMovement} from '../src/movement.ts';
import {mealConditions,attackConditions} from '../src/body-conditions.ts';
import {initialBodyHp} from '../src/health.ts';
import {Construction} from '../src/construction.ts';
import {Walls} from '../src/walls.ts';
const personality=(traits)=>({...randomPersonality(()=>0),traits});
test('six skill levels include both0and20 and each pawn gets two distinct valid traits',()=>{
 for(const random of [()=>0,()=>1,()=>.5,Math.random]){const p=randomPersonality(random);assert.equal(Object.keys(p.skills).length,6);assert.equal(p.traits.length,2);assert.notEqual(p.traits[0],p.traits[1]);assert.equal(isPersonality(p),true);}
 assert.ok(Object.values(randomPersonality(()=>0).skills).every(n=>n===0));assert.ok(Object.values(randomPersonality(()=>1).skills).every(n=>n===20));const bad=randomPersonality(()=>0);bad.traits[1]=bad.traits[0];assert.equal(isPersonality(bad),false);bad.traits=['cautious','athletic'];bad.skills.shooting=21;assert.equal(isPersonality(bad),false);
});
test('cautious prevents all meal stomachaches while still allowing attack injuries',()=>{
 const p={personality:personality(['cautious','meticulous']),bodyHp:initialBodyHp(),conditions:[]};
 for(const type of ['ration','meat','humanCorpse','deerCorpse','wolfCorpse','strawberry'])mealConditions(p,type,()=>0);assert.deepEqual(p.conditions,[]);attackConditions(p,'arms',()=>0);assert.deepEqual(p.conditions.map(c=>c.kind),['bleeding','bruise']);
});
test('athletic movement is120percent and multiplies floor movement without altering the base speed',()=>{
 const actor={personality:personality(['athletic','cautious'])},m=createMovement({column:0,row:0});m.destination={column:10,row:0};m.actorSpeedMultiplier=movementRate(actor);m.speedMultiplier=()=>1.2;advanceMovement(m,1);assert.equal(m.tilesPerSecond,4);assert.equal(m.tile.column,5);assert.ok(Math.abs(m.progress-.76)<1e-9);assert.equal(foodRequirement({personality:personality(['bigEater','cautious'])}),1.2);assert.equal(shootingBonus({personality:personality(['dexterous','cautious'])}),.2);
});
test('building success is80percent normally and96percent for meticulous; failed work retries with its materials intact',()=>{
 for(const [traits,roll,success]of [[[],.7999,true],[[],.8,false],[['meticulous'],.9599,true],[['meticulous'],.96,false]]){
  const walls=new Walls(8),target=walls.plan({column:3,row:2},'wood'),p={personality:personality(traits),movement:createMovement({column:2,row:2}),mode:'automatic',inventory:null,job:{target,phase:'build',goal:{column:2,row:2}},retrySeconds:0};target.delivered=2;const c=new Construction(walls,[],t=>walls.complete(t));c.random=()=>roll;c.claims.set(target,p);c.update(p,1,'build');assert.equal(target.state,success?'completed':'planned');assert.equal(target.delivered,2);if(!success){assert.equal(target.workSeconds,0);c.random=()=>0;c.update(p,1,'build');assert.equal(target.state,'completed');}
 }
 assert.equal(constructionSuccessChance({}),.8);assert.equal(constructionSuccessChance({personality:personality(['meticulous'])}),.96);
});
test('a successful building roll waiting for clearance is not rerolled every frame',()=>{
 const walls=new Walls(8),target=walls.plan({column:3,row:2},'wood'),p={movement:createMovement({column:2,row:2}),mode:'automatic',inventory:null,job:{target,phase:'build',goal:{column:2,row:2}},retrySeconds:0};target.delivered=2;let allowed=false,rolls=0;const c=new Construction(walls,[],t=>allowed&&walls.complete(t));p.personality=personality(['meticulous','cautious']);c.random=()=>{rolls++;return .9};c.claims.set(target,p);c.update(p,1,'build');p.personality=undefined;c.update(p,.1,'build');assert.equal(rolls,1);allowed=true;c.update(p,.1,'build');assert.equal(rolls,1);assert.equal(target.state,'completed');
});

test('skill modifiers are linear from minus20percent to plus20percent with neutral fallback',async()=>{
 const {skillRate,huntingRetaliationChance}=await import('../src/personality.ts');
 for(const [level,rate,chance]of [[0,.8,.7],[5,.9,.6],[10,1,.5],[15,1.1,.4],[20,1.2,.3]]){const p=personality(['cautious','meticulous']);for(const key of Object.keys(p.skills))p.skills[key]=level;assert.ok(Math.abs(skillRate({personality:p},'shooting')-rate)<1e-12);assert.ok(Math.abs(huntingRetaliationChance({personality:p},.5)-chance)<1e-12);}
 assert.equal(skillRate({},'melee'),1);
});
