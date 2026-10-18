import test from 'node:test';
import assert from 'node:assert/strict';
import {Walls} from '../src/walls.ts';
import {createEnvironment} from '../src/environment.ts';
import {shootingObstacles} from '../src/shooting.ts';
const tile=(column,row)=>({column,row});
function scene(){const walls=new Walls(32),objects=new Map();walls.environmentAt=t=>objects.get(`${t.column},${t.row}`);return {walls,plant(type,column,row){const o=createEnvironment(type,tile(column,row));objects.set(`${column},${row}`,o);return o;},build(kind,column,row,completed=true){const w=walls.plan(tile(column,row),'wood',kind);if(completed)walls.complete(w);return w;},shot(from=tile(2,5),to=tile(10,5),target){return shootingObstacles(walls,from,to,target);}};}
test('barricades protect only targets within one tile and on the shot ray',()=>{
 for(const [column,row,expected] of [[9,5,.4],[8,5,0],[3,5,0],[9,4,0],[10,4,0],[11,5,0]]){const s=scene();s.build('barricade',column,row);assert.equal(s.shot().accuracyPenalty,expected,`${column},${row}`);assert.equal(s.shot().blocked,false);}
 const s=scene();s.build('barricade',9,9);assert.equal(s.shot(tile(2,2),tile(10,10)).accuracyPenalty,.4);
 const p=scene();p.build('barricade',9,5,false);assert.equal(p.shot().accuracyPenalty,0);
});
test('trees and rocks on the ray near the target reduce accuracy by twenty points, until removed',()=>{
 for(const type of ['tree','rock']){const s=scene(),object=s.plant(type,9,5);assert.equal(s.shot().accuracyPenalty,.2);assert.equal(s.shot().blocked,false);object.collect=true;assert.equal(s.shot().accuracyPenalty,.2);object.collected=true;assert.equal(s.shot().accuracyPenalty,0);
 for(const pos of [[8,5],[3,5],[9,4],[11,5]]){const other=scene();other.plant(type,...pos);assert.equal(other.shot().accuracyPenalty,0);}
 const diagonal=scene();diagonal.plant(type,9,9);assert.equal(diagonal.shot(tile(2,2),tile(10,10)).accuracyPenalty,.2);
 }
 for(const type of ['grass','wildStrawberry']){const s=scene();s.plant(type,9,5);assert.equal(s.shot().accuracyPenalty,0);}
});
test('cover uses the strongest penalty and excludes the shooter and attacked structure itself',()=>{
 const s=scene();s.build('barricade',9,5);s.plant('tree',9,5);s.plant('rock',10,5);assert.equal(s.shot().accuracyPenalty,.4);
 const trees=scene();trees.plant('tree',9,5);trees.plant('rock',10,5);assert.equal(trees.shot().accuracyPenalty,.2);
 const self=scene();self.build('barricade',9,5);assert.equal(self.shot(tile(9,5)).accuracyPenalty,0);
 const target=scene(),b=target.build('barricade',10,5);assert.equal(target.shot(tile(2,5),tile(10,5),b).accuracyPenalty,0);
});
test('walls and doors still block the full ray even when far from the target',()=>{
 for(const kind of ['wall','door']){const s=scene();s.build(kind,5,5);assert.equal(s.shot().blocked,true);}
});
