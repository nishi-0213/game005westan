// Node-only pathfinding comparison; no rendering and no game map-size change.
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const before=await import(pathToFileURL(resolve(process.argv[2]??'/workspace/scratch/target-search-baseline','src/pathfinding.ts')));
const after=await import('../src/pathfinding.ts');
const results=[];
for(const size of [32,320])for(const scenario of ['near-move','nearest-target','long-move','detour']){
 const start=scenario==='long-move'?{column:1,row:1}:{column:Math.floor(size/4),row:Math.floor(size/4)};
 const goal=scenario==='long-move'?{column:size-2,row:size-2}:scenario==='detour'?{column:Math.floor(size*3/4),row:start.row}:{column:start.column+2,row:start.row+1};
 let expected;
 for(const [version,api]of [['before',before],['after',after]]){
  const samples=[];
  for(let run=0;run<3;run++){
   let terrainChecks=0;const blocked=tile=>{terrainChecks++;return scenario==='detour'&&tile.column===Math.floor(size/2)&&tile.row!==size-3;},cannotStop=()=>false;
   api.registerPathCache(blocked);const begin=performance.now();let path;
   if(scenario==='nearest-target'){for(const [index,p]of api.findPaths(start,size,blocked,cannotStop))if(index===goal.row*size+goal.column){path=p;break;}}
   else path=api.findPath(start,goal,size,blocked,cannotStop);
   assert.ok(path);const tiles=path.tiles;assert.deepEqual(tiles.at(-1),goal);const elapsedMs=performance.now()-begin;
   if(expected===undefined)expected=path.distance;else assert.ok(Math.abs(expected-path.distance)<1e-8);
   samples.push({elapsedMs,terrainChecks,distance:path.distance,steps:tiles.length});
  }
  results.push({size,scenario,version,meanMs:samples.reduce((n,x)=>n+x.elapsedMs,0)/samples.length,samples});
 }
}
writeFileSync('docs/performance/target-search-scaling.json',JSON.stringify({node:process.version,baseline:'23a4d3f',runs:3,results},null,2)+'\n');
console.log(JSON.stringify(results.map(({samples,...r})=>({...r,terrainChecks:samples[0].terrainChecks}))));
