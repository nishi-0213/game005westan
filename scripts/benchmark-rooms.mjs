// Compare room maintenance and connectivity rejection with the previous branch state.
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const beforeRoot=resolve(process.argv[2]??'/workspace/scratch/rooms-baseline');
const before={...await import(pathToFileURL(`${beforeRoot}/src/walls.ts`)),...await import(pathToFileURL(`${beforeRoot}/src/pathfinding.ts`))};
const after={...await import('../src/walls.ts'),...await import('../src/pathfinding.ts')};
function scene(api,size,scenario){
 const walls=new api.Walls(size),step=size===32?8:16;
 for(let row=0;row<size;row++)for(let column=0;column<size;column++){
  let kind;
  if((scenario==='sealed'||scenario==='detour')&&column===size/2&&(scenario==='sealed'||row!==size-3))kind='wall';
  if(scenario==='rooms'&&(column%step===0||row%step===0))kind=(column%step===0&&row%step===step/2||row%step===0&&column%step===step/2)?'door':'wall';
  if(kind){const wall=walls.plan({column,row},'wood',kind);walls.complete(wall);}
 }
 return {walls,step};
}
const results=[];
if(!process.argv.includes('--updates-only'))for(const size of [32,320])for(const scenario of ['open','rooms','sealed','detour'])for(const [version,api]of [['before',before],['after',after]]){
 const samples=[],queryCount=scenario==='detour'?8:100;
 for(let run=0;run<3;run++){
  const {walls,step}=scene(api,size,scenario);let lookups=0;const at=walls.at.bind(walls);walls.at=tile=>{lookups++;return at(tile)};
  let begin=performance.now();walls.rooms?.update();const roomBuildMs=performance.now()-begin,roomCount=walls.rooms?.rooms.length??0;
  const query=index=>{
   let start,goal;
   if(scenario==='sealed'||scenario==='detour'){start={column:size/4+index%Math.min(10,size/16),row:size/4+Math.floor(index/10)%Math.min(10,size/4)};goal={column:3*size/4,row:start.row};}
   else {start={column:1+(index%Math.floor(size/step))*step,row:1+(Math.floor(index/Math.floor(size/step))%Math.floor(size/step))*step};goal={column:start.column+2,row:start.row+1};}
   const path=api.findPath(start,goal,size,walls.isBlocked,walls.cannotStop);assert.equal(!!path,scenario!=='sealed');return path?.distance??null;
  };
  begin=performance.now();const distance=query(0),firstQueryMs=performance.now()-begin;begin=performance.now();for(let i=1;i<queryCount;i++)query(i);const remainingQueriesMs=performance.now()-begin;
  let rebuildMs=0;
  if(walls.rooms){const wall=walls.plan({column:2,row:2},'wood');walls.complete(wall);begin=performance.now();walls.rooms.update();walls.rooms.reachable({column:1,row:1},{column:3,row:3},true);rebuildMs=performance.now()-begin;}
  samples.push({roomBuildMs,firstQueryMs,remainingQueriesMs,totalMs:roomBuildMs+firstQueryMs+remainingQueriesMs,rebuildMs,roomCount,structureLookups:lookups,distance});
 }
 const mean=key=>samples.reduce((n,s)=>n+s[key],0)/samples.length;
 results.push({size,scenario,version,queryCount,meanRoomBuildMs:mean('roomBuildMs'),meanFirstQueryMs:mean('firstQueryMs'),meanRemainingQueriesMs:mean('remainingQueriesMs'),meanTotalMs:mean('totalMs'),meanRebuildMs:mean('rebuildMs'),samples});
}
for(const row of results.filter(row=>row.version==='after')){const baseline=results.find(other=>other.size===row.size&&other.scenario===row.scenario&&other.version==='before');for(let i=0;i<row.samples.length;i++){const a=row.samples[i].distance,b=baseline.samples[i].distance;assert.ok(a===null?b===null:Math.abs(a-b)<1e-8);}}
if(results.length)writeFileSync('docs/performance/rooms-scaling.json',JSON.stringify({baseline:'df27a3d',node:process.version,runs:3,results},null,2)+'\n');console.log(JSON.stringify(results.map(({samples,...r})=>r)));

const updates=[];
for(const size of [32,320])for(let run=0;run<3;run++){
 const {walls,step}=scene(after,size,'rooms'),regions=walls.rooms;regions.update();
 const generation=regions.generation,door=regions.doors.find(link=>link.roomIds.length===2).door;
 const vertical=door.column%step===0;
 const start={column:door.column-(vertical?1:0),row:door.row-(vertical?0:1)},goal={column:door.column+(vertical?1:0),row:door.row+(vertical?0:1)};
 regions.reachable(start,goal,true);let begin=performance.now();assert.equal(regions.reachable(start,goal,false),false);const initialOtherMs=performance.now()-begin;
 const edits=[];
 for(let edit=0;edit<10;edit++){
  const open=edit%2===0;walls.setDoorOpenness(door,open?.1:0);
  begin=performance.now();regions.update();const roomUpdateMs=performance.now()-begin;
  begin=performance.now();assert.ok(regions.reachable(start,goal,true));const playerQueryMs=performance.now()-begin;
  begin=performance.now();assert.equal(regions.reachable(start,goal,false),open);const otherRebuildMs=performance.now()-begin;
  assert.equal(regions.generation,generation);edits.push({open,roomUpdateMs,playerQueryMs,otherRebuildMs});
 }
 updates.push({size,run,rooms:regions.rooms.length,typedArrayBytes:Object.values(regions).filter(ArrayBuffer.isView).reduce((n,array)=>n+array.byteLength,0),initialOtherMs,edits});
}
writeFileSync('docs/performance/rooms-updates.json',JSON.stringify(updates,null,2)+'\n');
