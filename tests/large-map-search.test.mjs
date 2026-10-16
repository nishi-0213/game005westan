import test from 'node:test';
import assert from 'node:assert/strict';
import {findPaths,findNearest} from '../src/pathfinding.ts';
const open=()=>false;
test('distant128x128 point lookups use directed search and preserve ordered path iteration',()=>{
 let calls=0;const blocked=()=>{calls++;return false;};
 const paths=findPaths({column:64,row:64},128,blocked,open),path=paths.get(120*128+120);
 assert.ok(Math.abs(path.distance-56*Math.SQRT2)<1e-9);assert.deepEqual(path.tiles.at(-1),{column:120,row:120});assert.ok(calls<3000,`${calls} terrain checks`);
 const first=paths.entries().next().value;assert.equal(first[0],64*128+64);assert.equal(first[1].distance,0);assert.equal(paths.get(120*128+120),path);
});
test('large-map nearest target search remains exact around obstacles and respects candidate ties, rejection, and distance limits',()=>{
 const size=64,start={column:4,row:4};const blocked=t=>t.column===20&&t.row<55||t.column===50&&t.row>10;const cannotStop=t=>t.column===18;
 const reference=new Map(findPaths(start,size,blocked,cannotStop));
 const candidates=[{target:'a',goal:{column:30,row:4}},{target:'b',goal:{column:4,row:40}},{target:'c',goal:{column:4,row:40}},{target:'d',goal:{column:60,row:60}}];
 for(const accept of [undefined,t=>t!=='b',t=>t==='a',()=>false]){
  const expected=candidates.filter(c=>!accept||accept(c.target)).map(c=>({...c,path:reference.get(c.goal.row*size+c.goal.column)})).filter(c=>c.path).sort((a,b)=>a.path.distance-b.path.distance)[0];
  const actual=findNearest(start,size,blocked,cannotStop,candidates,undefined,Infinity,accept);
  assert.equal(actual?.target,expected?.target);if(actual)assert.ok(Math.abs(actual.path.distance-expected.path.distance)<1e-9);
 }
 assert.equal(findNearest(start,size,blocked,cannotStop,candidates,undefined,10),null);
 const paths=findPaths(start,size,blocked,cannotStop),point=paths.get(4*size+30);assert.ok(Math.abs(point.distance-reference.get(4*size+30).distance)<1e-9);
});
test('large-map point lookups reject sealed and forbidden stopping cells',()=>{
 const blocked=t=>t.column===32,cannotStop=t=>t.column===12;
 const paths=findPaths({column:4,row:4},64,blocked,cannotStop);
 assert.equal(paths.get(4*64+40),undefined);assert.equal(paths.get(4*64+12),undefined);assert.equal(paths.get(-1),undefined);
});

test('128x128 melee and rifle approaches stop at the nearest valid attack position',async()=>{
 const {Walls}=await import('../src/walls.ts'),{Construction}=await import('../src/construction.ts'),{Harvesting}=await import('../src/harvesting.ts'),{Hauling}=await import('../src/hauling.ts'),{Storage}=await import('../src/storage.ts'),{Combat}=await import('../src/combat.ts'),{createDeer}=await import('../src/wildlife.ts');
 for(const [weapon,goal] of [['unarmed',{column:119,row:119}],['rifle',{column:106,row:106}]]){
  const walls=new Walls(128),items=[],construction=new Construction(walls,items,()=>{}),harvesting=new Harvesting([],items,walls),hauling=new Hauling(items,new Storage(walls)),combat=new Combat(construction,harvesting,hauling);
  const attacker={...createDeer({column:64,row:64},1),kind:'human',faction:'player',mode:'drafted',weapon},target=createDeer({column:120,row:120},2);
  assert.equal(combat.requestAttack(attacker,target),true);assert.deepEqual(attacker.movement.destination,goal);assert.equal(combat.canFireFrom(weapon,goal,target.movement.tile),true);
 }
});
