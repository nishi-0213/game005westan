import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]??'/workspace/scratch/hierarchy-baseline');
const before={...await import(pathToFileURL(`${root}/src/walls.ts`)),...await import(pathToFileURL(`${root}/src/pathfinding.ts`))};
const after={...await import('../src/walls.ts'),...await import('../src/pathfinding.ts')};
const {createMovement}=await import('../src/movement.ts');
function scene(api,size,scenario){const walls=new api.Walls(size);if(scenario!=='near')for(let row=0;row<size;row++)if(row!==size-3){const item=walls.plan({column:size/2+(scenario==='split-chunk'?5:0),row},'wood');walls.complete(item);}return walls;}
function validate(path,start,goal,walls){assert.deepEqual(path.tiles.at(-1)??start,goal);let previous=start;for(const tile of path.tiles){assert.ok(!walls.isBlocked(tile));const dx=Math.abs(tile.column-previous.column),dy=Math.abs(tile.row-previous.row);assert.equal(Math.max(dx,dy),1);if(dx&&dy){assert.ok(!walls.isBlocked({column:tile.column,row:previous.row}));assert.ok(!walls.isBlocked({column:previous.column,row:tile.row}));}previous=tile;}}
const rows=[];
for(const size of [32,320])for(const scenario of ['near','long-wall','split-chunk'])for(const [version,api]of [['before',before],['after',after]]){
 const samples=[];for(let run=0;run<3;run++){const walls=scene(api,size,scenario),moves=[];for(let i=0;i<8;i++){const start={column:size/4,row:size/4+i},goal={column:scenario==='near'?start.column+2:3*size/4,row:scenario==='near'?start.row+1:start.row},begin=performance.now(),path=api.findPath(start,goal,size,walls.isBlocked,walls.cannotStop),ms=performance.now()-begin;assert.ok(path);validate(path,start,goal,walls);moves.push({ms,distance:path.distance});}samples.push({coldMs:moves[0].ms,warmMeanMs:moves.slice(1).reduce((n,x)=>n+x.ms,0)/7,moves});}
 rows.push({size,scenario,version,samples,meanColdMs:samples.reduce((n,x)=>n+x.coldMs,0)/3,meanWarmMs:samples.reduce((n,x)=>n+x.warmMeanMs,0)/3});
}
for(const row of rows.filter(r=>r.version==='after')){const old=rows.find(r=>r.size===row.size&&r.scenario===row.scenario&&r.version==='before');row.maxDistanceRatio=Math.max(...row.samples.flatMap((sample,i)=>sample.moves.map((m,j)=>m.distance/old.samples[i].moves[j].distance)));}
const walls=scene(after,320,'long-wall'),workers=Array.from({length:100},(_,i)=>{const m=createMovement({column:80,row:20+i});m.queuedPlanning=true;return m});let begin=performance.now();for(const [i,m]of workers.entries())assert.ok(after.commandMove(m,{column:240,row:20+i},320,walls.isBlocked,walls.cannotStop));const acceptMs=performance.now()-begin,slices=[];begin=performance.now();for(let i=0;i<20000;i++){const slice=after.advancePathRequests();slices.push(slice);if(!slice.pending)break;}assert.ok(workers.every(m=>!m.pendingRoute));for(const [i,m]of workers.entries())validate({tiles:m.route},m.tile,{column:240,row:20+i},walls);const queue={pawns:100,acceptMs,totalMs:performance.now()-begin,sliceCount:slices.length,maxSliceMs:Math.max(...slices.map(s=>s.elapsedMs)),maxSteps:Math.max(...slices.map(s=>s.steps)),slices};
writeFileSync('docs/performance/hierarchy-scaling.json',JSON.stringify({baseline:'678d9d7',rows,queue},null,2)+'\n');console.log(JSON.stringify({rows:rows.map(({samples,...row})=>row),queue:{...queue,slices:undefined}}));
