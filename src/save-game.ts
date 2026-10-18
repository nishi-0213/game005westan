import type {EnvironmentObject} from './environment';
import type {MapItem} from './items';
import {BUILD_RECIPES,footprint,isFloor,type Wall} from './walls.ts';
import {ITEM_TYPES,CLOTHING} from './items.ts';
import type {Movement,Tile} from './movement';
import type {EatingWorker} from './needs';
import {corpsePosition} from './butchery.ts';
export const SAVE_KEY='game005westan.save.v1';
export const ACTOR_FIELDS=['name','appearance','clothing','hp','bodyHp','armor','needs','conditions','moodMemories','mode','faction','weapon','inventory','priorities','dead','consumed','collectCorpse','hunt','id','freeSeconds','leaving','departed','exitGoal','outsideGoal','draftedSeconds','draftLimitSeconds','deadPosition','manualMove','schedule','combatCommitted'] as const;
const WALL_FIELDS=['column','row','kind','orientation','material','state','delivered','workSeconds','hp','openness','doorMode','stored','accepted','demolition','demolitionSeconds','cooking'] as const;
export interface SavedActor {kind:'human'|'deer'|'wolf';data:Record<string,any>;movement:Pick<Movement,'tile'|'destination'|'nextTile'|'progress'|'route'|'tilesPerSecond'|'pendingRepath'>;sleep?:{phase:string;goal:Tile;bed?:number;scheduled?:boolean};storage?:number;station?:number;attack?:number;nursing?:{patient:number;seconds:number}}
export interface SavedWall {data:Record<string,any>;corpses:number[];butcher?:Record<string,any>;processingCorpse?:number}
export interface SaveGame {version:1;mapSize:number;savedAt:number;time:number;camera:{x:number;y:number;zoom:number};environment:EnvironmentObject[];items:MapItem[];actors:SavedActor[];walls:SavedWall[];growth:unknown;wildlife:unknown}
export interface SaveWorld {mapSize:number;time:number;camera:SaveGame['camera'];environment:EnvironmentObject[];items:MapItem[];actors:(EatingWorker & {kind:'human'|'deer'|'wolf';attackJob?:{target:unknown;manual?:boolean}|null})[];walls:Wall[];growth:unknown;wildlife:unknown}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function pickFields(object:object,fields:readonly string[]):Record<string,any> {const result:Record<string,any>={};for(const key of fields)if(Object.hasOwn(object,key))result[key]=(object as Record<string,unknown>)[key];return result;}
export function createSave(world:SaveWorld):SaveGame {
 const actorIds=new Map(world.actors.map((actor,index)=>[actor,index])),wallIds=new Map(world.walls.map((wall,index)=>[wall,index]));
 const wallAt=(tile:Tile|undefined)=>tile?world.walls.findIndex(w=>w.column===tile.column&&w.row===tile.row):-1;
 const actors:SavedActor[]=world.actors.map(actor=>{
  const data=pickFields(actor,ACTOR_FIELDS),m=actor.movement;
  const movement=pickFields(m,['tile','destination','nextTile','progress','route','tilesPerSecond','pendingRepath']) as SavedActor['movement'];
  if(m.pendingRoute)movement.pendingRepath={...m.pendingRoute.goal};
  if(actor.dead&&actor.corpseCarrier){const p=corpsePosition(actor);data.deadPosition=p;movement.tile={column:Math.floor(p.column),row:Math.floor(p.row)};movement.destination=movement.tile;movement.nextTile=null;movement.progress=0;movement.route=[];delete movement.pendingRepath;}
  const saved:SavedActor={kind:actor.kind,data,movement};
  if(actor.sleep)saved.sleep={phase:actor.sleep.phase,goal:actor.sleep.goal,scheduled:actor.sleep.scheduled,bed:actor.sleep.bed?wallIds.get(actor.sleep.bed):undefined};
  if(actor.corpseStorage)saved.storage=wallIds.get(actor.corpseStorage);
  if(actor.corpseStation)saved.station=wallAt(actor.corpseStation);
  if(actor.attackJob?.manual!==false&&actor.attackJob){const id=actorIds.get(actor.attackJob.target as SaveWorld['actors'][number]);if(id!==undefined)saved.attack=id;}
  if(actor.nurseJob?.manual){const id=actorIds.get(actor.nurseJob.patient as SaveWorld['actors'][number]);if(id!==undefined)saved.nursing={patient:id,seconds:actor.nurseJob.seconds};}
  return saved;
 });
 const walls=world.walls.map(wall=>({data:pickFields(wall,WALL_FIELDS),corpses:(wall.storedCorpses??[]).map(c=>actorIds.get(c as SaveWorld['actors'][number])).filter((id):id is number=>id!==undefined),butcher:wall.butcher?pickFields(wall.butcher,['mode','remaining','target','seconds']):undefined,processingCorpse:wall.butcher?.corpse?actorIds.get(wall.butcher.corpse as SaveWorld['actors'][number]):undefined}));
 return clone({version:1,mapSize:world.mapSize,savedAt:Date.now(),time:world.time,camera:world.camera,environment:world.environment.filter(o=>!o.collected),items:world.items.filter(i=>i.quantity>0),actors,walls,growth:world.growth,wildlife:world.wildlife});
}
export function parseSave(text:string):SaveGame {
 const save=JSON.parse(text) as SaveGame;
 const tile=(p:Tile)=>p&&Number.isInteger(p.column)&&Number.isInteger(p.row)&&p.column>=-1&&p.row>=-1&&p.column<=128&&p.row<=128;
 if(!save||save.version!==1||save.mapSize!==128||!Number.isFinite(save.time)||!Number.isFinite(save.savedAt)||!save.camera||!['x','y','zoom'].every(k=>Number.isFinite((save.camera as any)[k])))throw new Error('対応していないセーブデータです');
 if(!Array.isArray(save.environment)||!Array.isArray(save.items)||!Array.isArray(save.actors)||!Array.isArray(save.walls)||save.actors.length>2000||save.walls.length>32768||save.environment.length>16384)throw new Error('セーブデータの形式が正しくありません');
 for(const a of save.actors)if(!a||!['human','deer','wolf'].includes(a.kind)||!a.data||!a.data.needs||!tile(a.movement?.tile)||!tile(a.movement.destination)||!Number.isFinite(a.movement.progress)||a.movement.pendingRepath&&!tile(a.movement.pendingRepath)||a.movement.nextTile&&!tile(a.movement.nextTile)||a.movement.route&&!a.movement.route.every(tile)||a.kind==='human'&&(!a.data.name||!a.data.appearance||!a.data.priorities))throw new Error('ポーンのセーブデータが壊れています');
 const fail=()=>{throw new Error('セーブデータの内容が壊れています');};
 const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n);
 const numbers=(o:Record<string,unknown>|undefined)=>!!o&&Object.values(o).every(finite);
 if(save.camera.zoom<=0||save.camera.zoom>100||!Number.isFinite(new Date(save.time).getTime()))fail();
 for(const o of save.environment)if(!tile(o)||!['tree','rock','wildStrawberry','grass'].includes(o.type)||!finite(o.hp)||!finite(o.workSeconds)||o.ageSeconds!==undefined&&!finite(o.ageSeconds))fail();
 for(const o of save.items)if(!tile(o)||!ITEM_TYPES.includes(o.type)||!finite(o.quantity)||o.quantity<=0)fail();
 for(const a of save.actors){
  const d=a.data;
  if(d.schedule!==undefined&&(!Array.isArray(d.schedule)||d.schedule.length!==24||d.schedule.some((mode:unknown)=>!['free','work','sleep'].includes(mode as string))))fail();
  if(d.combatCommitted!==undefined&&typeof d.combatCommitted!=='boolean')fail();
  if(!numbers(d.needs)||!finite(d.hp)||!numbers(d.bodyHp)||!['head','torso','arms','legs'].every(k=>finite(d.bodyHp[k]))||!finite(a.movement.tilesPerSecond)||a.movement.progress<0||a.movement.progress>1)fail();
  if(d.inventory&&(!ITEM_TYPES.includes(d.inventory.type)||!finite(d.inventory.quantity)||d.inventory.quantity<0))fail();
  if(d.clothing&&Object.entries(d.clothing).some(([slot,type])=>!Object.hasOwn(CLOTHING,type as string)||CLOTHING[type as keyof typeof CLOTHING].slot!==slot))fail();
  if(d.conditions&&(!Array.isArray(d.conditions)||d.conditions.some((c:any)=>!['bleeding','bruise','stomachache'].includes(c.kind)||!['head','torso','arms','legs'].includes(c.part)||!finite(c.seconds))))fail();
  if(d.moodMemories&&(!Array.isArray(d.moodMemories)||d.moodMemories.some((m:any)=>!['standingMeal','rawFood','killedHuman'].includes(m.kind)||!finite(m.seconds))))fail();
  if(a.kind==='human'&&(!numbers(d.priorities)||!['skinRed','skinDark','eyeSaturation'].every(k=>finite(d.appearance[k]))||d.appearance.hair!==undefined&&!['none','hair1','hair2'].includes(d.appearance.hair)))fail();
  if(a.sleep&&(!['approach','settle','sleeping','exit'].includes(a.sleep.phase)||!tile(a.sleep.goal)))fail();
  if(a.nursing&&(!finite(a.nursing.seconds)||a.nursing.seconds<0))fail();
 }
 const cells=new Set<string>();
 for(const w of save.walls){
  const d=w.data;
  if(!Object.hasOwn(BUILD_RECIPES,d.kind)||!['wood','stone'].includes(d.material)||!['planned','completed'].includes(d.state)||![0,1,undefined].includes(d.orientation)||!finite(d.delivered)||!finite(d.workSeconds))fail();
  for(const p of footprint(d as Wall)){const key=`${isFloor(d.kind)?'floor:':''}${p.column},${p.row}`;if(!tile(p)||p.column<0||p.row<0||p.column>=128||p.row>=128||cells.has(key))fail();cells.add(key);}
  if(d.stored&&!numbers(d.stored))fail();
  for(const state of [d.cooking,w.butcher])if(state&&(!['count','until','forever'].includes(state.mode)||!['remaining','target','seconds'].every(k=>finite(state[k]))))fail();
 }
 const growth=save.growth as any,wildlife=save.wildlife as any;
 if(!growth||!finite(growth.elapsed)||growth.elapsed<0||growth.elapsed>=60||!Array.isArray(growth.births)||!Number.isInteger(growth.birthIndex)||growth.birthIndex<0||growth.birthIndex>growth.births.length||growth.births.some((b:any,i:number)=>!['tree','wildStrawberry','grass'].includes(b.type)||!finite(b.time)||b.time<0||b.time>60||i>0&&b.time<growth.births[i-1].time))fail();
 if(!wildlife||!['nextId','spawnSeconds','exitSeconds','wolfSpawnSeconds','wolfExitSeconds'].every(k=>finite(wildlife[k]))||typeof wildlife.firstDeerWave!=='boolean'||typeof wildlife.firstWolfWave!=='boolean')fail();
 for(const w of save.walls)if(!w||!w.data||!tile(w.data as Tile)||!Array.isArray(w.corpses))throw new Error('建築物のセーブデータが壊れています');
 const id=(n:unknown,length:number)=>n===undefined||Number.isInteger(n)&&(n as number)>=0&&(n as number)<length;
 for(const a of save.actors)if(!id(a.storage,save.walls.length)||!id(a.station,save.walls.length)||!id(a.sleep?.bed,save.walls.length)||!id(a.attack,save.actors.length)||!id(a.nursing?.patient,save.actors.length))throw new Error('セーブ内の参照が壊れています');
 for(const w of save.walls)if(!w.corpses.every(n=>id(n,save.actors.length))||!id(w.processingCorpse,save.actors.length))throw new Error('死体のセーブデータが壊れています');
 return save;
}
export function writeSave(storage:Pick<Storage,'setItem'>,save:SaveGame):void {const text=JSON.stringify(save);parseSave(text);storage.setItem(SAVE_KEY,text);}
export function readSave(storage:Pick<Storage,'getItem'>):SaveGame|null {const text=storage.getItem(SAVE_KEY);return text===null?null:parseSave(text);}
