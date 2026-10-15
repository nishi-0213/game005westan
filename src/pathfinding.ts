import { canPlan } from './path-schedule.ts';
import type { Movement, Tile } from './movement';
import {HierarchicalMap} from './hierarchical-path.ts';
import { advanceMovement, setRoute, stopAtNextSafeTile } from './movement.ts';

export interface Path { tiles: Tile[]; distance: number }
type TileRule = (tile: Tile) => boolean;
const hierarchies=new WeakMap<TileRule,HierarchicalMap>();
export function registerHierarchy(blocked:TileRule,size:number,snapshot:()=>Uint8Array):void{hierarchies.set(blocked,new HierarchicalMap(size,snapshot));}
export function invalidateHierarchy(blocked:TileRule,tiles:readonly Tile[]):void{hierarchies.get(blocked)?.invalidate(tiles);}
const reachability = new WeakMap<TileRule,(start:Tile,goal:Tile)=>boolean>();
export function registerReachability(blocked:TileRule,connected:(start:Tile,goal:Tile)=>boolean):void{reachability.set(blocked,connected);}
const caches = new WeakMap<TileRule, WeakMap<TileRule, Map<string, Map<number, Path>>>>();
const failedPaths = new WeakMap<TileRule, WeakMap<TileRule, Set<string>>>();
const cacheGroups = new WeakMap<TileRule,Set<TileRule>>();
export function registerPathCache(blocked: TileRule, sharedWith?: TileRule): void {
  caches.set(blocked,new WeakMap());
  failedPaths.set(blocked,new WeakMap());
  const group=cacheGroups.get(sharedWith??blocked);
  const members=group??new Set<TileRule>();members.add(blocked);if(sharedWith)members.add(sharedWith);
  for(const member of members)cacheGroups.set(member,members);
}
export function invalidatePaths(blocked: TileRule): void {
  for(const member of cacheGroups.get(blocked)??[blocked])if(caches.has(member)){caches.set(member,new WeakMap());failedPaths.set(member,new WeakMap());}
}

// Keep terrain searches shared; occupancy only filters possible stopping points.
class AvailablePaths extends Map<number, Path> {
  private paths: Map<number, Path>;
  private movement: Movement;
  private mapSize: number;
  constructor(paths: Map<number, Path>, movement: Movement, size: number) {
    super(); this.paths = paths; this.movement = movement; this.mapSize = size;
  }
  override get(index: number): Path | undefined {
    if (this.movement.stopBlocked?.({ column: index % this.mapSize, row: Math.floor(index / this.mapSize) })) return undefined;
    return this.paths.get(index);
  }
  override has(index: number): boolean { return this.get(index) !== undefined; }
  override *entries(): MapIterator<[number, Path]> { for (const [index, path] of this.paths) if (this.has(index)) yield [index, path]; }
  override *keys(): MapIterator<number> { for (const [index] of this.entries()) yield index; }
  override *values(): MapIterator<Path> { for (const [, path] of this.entries()) yield path; }
  override [Symbol.iterator](): MapIterator<[number, Path]> { return this.entries(); }
  override get size(): number { let count = 0; for (const _ of this.keys()) count++; return count; }
  override forEach(callback: (value: Path, key: number, map: Map<number, Path>) => void, thisArg?: unknown): void {
    for (const [index, path] of this) callback.call(thisArg, path, index, this);
  }
}

// Expand only when a caller asks for another settled endpoint.
function* search(start: Tile, size: number, blocked: TileRule, cannotStop: TileRule,
  heuristic: (tile: Tile) => number = () => 0, onLarge?:()=>void, endpoint?:number): Generator<[number, Path|undefined]> {
  const key = ({ column, row }: Tile) => row * size + column;
  const distances = new Map<number, number>([[key(start), 0]]);
  const previous = new Map<number, Tile>();
  const open: { tile: Tile; cost: number; priority: number; order: number }[] = [];
  let order = 0;
  const less = (a: (typeof open)[number], b: (typeof open)[number]) => a.priority < b.priority || a.priority === b.priority && (a.cost > b.cost || a.cost === b.cost && a.order < b.order);
  const push = (tile: Tile, cost: number) => {
    const node = { tile, cost, priority: cost + heuristic(tile), order: order++ }; open.push(node);
    let index = open.length - 1;
    while (index > 0) { const parent = (index - 1) >> 1; if (!less(node, open[parent])) break; open[index] = open[parent]; index = parent; }
    open[index] = node;
  };
  const pop = () => {
    const first = open[0], last = open.pop()!;
    if (open.length) {
      let index = 0;
      while (index * 2 + 1 < open.length) {
        let child = index * 2 + 1;
        if (child + 1 < open.length && less(open[child + 1], open[child])) child++;
        if (!less(open[child], last)) break;
        open[index] = open[child]; index = child;
      }
      open[index] = last;
    }
    return first;
  };
  push({ ...start }, 0);
  const closed = new Set<number>();
  while (open.length) {
    const node = pop(), current = node.tile, currentKey = key(current);
    if (closed.has(currentKey) || node.cost !== distances.get(currentKey)) continue;
    if ((endpoint===undefined||currentKey===endpoint) && !blocked(current) && !cannotStop(current)) {
      let tiles: Tile[] | undefined;
      yield [currentKey, { distance: node.cost, get tiles() {
        if (!tiles) {
          tiles = []; let cursor = current;
          while (key(cursor) !== key(start)) { tiles.push(cursor); cursor = previous.get(key(cursor))!; }
          tiles.reverse();
        }
        return tiles;
      } }];
    }else yield [currentKey,undefined];
    closed.add(currentKey);
    if(closed.size===4096)onLarge?.();
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const next = { column: current.column + dc, row: current.row + dr };
      if (next.column < 0 || next.row < 0 || next.column >= size || next.row >= size || blocked(next)) continue;
      if (dc && dr && (blocked({ column: next.column, row: current.row }) || blocked({ column: current.column, row: next.row }))) continue;
      const nextKey = key(next), cost = node.cost + (dc && dr ? Math.SQRT2 : 1);
      if (cost < (distances.get(nextKey) ?? Infinity)) { distances.set(nextKey, cost); previous.set(nextKey, current); push(next, cost); }
    }
  }
}

class IncrementalPaths extends Map<number, Path> {
  private readonly iterator: Generator<[number, Path|undefined]>;
  private readonly ordered: [number, Path][] = [];
  private readonly valid: (index: number) => boolean;
  private finished = false;
  private readonly failures?:Set<string>;
  private readonly failureKey:(index:number)=>string;
  constructor(start: Tile, size: number, blocked: TileRule, cannotStop: TileRule, onLarge: () => void, failures?:Set<string>) {
    super();
    this.iterator = search(start, size, blocked, cannotStop,()=>0,onLarge);
    this.failures=failures;
    this.failureKey=index=>`${size}:${start.column},${start.row}:${index%size},${Math.floor(index/size)}`;
    const connected=reachability.get(blocked);
    this.valid = index => Number.isInteger(index) && index >= 0 && index < size * size
      && !blocked({column:index % size,row:Math.floor(index / size)})
      && !cannotStop({column:index % size,row:Math.floor(index / size)})
      && (!connected||connected(start,{column:index%size,row:Math.floor(index/size)}));
  }
  private advance(): boolean {
    if(this.finished)return false;
    let next=this.iterator.next();
    while(!next.done&&!next.value[1])next=this.iterator.next();
    if(next.done){this.finished=true;return false;}
    const [index,path]=next.value;super.set(index,path!);this.ordered.push([index,path!]);
    return true;
  }
  override get(index:number):Path|undefined {
    if(super.has(index))return super.get(index);
    if(!this.valid(index))return undefined;
    const key=this.failureKey(index);
    if(this.failures?.has(key))return undefined;
    while(!super.has(index)&&this.advance()){}
    if(!super.has(index)&&this.failures){this.failures.add(key);if(this.failures.size>256)this.failures.delete(this.failures.values().next().value!);}
    return super.get(index);
  }
  override has(index:number):boolean{return this.get(index)!==undefined;}
  override *entries():MapIterator<[number,Path]> {
    let cursor=0;
    while(cursor<this.ordered.length||this.advance())yield this.ordered[cursor++];
  }
  override *keys():MapIterator<number>{for(const [index]of this.entries())yield index;}
  override *values():MapIterator<Path>{for(const [,path]of this.entries())yield path;}
  override [Symbol.iterator]():MapIterator<[number,Path]>{return this.entries();}
  override get size():number{while(this.advance()){}return super.size;}
  override forEach(callback:(value:Path,key:number,map:Map<number,Path>)=>void,thisArg?:unknown):void{
    for(const [index,path]of this)callback.call(thisArg,path,index,this);
  }
}

function failurePolicy(blocked:TileRule,cannotStop:TileRule):Set<string>|undefined{
  const group=failedPaths.get(blocked);let failures=group?.get(cannotStop);
  if(group&&!failures){failures=new Set();group.set(cannotStop,failures);}
  return failures;
}

export function findPaths(start: Tile, size: number, blocked: TileRule, cannotStop: TileRule, movement?: Movement): Map<number, Path> {
  blocked = movement?.terrainBlocked ?? blocked;
  if(movement?.stopBlocked)return new AvailablePaths(findPaths(start,size,blocked,cannotStop),movement,size);
  const cache=caches.get(blocked);
  let policy=cache?.get(cannotStop);
  if(cache&&!policy){policy=new Map();cache.set(cannotStop,policy);}
  const key=`${size}:${start.column},${start.row}`,cached=policy?.get(key);
  if(cached){policy!.delete(key);policy!.set(key,cached);return cached;}
  const paths=new IncrementalPaths(start,size,blocked,cannotStop,()=>{if(policy?.get(key)===paths)policy.delete(key);},failurePolicy(blocked,cannotStop));
  if(policy){policy.set(key,paths);if(policy.size>16)policy.delete(policy.keys().next().value!);}
  return paths;
}

/** First try exact A*. A difficult large-map query switches to a chunk corridor. */
export function* pathSearch(start:Tile,goal:Tile,size:number,blocked:TileRule,cannotStop:TileRule,movement?:Movement):Generator<void,Path|null>{
  blocked=movement?.terrainBlocked??blocked;
  if(goal.column<0||goal.row<0||goal.column>=size||goal.row>=size||blocked(goal)||cannotStop(goal)||movement?.stopBlocked?.(goal))return null;
  if(reachability.get(blocked)?.(start,goal)===false)return null;
  const failures=failurePolicy(blocked,cannotStop),failureKey=`${size}:${start.column},${start.row}:${goal.column},${goal.row}`;
  if(failures?.has(failureKey))return null;
  const heuristic=(tile:Tile)=>{const dx=Math.abs(tile.column-goal.column),dy=Math.abs(tile.row-goal.row);return Math.max(dx,dy)+(Math.SQRT2-1)*Math.min(dx,dy);};
  const target=goal.row*size+goal.column,direct=search(start,size,blocked,cannotStop,heuristic,undefined,target);let expanded=0;
  while(true){const next=direct.next();if(next.done)break;if(next.value[0]===target&&next.value[1])return next.value[1];yield;
    if(++expanded===256&&size>=64){const hierarchy=hierarchies.get(blocked);if(hierarchy){const corridor=yield* hierarchy.corridor(start,goal);if(corridor){
      const restricted=(tile:Tile)=>blocked(tile)||!corridor.has(hierarchy.labels[tile.row*size+tile.column]);
      for(const [index,path]of search(start,size,restricted,cannotStop,heuristic,undefined,target)){if(index===target&&path)return path;yield;}
    }}}
  }
  if(failures){failures.add(failureKey);if(failures.size>256)failures.delete(failures.values().next().value!);}
  return null;
}

/** Synchronous query API; queued movement requests drain the same generator over frames. */
export function findPath(start:Tile,goal:Tile,size:number,blocked:TileRule,cannotStop:TileRule,movement?:Movement):Path|null{
  const job=pathSearch(start,goal,size,blocked,cannotStop,movement);while(true){const next=job.next();if(next.done)return next.value;}
}

export interface PathCandidate<T>{target:T;goal:Tile}
/** Stop after the closest eligible target is settled, retaining candidate-order ties. */
export function findNearest<T>(start:Tile,size:number,blocked:TileRule,cannotStop:TileRule,candidates:readonly PathCandidate<T>[],movement?:Movement,maxDistance=Infinity,accept?:(target:T)=>boolean):{target:T;goal:Tile;path:Path}|null{
  blocked=movement?.terrainBlocked??blocked;
  const failures=failurePolicy(blocked,cannotStop);
  const prefix=`${size}:${start.column},${start.row}:`;
  const goals=new Map<number,{candidate:PathCandidate<T>;order:number}[]>();
  for(let order=0;order<candidates.length;order++){
    const candidate=candidates[order],g=candidate.goal;
    if(g.column<0||g.row<0||g.column>=size||g.row>=size||blocked(g)||cannotStop(g)||movement?.stopBlocked?.(g))continue;
    if(reachability.get(blocked)?.(start,g)===false||failures?.has(`${prefix}${g.column},${g.row}`))continue;
    const key=g.row*size+g.column,list=goals.get(key)??[];list.push({candidate,order});goals.set(key,list);
  }
  if(!goals.size)return null;
  let best:{target:T;goal:Tile;path:Path}|null=null,bestOrder=Infinity;
  const paths=findPaths(start,size,blocked,cannotStop,movement);
  let exhausted=true;
  for(const [index,path]of paths){
    if(path.distance>maxDistance||best&&path.distance>best.path.distance+1e-10){exhausted=false;break;}
    for(const {candidate,order}of goals.get(index)??[])if(order<bestOrder&&(!accept||accept(candidate.target))){best={...candidate,path};bestOrder=order;}
  }
  if(!best&&exhausted)for(const index of goals.keys())paths.get(index);
  return best;
}

interface RouteRequest{movement:Movement;goal:Tile;size:number;blocked:TileRule;cannotStop:TileRule;revision:number;task?:Generator<void,Path|null>;token:{goal:Tile;cancel:()=>void}}
const requests=new Set<RouteRequest>();
const activeRequests=new Set<RouteRequest>();
const revisionOf=(blocked:TileRule)=>hierarchies.get(blocked)?.revision??0;

/** One shared real-frame budget. Four active searches bound retained frontier memory. */
export function advancePathRequests(maxSteps=4096,maxMs=2):{steps:number;pending:number;elapsedMs:number}{
  const started=performance.now();let steps=0,waiting=0;
  while(requests.size&&steps<maxSteps&&performance.now()-started<maxMs){
    const job=activeRequests.size<4?requests.values().next().value!:[...requests].find(request=>activeRequests.has(request));
    if(!job)break;
    requests.delete(job);const m=job.movement;
    if(m.pendingRoute!==job.token){activeRequests.delete(job);continue;}
    if(m.nextTile||m.tile.column!==m.destination.column||m.tile.row!==m.destination.row){requests.add(job);if(++waiting>=requests.size)break;continue;}
    waiting=0;const blocked=m.terrainBlocked??job.blocked,revision=revisionOf(blocked);
    if(!job.task||job.blocked!==blocked||job.revision!==revision){job.blocked=blocked;job.revision=revision;job.task=pathSearch({...m.tile},job.goal,job.size,blocked,job.cannotStop,m);}
    activeRequests.add(job);
    // Small quanta reduce generator switching while retaining a shared time budget.
    let finished=false;
    for(let quantum=0;quantum<32&&steps<maxSteps&&performance.now()-started<maxMs;quantum++){
      const next=job.task.next();steps++;
      if(next.done){finished=true;job.token.cancel();if(next.value&&!blocked(job.goal)&&!job.cannotStop(job.goal)&&!m.stopBlocked?.(job.goal))setRoute(m,next.value.tiles);break;}
    }
    if(!finished)requests.add(job);
  }
  return {steps,pending:requests.size,elapsedMs:performance.now()-started};
}

export function commandMove(movement: Movement, goal: Tile, size: number, blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean): boolean {
  if(movement.queuedPlanning){
    blocked=movement.terrainBlocked??blocked;
    if(goal.column<0||goal.row<0||goal.column>=size||goal.row>=size||blocked(goal)||cannotStop(goal)||movement.stopBlocked?.(goal)||reachability.get(blocked)?.(movement.nextTile??movement.tile,goal)===false)return false;
    stopAtNextSafeTile(movement,cannotStop);delete movement.pendingRepath;
    const token={goal:{...goal},cancel:()=>{requests.delete(job);activeRequests.delete(job);if(movement.pendingRoute===token){delete movement.pendingRoute;movement.changed?.();}}};
    const job:RouteRequest={movement,goal:token.goal,size,blocked,cannotStop,revision:revisionOf(blocked),token};
    movement.pendingRoute=token;requests.add(job);movement.changed?.();return true;
  }
  const path = findPath(movement.nextTile ?? movement.tile, goal, size, blocked, cannotStop, movement);
  if (!path) return false;
  return setRoute(movement, path.tiles);
}

export function advancePathMovement(movement: Movement, seconds: number, size: number, blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean): void {
  blocked = movement?.terrainBlocked ?? blocked;
  if(movement.pendingRoute&&!movement.nextTile&&movement.tile.column===movement.destination.column&&movement.tile.row===movement.destination.row)return;
  if(movement.pendingRepath){
    if(!canPlan(movement))return;
    const pending=movement.pendingRepath;delete movement.pendingRepath;
    commandMove(movement,pending,size,blocked,cannotStop);
  }
  if(!canPlan(movement)&&(movement.reservationBlocked?.(movement.destination)||movement.nextTile&&blocked(movement.nextTile)))return;
  // A death or blocked route can create a new stationary occupant after orders were issued.
  // Passing pawns do not displace a pawn that is waiting at its reserved destination.
  if (movement.reservationBlocked?.(movement.destination)) {
    const paths = findPaths(movement.nextTile ?? movement.tile, size, blocked, cannotStop, movement);
    let nearest: Path | undefined;
    let distance = Infinity;
    for (const [index, path] of paths) {
      const candidateDistance = Math.hypot(index % size - movement.destination.column, Math.floor(index / size) - movement.destination.row);
      if (candidateDistance < distance) { distance = candidateDistance; nearest = path; }
    }
    if (nearest) setRoute(movement, nearest.tiles);
  }
  const goal = { ...movement.destination };
  const hadRoute = movement.route !== undefined;
  advanceMovement(movement, seconds, blocked, cannotStop);
  if (hadRoute && (movement.destination.column !== goal.column || movement.destination.row !== goal.row)) {
    if(!canPlan(movement)){movement.pendingRepath=goal;return;}
    if (!commandMove(movement, goal, size, blocked, cannotStop) && movement.stopBlocked?.(movement.destination)) {
      const paths = findPaths(movement.tile, size, blocked, cannotStop, movement);
      const nearest = paths.values().next().value;
      if (nearest) setRoute(movement, nearest.tiles);
    }
  }
}

/** Lower bound to any adjacent approach; sorting avoids probing distant targets. */
export function rankedTargets<T extends Tile>(targets:readonly T[],from:Tile,adjacent=true):{target:T;order:number;lowerBound:number}[]{
  return targets.map((target,order)=>{
    const dx=Math.max(0,Math.abs(target.column-from.column)-(adjacent?1:0));
    const dy=Math.max(0,Math.abs(target.row-from.row)-(adjacent?1:0));
    return {target,order,lowerBound:Math.max(dx,dy)+(Math.SQRT2-1)*Math.min(dx,dy)};
  }).sort((a,b)=>a.lowerBound-b.lowerBound||a.order-b.order);
}
