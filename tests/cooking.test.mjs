import test from 'node:test';import assert from 'node:assert/strict';
import {Cooking,COOK_SECONDS,stagedNutrition} from '../src/cooking.ts';import {Walls,footprint,BUILD_RECIPES} from '../src/walls.ts';import {Construction} from './helpers/construction.mjs';import {Harvesting} from '../src/harvesting.ts';import {Hauling} from '../src/hauling.ts';import {Storage} from '../src/storage.ts';import {createMovement} from '../src/movement.ts';import {advancePathMovement} from '../src/pathfinding.ts';import {updateWork,INITIAL_PRIORITIES,currentAction} from '../src/work-priorities.ts';import {countItems} from '../src/items.ts';import {destroyStructure} from '../src/demolition.ts';
const tile=(column,row)=>({column,row});
function scene(){const walls=new Walls(12),items=[],storage=new Storage(walls),construction=new Construction(walls,items,t=>walls.complete(t)),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,storage),workers=[];construction.storage=storage;const cooking=new Cooking(construction,hauling,()=>workers);const worker=(c=2,r=3)=>{const w={movement:createMovement(tile(c,r)),mode:'automatic',weapon:'unarmed',inventory:null,job:null,retrySeconds:0,harvestJob:null,harvestRetrySeconds:0,priorities:{...INITIAL_PRIORITIES[0],hauling:1,cooking:1,free:4}};workers.push(w);return w};const station=()=>{const s=walls.plan(tile(6,3),'wood','cooker');walls.complete(s);s.cooking.remaining=1;return s};const tick=w=>{updateWork(w,construction,harvesting,.1,()=>.5,.1,hauling,undefined,undefined,undefined,cooking);advancePathMovement(w.movement,.1,12,walls.isBlocked,walls.cannotStop)};return {walls,items,storage,construction,harvesting,hauling,cooking,workers,worker,station,tick};}
test('cookers occupy3x1 cells, rotate and require30wood and4seconds',()=>{const s=scene(),p=s.walls.plan(tile(6,3),'wood','cooker');assert.deepEqual(footprint(p),[tile(5,3),tile(6,3),tile(7,3)]);assert.deepEqual(BUILD_RECIPES.cooker,{materialCount:30,seconds:4});assert.equal(s.walls.plan(tile(7,3),'wood'),null);s.walls.complete(p);assert.ok(footprint(p).every(t=>s.walls.isBlocked(t)));const rotated=s.walls.plan(tile(9,5),'wood','cooker',1);assert.deepEqual(footprint(rotated),[tile(9,4),tile(9,5),tile(9,6)]);});
test('ground meat, berries and mixed recipes supply exactly100nutrition and create4collected rations',()=>{
for(const [meat,strawberry] of [[5,0],[0,10],[3,4]]){const s=scene(),w=s.worker(),station=s.station();if(meat)s.items.push({...tile(3,3),type:'meat',quantity:meat,collect:true});if(strawberry)s.items.push({...tile(3,4),type:'strawberry',quantity:strawberry,collect:true});for(let i=0;i<250&&station.cooking.remaining;i++)s.tick(w);assert.equal(station.cooking.remaining,0);assert.equal(stagedNutrition(station.cooking),0);assert.equal(countItems(s.items).ration,4);assert.equal(s.items.find(i=>i.type==='ration').collect,true);assert.equal(countItems(s.items).meat,0);assert.equal(countItems(s.items).strawberry,0);assert.equal(COOK_SECONDS,5);}
});
test('stored ingredients are used and processing resumes after an interruption without duplicate consumption',()=>{
const s=scene(),w=s.worker(),station=s.station(),box=s.walls.plan(tile(3,3),'wood','storage');s.walls.complete(box);s.storage.deposit(box,'meat',20);for(let i=0;i<120&&station.cooking.seconds<2;i++)s.tick(w);assert.ok(station.cooking.seconds>=2);assert.equal(box.stored.meat,15);assert.equal(station.cooking.meat,5);assert.equal(currentAction(w),'調理中');const saved=station.cooking.seconds;w.mode='drafted';s.tick(w);assert.equal(w.cookJob,null);assert.equal(station.cooking.seconds,saved);w.mode='automatic';w.workTask=undefined;for(let i=0;i<80&&station.cooking.remaining;i++)s.tick(w);assert.equal(countItems(s.items).ration,4);assert.equal(box.stored.meat,15);
});
test('count, until and infinite orders are independent and multiple workers cannot double-process one station',()=>{
const s=scene(),a=s.worker(),b=s.worker(2,4),station=s.station();station.cooking.meat=5;s.cooking.update(a,0,'process');assert.ok(a.cookJob);assert.equal(s.cooking.findProcessing(b),null);for(let i=0;i<80&&station.cooking.remaining;i++)s.tick(a);assert.equal(s.cooking.rationStock(),4);assert.equal(s.cooking.wantsWork(station),false);station.cooking.mode='until';station.cooking.target=4;assert.equal(s.cooking.wantsWork(station),false);station.cooking.target=5;assert.equal(s.cooking.wantsWork(station),true);station.cooking.mode='forever';station.cooking.target=0;assert.equal(s.cooking.wantsWork(station),true);
});
test('short, ignored or unreachable ingredients do not fabricate output; destruction returns staged ingredients',()=>{
const s=scene(),w=s.worker(),station=s.station();s.items.push({...tile(3,3),type:'meat',quantity:4,collect:true},{...tile(3,4),type:'strawberry',quantity:10,collect:false});for(let i=0;i<150;i++)s.tick(w);assert.equal(countItems(s.items).ration,0);assert.equal(stagedNutrition(station.cooking),80);assert.equal(station.cooking.seconds,0);for(let r=0;r<12;r++)s.walls.complete(s.walls.plan(tile(4,r),'wood'));w.movement=createMovement(tile(2,3));assert.equal(s.cooking.findTransport(w),null);destroyStructure(s.walls,s.items,station);assert.equal(countItems(s.items).meat,4);assert.equal(countItems(s.items).wood,15);
});

test('a cooking order without ingredients returns to free and resumes when ingredients arrive',()=>{
 const s=scene(),w=s.worker(),station=s.station();
 s.tick(w);assert.equal(w.freeActive,true);assert.ok(!w.cookJob);assert.equal(station.cooking.remaining,1);
 s.items.push({...tile(3,3),type:'meat',quantity:5,collect:true});
 for(let i=0;i<200&&station.cooking.remaining;i++)s.tick(w);
 assert.equal(station.cooking.remaining,0);assert.equal(countItems(s.items).ration,4);
});

test('depleted cooking ingredients release the active trip and station before arrival',()=>{
 const s=scene(),w=s.worker(),station=s.station(),source={...tile(9,3),type:'meat',quantity:5,collect:true};s.items.push(source);
 s.tick(w);assert.equal(w.cookJob.phase,'pickup');source.quantity=0;
 s.tick(w);assert.equal(w.cookJob,null);assert.equal(s.cooking.claims.size,0);assert.equal(w.freeActive,true);assert.equal(station.cooking.remaining,1);
});
