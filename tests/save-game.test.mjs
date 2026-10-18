import test from 'node:test';
import assert from 'node:assert/strict';
import {createSave,parseSave,readSave,writeSave,SAVE_KEY} from '../src/save-game.ts';
import {createDeer} from '../src/wildlife.ts';
import {Walls} from '../src/walls.ts';
import {PlantGrowth} from '../src/plant-growth.ts';
import {createEnvironment} from '../src/environment.ts';
import {GameTime} from '../src/game-time.ts';
function scene(){
 const walls=new Walls(128),bed=walls.plan({column:64,row:64},'wood','bed');walls.complete(bed);
 const pawn={...createDeer({column:63,row:64},1),kind:'human',name:{surname:'田中',givenName:'一郎',nickname:'イチ'},appearance:{skinRed:.4,skinDark:.2,eyeSaturation:1,eyeHue:90,hair:'hair1'},priorities:{nursing:1,construction:3,harvesting:2},clothing:{head:'hat',torso:'jacket'},inventory:{type:'wood',quantity:7},weapon:'rifle',conditions:[{kind:'bleeding',part:'arms',seconds:30}],moodMemories:[{kind:'rawFood',seconds:40}]};
 pawn.bodyHp.arms=36;pawn.sleep={phase:'sleeping',goal:bed,bed};
 const environment=[createEnvironment('tree',{column:5,row:5})],growth=new PlantGrowth(environment,walls,()=>false).saveState();
 const world={mapSize:128,time:new GameTime().date.getTime(),camera:{x:100,y:300,zoom:4},environment,items:[{column:63,row:65,type:'ration',quantity:20,collect:true}],actors:[pawn],walls:[bed],growth,wildlife:{nextId:9,spawnSeconds:12,exitSeconds:10,wolfSpawnSeconds:31,wolfExitSeconds:9,firstDeerWave:false,firstWolfWave:false}};
 return {world,pawn,walls,bed};
}
test('save roundtrip preserves pawn health, needs, clothing, appearance, priorities, supplies, map and timers without runtime references',()=>{
 const {world,pawn,bed}=scene();pawn.view={parent:pawn};pawn.movement.changed=()=>{};
 const data=createSave(world),round= parseSave(JSON.stringify(data));
 assert.deepEqual(round.actors[0].data.bodyHp,pawn.bodyHp);assert.deepEqual(round.actors[0].data.inventory,pawn.inventory);assert.deepEqual(round.actors[0].data.appearance,pawn.appearance);assert.deepEqual(round.actors[0].data.conditions,pawn.conditions);assert.deepEqual(round.actors[0].data.moodMemories,pawn.moodMemories);assert.deepEqual(round.actors[0].data.clothing,pawn.clothing);assert.deepEqual(round.actors[0].data.needs,pawn.needs);assert.deepEqual(round.actors[0].data.priorities,pawn.priorities);assert.equal(round.actors[0].sleep.bed,0);assert.equal(round.actors[0].data.view,undefined);assert.deepEqual(round.items,world.items);assert.deepEqual(round.environment,world.environment);assert.deepEqual(round.growth,world.growth);assert.deepEqual(round.wildlife,world.wildlife);assert.equal(round.time,world.time);assert.equal(round.walls[0].data.state,bed.state);
 pawn.bodyHp.arms=0;assert.equal(data.actors[0].data.bodyHp.arms,36);
});
test('save uses IDs for shared corpse, bed, manual attack and nursing references and retains workshop progress',()=>{
 const {world,pawn,walls}=scene(),corpse=createDeer({column:60,row:60},2);corpse.dead=true;
 const storage=walls.plan({column:60,row:60},'wood','storageArea'),station=walls.plan({column:61,row:60},'wood','butcher');
 corpse.corpseStorage=storage;storage.storedCorpses=[corpse];station.butcher={mode:'until',remaining:3,target:20,seconds:.8,corpse};
 pawn.attackJob={target:corpse,manual:true};pawn.nurseJob={patient:pawn,manual:true,seconds:.4};world.actors.push(corpse);world.walls.push(storage,station);
 const saved=parseSave(JSON.stringify(createSave(world)));
 assert.deepEqual(saved.walls[1].corpses,[1]);assert.equal(saved.actors[1].storage,1);assert.equal(saved.walls[2].processingCorpse,1);assert.equal(saved.walls[2].butcher.seconds,.8);assert.equal(saved.actors[0].attack,1);assert.deepEqual(saved.actors[0].nursing,{patient:0,seconds:.4});
});
test('carried corpses are dropped at carrier position in snapshot without changing live world',()=>{
 const {world,pawn}=scene(),corpse=createDeer({column:2,row:2},3);corpse.dead=true;corpse.corpseCarrier=pawn;world.actors.push(corpse);
 const saved=parseSave(JSON.stringify(createSave(world)));assert.equal(saved.actors[1].movement.tile.column,63);assert.equal(corpse.movement.tile.column,2);assert.equal(saved.actors[1].movement.progress,0);assert.deepEqual(saved.actors[1].movement.route,[]);
});
test('storage is one slot; missing data returns null and failed writes preserve the previous save',()=>{
 let stored=null;const storage={getItem:key=>(assert.equal(key,SAVE_KEY),stored),setItem:(key,value)=>{assert.equal(key,SAVE_KEY);stored=value;}};
 assert.equal(readSave(storage),null);const saved=createSave(scene().world);writeSave(storage,saved);assert.deepEqual(readSave(storage),saved);const previous=stored;
 assert.throws(()=>writeSave({...storage,setItem:()=>{throw new Error('QuotaExceededError');}},saved),/QuotaExceededError/);assert.equal(stored,previous);
});
test('reject malformed, incompatible and unsafe world data before restoration',()=>{
 const base=createSave(scene().world);
 for(const mutate of [s=>s.version=2,s=>s.mapSize=64,s=>s.actors[0].sleep.bed=5,s=>s.actors[0].data.bodyHp=null,s=>s.environment[0].type='unknown',s=>s.items[0].type='unknown',s=>s.walls.push(structuredClone(s.walls[0])),s=>s.walls[0].data.kind='unknown',s=>s.growth.elapsed=60,s=>s.wildlife.nextId=null]){const bad=structuredClone(base);mutate(bad);assert.throws(()=>parseSave(JSON.stringify(bad)));}
 assert.throws(()=>parseSave('{'));assert.throws(()=>parseSave('null'));
});
test('game time and plant schedule resume from the saved instant',()=>{
 const {world,walls}=scene(),time=new GameTime();time.advance(7);const stamp=time.date.getTime();const resumed=new GameTime();resumed.restore(stamp);assert.equal(resumed.date.getTime(),stamp);resumed.advance(2);time.advance(2);assert.equal(resumed.date.getTime(),time.date.getTime());
 const growth=new PlantGrowth(world.environment,walls,()=>false);growth.update(3);const state=growth.saveState(),next=new PlantGrowth(world.environment,walls,()=>false);next.restoreState(state);assert.deepEqual(next.saveState(),state);assert.throws(()=>resumed.restore(NaN));
});

test('queued route searches are restored as repath requests without serializing callbacks',()=>{
 const {world,pawn}=scene();pawn.movement.pendingRoute={goal:{column:90,row:88},cancel:()=>{throw new Error('not called')}};
 const saved=parseSave(JSON.stringify(createSave(world)));assert.deepEqual(saved.actors[0].movement.pendingRepath,{column:90,row:88});assert.equal(saved.actors[0].movement.pendingRoute,undefined);
});
test('combat commitment survives a save even when the animal no longer has an attack order',()=>{
 const {world}=scene(),animal=createDeer({column:70,row:70},3);animal.kind='wolf';animal.combatCommitted=true;world.actors.push(animal);
 const saved=parseSave(JSON.stringify(createSave(world)));assert.equal(saved.actors[1].data.combatCommitted,true);assert.equal(saved.actors[1].attack,undefined);
});
test('per-hour schedules and scheduled sleep survive saving; invalid schedules are rejected',()=>{
 const {world,pawn}=scene();pawn.schedule=Array(24).fill('free');pawn.schedule[8]='work';pawn.schedule[23]='sleep';pawn.sleep.scheduled=true;
 const saved=parseSave(JSON.stringify(createSave(world)));assert.deepEqual(saved.actors[0].data.schedule,pawn.schedule);assert.equal(saved.actors[0].sleep.scheduled,true);
 saved.actors[0].data.schedule[0]='invalid';assert.throws(()=>parseSave(JSON.stringify(saved)));
});
