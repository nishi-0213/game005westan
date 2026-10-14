import { Application, Container, Graphics, Text } from 'pixi.js';
import './style.css';
import { createMovement, movementHasSafeExit, renderedPosition, stopAtNextSafeTile } from './movement';
import { advancePathMovement } from './pathfinding';
import { PawnOccupancy, commandGroup } from './pawn-occupancy';
import { CorpseEating } from './corpse-eating';
import { Hunting } from './hunting';
import { Combat, WEAPONS, ATTACK_INTERVAL } from './combat';
import type { CombatPawn, Weapon } from './combat';
import { AttackEffects } from './attack-effects';
import { attackRangeEdges } from './attack-range';
import { SimulationClock } from './simulation-clock';
import type { GameSpeed } from './simulation-clock';
import { initialNeeds, requestEat, updateNeeds } from './needs';
import type { EatingWorker } from './needs';
import type { Corpse } from './butchery';
import type { MapItem } from './items';
import { Butchery, BUTCHER_SECONDS, adjustButcherCount, corpsePosition, corpseItemType } from './butchery';
import type { Tile } from './movement';
import { BUILD_RECIPES, dragTiles, footprint, Walls, WALL_COLORS, WALL_PLAN_ALPHA } from './walls';
import type { ConstructionKind, WallMaterial, Wall } from './walls';
import { nearbyItems, initialItems, foodNutrition, ITEM_APPEARANCE, ITEM_TYPES, returnItems, isWeaponItem } from './items';
import { Storage } from './storage';
import { Hauling } from './hauling';
import type { HaulWorker } from './hauling';
import { Clearing } from './clearing';
import { Construction } from './construction';
import { demolishStructure, destroyStructure } from './demolition';
import { ENVIRONMENT_PROPERTIES, harvestYield, initialEnvironment, nearbySameType } from './environment';
import type { EnvironmentObject } from './environment';
import { PlantGrowth } from './plant-growth';
import { Wildlife, deerAction } from './wildlife';
import type { Deer, Animal } from './wildlife';
import { FACTIONS, isPlayerControlled } from './factions';
import type { Faction } from './factions';
import { Harvesting } from './harvesting';
import type { HarvestWorker } from './harvesting';
import { formatPawnName, generatePawnNames } from './pawn-names';
import { currentAction, INITIAL_PRIORITIES, nextPriority, updateWork } from './work-priorities';

const MAP_SIZE = 32;
const TILE_SIZE = 24;
const MAP_PIXELS = MAP_SIZE * TILE_SIZE;
const RENDER_RESOLUTION = Math.max(2, window.devicePixelRatio || 1);
const app = new Application();

await app.init({
  resizeTo: window,
  background: '#151d19',
  antialias: true,
  resolution: RENDER_RESOLUTION,
  autoDensity: true,
});
document.body.appendChild(app.canvas);
app.canvas.setAttribute('aria-label', 'れ・こんきすた。32×32マスのマップと中央の3人のポーン');
document.addEventListener('contextmenu', (event) => event.preventDefault());

const map = new Container();
// Input is handled by native canvas listeners; no Pixi scene hit testing is needed.
map.eventMode = 'none';
function createProgressBar(): { view: Container; fill: Graphics } {
  const view = new Container();
  const background = new Graphics().rect(0, 0, TILE_SIZE, 4).fill(0x152019);
  const fill = new Graphics().rect(0, 0, TILE_SIZE - 2, 2).fill(0xf2c66d);
  fill.position.set(1, 1);
  view.addChild(background, fill);
  view.visible = false;
  return { view, fill };
}
const terrain = new Graphics();
for (let row = 0; row < MAP_SIZE; row++) {
  for (let column = 0; column < MAP_SIZE; column++) {
    terrain.rect(column * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE)
      .fill((row + column) % 2 === 0 ? 0x52684a : 0x4c6245);
  }
}
for (let line = 0; line <= MAP_SIZE; line++) {
  const offset = line * TILE_SIZE;
  terrain.moveTo(offset, 0).lineTo(offset, MAP_PIXELS);
  terrain.moveTo(0, offset).lineTo(MAP_PIXELS, offset);
}
terrain.stroke({ color: 0x27392a, width: 1, alpha: 0.65 });
map.addChild(terrain);
const environmentObjects = initialEnvironment(MAP_SIZE);
const environmentByTile = new Map(environmentObjects.map(object => [`${object.column},${object.row}`, object]));
let selectedEnvironment = new Set<EnvironmentObject>();
let selectedDeer: Animal | null = null;
const selectedDeerSet = new Set<Animal>();
let infoFocus: 'item' | 'environment' | 'deer' | null = null;
const environmentLayer = new Container();
const environmentHud = new Container();
map.addChild(environmentLayer);
function createEnvironmentView(object: EnvironmentObject) {
  const view = new Container();
  view.position.set((object.column + 0.5) * TILE_SIZE, (object.row + 0.5) * TILE_SIZE);
  const outline = new Graphics().rect(-11, -11, 22, 22).stroke({ color: 0xfff2a3, width: 1.5 });
  outline.visible = false;
  const shape = new Graphics();
  if (object.type === 'tree') shape.rect(-2, 1, 4, 8).fill(0x916039).circle(0, -3, 8).fill(0x8fba7a);
  else if (object.type === 'wildStrawberry') shape.ellipse(0, 3, 9, 5).fill(0x8fba7a).circle(-4, 1, 3).circle(3, -1, 3).circle(1, 5, 3).fill(0xe75b70);
  else shape.ellipse(0, 1, 9, 7).fill(0xb6b6b6);
  if (object.type !== 'rock') shape.scale.set(.35 + .65 * object.hp / 100);
  const collectIcon = new Graphics()
    .moveTo(-4, -2).lineTo(0, -4).lineTo(4, -2).stroke({ color: 0xf2c66d, width: 2 })
    .moveTo(0, -3).lineTo(-3, 3).stroke({ color: 0xf2c66d, width: 2 });
  collectIcon.position.set(view.x, view.y - 16);
  collectIcon.visible = false;
  const { view: progressBar, fill: progressFill } = createProgressBar();
  progressBar.position.set(object.column * TILE_SIZE, (object.row + 1) * TILE_SIZE + 1);
  progressBar.visible = false;
  view.addChild(outline, shape);
  environmentHud.addChild(collectIcon, progressBar);
  environmentLayer.addChild(view);
  return { object, view, shape, outline, collectIcon, progressBar, progressFill, progress: -1 };
}
const environmentViews = new Map(environmentObjects.map(object => [object, createEnvironmentView(object)]));
const walls = new Walls(MAP_SIZE);
const storage = new Storage(walls);
const mapItems = initialItems();
let selectedItems = new Set<(typeof mapItems)[number]>();
let selectedItem: (typeof mapItems)[number] | null = null;
const itemLayer = new Container();
const itemViews = new Map<(typeof mapItems)[number], { view: Container; quantity: Text; collectIcon: Graphics }>();
map.addChild(itemLayer);
function drawWeapon(view: Graphics, weapon: Weapon): Graphics {
  view.clear();
  if (weapon === 'rifle') view.rect(-9, 1, 15, 3).fill(0x46515b).rect(-10, 0, 5, 5).fill(0x916039).rect(0, 3, 3, 4).fill(0x46515b);
  if (weapon === 'knife') view.poly([-2,2,9,2,13,0,9,-2,-2,-2]).fill(0xb9c3ca).rect(-8,-2,6,4).fill(0x916039).rect(-3,-4,2,8).fill(0x46515b);
  return view;
}
const itemIconTypes = new WeakMap<Graphics,import('./items').ItemType>();
function drawWolf(view:Graphics):Graphics {
  return view.ellipse(-1,0,8,4).rect(-6,1,2,7).rect(4,1,2,7).fill(0x89928d)
    .poly([3,-2,5,-9,8,-5,10,-2,8,1]).fill(0xb3bbb5)
    .poly([-7,-2,-13,-6,-11,0,-7,2]).fill(0x89928d).circle(8,-3,1).fill(0x202a25);
}
function drawItem(view: Graphics, type: import('./items').ItemType): Graphics {
  if(itemIconTypes.get(view)===type)return view;
  itemIconTypes.set(view,type);
  view.clear(); view.tint = 0xffffff; view.rotation=0;
  if (isWeaponItem(type)) { drawWeapon(view,type); view.position.set(0,7); }
  else if(type==='wolfCorpse'){drawWolf(view);view.position.set(0,7);view.rotation=Math.PI/2;}
  else if(type==='deerCorpse') {
    view.ellipse(-1,0,8,4).ellipse(6,-4,3,5).circle(8,-7,3).fill(0xc79868)
      .rect(-6,1,2,7).rect(4,1,2,7).fill(0x725036)
      .moveTo(7,-9).lineTo(6,-14).moveTo(6,-12).lineTo(3,-14).moveTo(9,-9).lineTo(10,-14).stroke({color:0xe1c6a3,width:1.3});
    view.position.set(0,7); view.rotation=Math.PI/2;
  } else { view.rect(-6,1,12,12).fill(ITEM_APPEARANCE[type].color); view.position.set(0,0); }
  return view;
}
function createItemView(item: (typeof mapItems)[number]): void {
  const view = new Container();
  view.position.set((item.column + 0.5) * TILE_SIZE, item.row * TILE_SIZE);
  const icon = drawItem(new Graphics(),item.type);
  const quantity = new Text({
    text: String(item.quantity),
    resolution: RENDER_RESOLUTION * 2,
    roundPixels: true,
    style: { fontFamily: 'sans-serif', fontSize: 10, lineHeight: 12, fill: 0xffffff, stroke: { color: 0x152019, width: 2 } },
  });
  quantity.anchor.set(0.5, 0);
  quantity.scale.set(1 / map.scale.x);
  quantity.position.set(0, 13 + 2 / map.scale.y);
  const collectIcon = new Graphics().moveTo(-3, -6).lineTo(3, -6).moveTo(0, -9).lineTo(0, -3).stroke({ color: 0xf2c66d, width: 2 });
  view.addChild(icon, quantity, collectIcon);
  itemLayer.addChild(view);
  itemViews.set(item, { view, quantity, collectIcon });
}
for (const item of mapItems) createItemView(item);
const itemSelection = new Graphics().rect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2)
  .stroke({ color: 0xfff2a3, width: 1.5 });
itemSelection.visible = false;
itemLayer.addChild(itemSelection);

const itemSummary = document.querySelector<HTMLUListElement>('#item-summary')!;
const summaryRows = ITEM_TYPES.map((type) => {
  const row = document.createElement('li');
  const icon = document.createElement('span');
  icon.className = 'item-icon';
  icon.style.backgroundColor = `#${ITEM_APPEARANCE[type].color.toString(16).padStart(6, '0')}`;
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', ITEM_APPEARANCE[type].name);
  const quantity = document.createElement('span');
  row.append(icon, quantity);
  itemSummary.appendChild(row);
  return { type, row, quantity, total: -1 };
});

function updateItemSummary(): void {
  let selectionChanged = false;
  for (const item of selectedItems) if (item.quantity <= 0) { selectedItems.delete(item); selectionChanged = true; }
  if (selectionChanged) refreshSelection();
  for (const item of mapItems) if (item.quantity > 0 && !itemViews.has(item)) createItemView(item);
  for (const [item, { view, quantity, collectIcon }] of itemViews) {
    if (item.quantity <= 0) {
      view.destroy({ children: true });
      itemViews.delete(item);
      continue;
    }
    collectIcon.visible = Boolean(item.collect);
    if (quantity.text !== String(item.quantity)) quantity.text = String(item.quantity);
  }
  const totals = storage.totals();
  for (const entry of summaryRows) {
    if (entry.total === totals[entry.type]) continue;
    entry.total = totals[entry.type];
    entry.row.hidden = entry.total <= 0;
    entry.quantity.textContent = `：${entry.total}`;
    entry.row.setAttribute('aria-label', `${ITEM_APPEARANCE[entry.type].name}：${entry.total}`);
  }
}
updateItemSummary();

walls.environmentCannotStop = tile => environmentByTile.get(`${tile.column},${tile.row}`)?.collected === false;
const wallLayer = new Container();
const wallViews = new Map<string, Graphics>();
const structureSelection=new Graphics();map.addChild(structureSelection);
const doorAnimations=new Map<Wall,{openness:number;hold:number}>();
function drawDoor(view:Graphics, openness:number): void {
  view.clear().rect(0,0,2,TILE_SIZE).rect(TILE_SIZE-2,0,2,TILE_SIZE).fill(0x4d3421);
  const width=(TILE_SIZE-4)/2*(1-openness);
  if(width>0)view.rect(2,1,width,TILE_SIZE-2).rect(TILE_SIZE-2-width,1,width,TILE_SIZE-2).fill(0xa67849).stroke({color:0x4d3421,width:1});
}
function updateDoors(seconds:number):void {
  const players=pawns.filter(pawn=>pawn.faction==='player'&&!pawn.dead);
  for(const door of walls.items.values()) {
    if(door.kind!=='door'||door.state!=='completed')continue;
    let state=doorAnimations.get(door);
    if(!state){state={openness:0,hold:0};doorAnimations.set(door,state);}
    const nearby=players.some(pawn=>{
      const position=renderedPosition(pawn.movement);
      return (pawn.movement.nextTile?.column===door.column&&pawn.movement.nextTile.row===door.row)
        ||Math.max(Math.abs(position.column-door.column),Math.abs(position.row-door.row))<.8;
    });
    state.hold=nearby?.2:Math.max(0,state.hold-seconds);
    const next=Math.max(0,Math.min(1,state.openness+(state.hold>0?1:-1)*seconds*5));
    if(next!==state.openness){state.openness=next;const view=wallViews.get(`${door.column},${door.row}`);if(view)drawDoor(view,next);}
  }
  for(const door of doorAnimations.keys())if(walls.at(door)!==door)doorAnimations.delete(door);
}

map.addChild(wallLayer);

const storedItemLayer = new Container();
map.addChild(storedItemLayer);
const storedItemViews = new Map<Wall, { view: Container; icon: Graphics; quantity: Text }>();
function updateStoredItemViews(): void {
  for (const area of storage.boxes()) {
    if (area.kind !== 'storageArea') continue;
    let entry = storedItemViews.get(area);
    if (!entry) {
      const view = new Container();
      view.position.set((area.column + 0.5) * TILE_SIZE, area.row * TILE_SIZE);
      const icon = new Graphics().rect(-6, 1, 12, 12).fill(0xffffff);
      const quantity = new Text({ text: '', resolution: RENDER_RESOLUTION * 2, roundPixels: true, style: { fontFamily: 'sans-serif', fontSize: 10, fill: 0xffffff, stroke: { color: 0x152019, width: 2 } } });
      quantity.anchor.set(0.5, 0);
      quantity.scale.set(1 / map.scale.x);
      quantity.position.set(0, 13 + 2 / map.scale.y);
      view.addChild(icon, quantity);
      storedItemLayer.addChild(view);
      entry = { view, icon, quantity };
      storedItemViews.set(area, entry);
    }
    const type = ITEM_TYPES.find(type => (area.stored?.[type] ?? 0) > 0);
    entry.view.visible = Boolean(type);
    if (type) {
      drawItem(entry.icon,type);
      const quantity = String(area.stored![type]);
      if (entry.quantity.text !== quantity) entry.quantity.text = quantity;
    }
  }
}

const corpseHud = new Container();
map.addChild(corpseHud);
function createCorpseIcon(): Graphics {
  const icon=new Graphics().moveTo(-3,-6).lineTo(3,-6).moveTo(0,-9).lineTo(0,-3).stroke({color:0xf2c66d,width:2});
  icon.visible=false;corpseHud.addChild(icon);return icon;
}
const deerLayer = new Container();
map.addChild(deerLayer);
const deerViews = new Map<Animal, { view: Container; selection: Graphics; food: Graphics; corpseIcon: Graphics }>();
function updateDeerViews(): void {
  for (const deer of wildlife.animals) {
    let entry = deerViews.get(deer);
    if (!entry) {
      const view = new Container();
      const selection = new Graphics().ellipse(0, 1, 11, 9).stroke({ color: 0xfff2a3, width: 1.5 });
      const body = deer.kind==='wolf'?drawWolf(new Graphics()):new Graphics().ellipse(0, 7, 10, 3).fill({ color: 0x17261c, alpha: .5 })
        .rect(-6, 1, 2, 7).rect(4, 1, 2, 7).fill(0x725036)
        .ellipse(-1, 0, 8, 4).ellipse(6, -4, 3, 5).circle(8, -7, 3).fill(0xc79868)
        .moveTo(7, -9).lineTo(6, -14).moveTo(6, -12).lineTo(3, -14)
        .moveTo(9, -9).lineTo(10, -14).moveTo(10, -12).lineTo(13, -14).stroke({ color: 0xe1c6a3, width: 1.3 });
      const food = new Graphics().circle(10, -5, 2).fill(ITEM_APPEARANCE.strawberry.color);
      view.addChild(selection, body, food);
      deerLayer.addChild(view);
      entry = { view, selection, food, corpseIcon:createCorpseIcon() };
      deerViews.set(deer, entry);
    }
    const position = deer.dead ? corpsePosition(deer) : renderedPosition(deer.movement);
    entry.view.position.set((position.column + .5) * TILE_SIZE, (position.row + .5) * TILE_SIZE);
    entry.view.rotation = deer.dead ? Math.PI / 2 : 0;
    entry.selection.visible = selectedDeerSet.has(deer);
    entry.food.visible = Boolean(deer.eatJob);
    entry.food.tint=deer.kind==='wolf'?ITEM_APPEARANCE.meat.color:0xffffff;
    entry.view.visible = !deer.consumed && !deer.corpseStorage;
    entry.corpseIcon.visible = Boolean(deer.dead && deer.collectCorpse && !deer.corpseCarrier && !deer.corpseStation && !deer.corpseStorage && !deer.consumed);
    entry.corpseIcon.position.set(entry.view.x,entry.view.y-8);
  }
  for (const [deer, entry] of deerViews) if (deer.departed) {
    entry.view.destroy({ children: true });
    entry.corpseIcon.destroy();
    deerViews.delete(deer);
    if (selectedDeerSet.delete(deer)) refreshSelection();
  }
}

const spawnTiles = [
  { column: 15, row: 15, color: 0xf2c66d },
  { column: 16, row: 15, color: 0x82c6dc },
  { column: 15, row: 16, color: 0xdb96b5 },
];
const pawnNames = generatePawnNames(spawnTiles.length);
const attackRangeLayer = new Container();
map.addChild(attackRangeLayer);
const movementPathLayer = new Container();
map.addChild(movementPathLayer);
const pawns = spawnTiles.map(({ column, row, color }, index) => {
  const view = new Container();
  const selection = new Graphics()
    .circle(0, 0, TILE_SIZE * 0.43)
    .stroke({ color: 0xfff2a3, width: 2 });
  selection.visible = false;
  view.addChild(selection);
  const body = new Graphics()
    .ellipse(0, 7, 7, 3).fill({ color: 0x17261c, alpha: 0.5 })
    .roundRect(-5, -1, 10, 10, 4).fill(color)
    .circle(0, -5, 4).fill(0xffe3bd)
    .stroke({ color: 0x25312a, width: 1 });
  view.addChild(body);
  const heldItem = new Graphics().rect(4, 0, 6, 6).fill(0xffffff);
  heldItem.visible = false;
  view.addChild(heldItem);
  const weaponView = drawWeapon(new Graphics(),'unarmed');
  weaponView.visible = false;
  view.addChild(weaponView);
  view.position.set((column + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE);
  map.addChild(view);
  const builder: HarvestWorker & HaulWorker = { movement: createMovement({ column, row }), mode: 'drafted', inventory: null, job: null, retrySeconds: 0, harvestJob: null, harvestRetrySeconds: 0 };
  const attackRange = new Graphics();
  attackRangeLayer.addChild(attackRange);
  const movementPath = new Graphics();
  movementPathLayer.addChild(movementPath);
  return { view, selection, heldItem, weaponView, drawnWeapon: 'unarmed' as Weapon, shotSeconds: 0, swingSeconds: 0, swingAngle: 0, corpseIcon:createCorpseIcon(), collectCorpse:false, corpseStorage:undefined as EatingWorker['corpseStorage'], attackRange, rangeSignature: '', weapon: 'unarmed' as Weapon, attackJob: null as CombatPawn['attackJob'], equipJob: null as CombatPawn['equipJob'], movementPath, manualMove: false, pathSignature: '', hp: 100, ...builder, kind: 'human' as const, faction: 'player' as Faction, needs: initialNeeds(), dead: false, consumed: false, corpseCarrier: undefined as EatingWorker['corpseCarrier'], corpseStation: undefined as EatingWorker['corpseStation'], deadPosition: undefined as Tile | undefined, eatJob: null as import('./needs').EatingWorker['eatJob'], name: pawnNames[index], priorities: { ...INITIAL_PRIORITIES[index] } };
});
const needsClearingCell = (tile: Tile) => environmentByTile.get(`${tile.column},${tile.row}`)?.collected === false
  || (walls.at(tile)?.state === 'planned' && mapItems.some(item => item.quantity > 0 && item.column === tile.column && item.row === tile.row))
  || clearing.isClearing(tile);
const needsClearing = (tile: Tile): boolean => {
  const building = walls.at(tile);
  return (building ? footprint(building) : [tile]).some(needsClearingCell);
};
const construction = new Construction(walls, mapItems, completeConstruction, needsClearing);
construction.storage = storage;
construction.demolish = completeDemolition;
const hauling = new Hauling(mapItems, storage);
const clearing = new Clearing(mapItems, hauling);
hauling.clearing = clearing;
const harvesting = new Harvesting(environmentObjects, mapItems, walls);
const wildlife = new Wildlife(construction, harvesting, hauling);
const combat = new Combat(construction, harvesting, hauling);
const hunting=new Hunting(combat,()=>wildlife.deer);
hauling.onCommand = worker => {
  construction.cancel(worker);
  const pawn = pawns.find(pawn => pawn === worker);
  if (pawn) { harvesting.cancel(pawn); combat.cancel(pawn); pawn.eatJob = null; pawn.manualMove = false; }
};
const pawnOccupancy = new PawnOccupancy();
for (const pawn of pawns) pawnOccupancy.track(pawn.movement);
wildlife.onSpawn = deer => pawnOccupancy.track(deer.movement);
wildlife.onDepart = deer => pawnOccupancy.untrack(deer.movement);
const pawnOccupies = (tile: Tile): boolean => pawnOccupancy.occupied(tile);
const butchery = new Butchery(construction, hauling, () => [...pawns, ...wildlife.animals], () => pawns);
const corpseEating=new CorpseEating(construction,harvesting,hauling,()=>[...pawns,...wildlife.animals]);
corpseEating.isReserved=corpse=>butchery.corpseClaims.has(corpse);
wildlife.combat=combat;wildlife.corpseEating=corpseEating;wildlife.players=()=>pawns;
construction.onCancel = worker => { if (!worker.dead && (worker.butcherJob || worker.carryingCorpse)) butchery.cancel(worker); };
butchery.onPickup = corpse => {
  pawnOccupancy.untrack(corpse.movement);
  const human = pawns.find(pawn => pawn === corpse);
  let changed = human ? selectedPawns.delete(human) : selectedDeerSet.delete(corpse as Animal);
  if (changed) refreshSelection();
};
butchery.onDrop = corpse => pawnOccupancy.track(corpse.movement);
butchery.onConsume = corpse => {
  pawnOccupancy.untrack(corpse.movement);
  const index = pawns.findIndex(pawn => pawn === corpse);
  if (index >= 0) {
    pawns[index].view.visible = false;
    rosterButtons[index].button.hidden = true;
    (prioritiesRows.children[index] as HTMLElement).hidden = true;
    selectedPawns.delete(pawns[index]);
  } else { (corpse as Animal).departed = true; selectedDeerSet.delete(corpse as Animal); }
  refreshSelection();
};
corpseEating.onConsume=butchery.onConsume;
const plantGrowth = new PlantGrowth(environmentObjects, walls,
  tile => pawnOccupies(tile) || mapItems.some(item => item.quantity > 0 && item.column === tile.column && item.row === tile.row),
  object => {
    environmentByTile.set(`${object.column},${object.row}`, object);
    environmentViews.set(object, createEnvironmentView(object));
  });
map.addChild(environmentHud);
const prioritiesTab = document.querySelector<HTMLButtonElement>('#priorities-tab')!;
const prioritiesWindow = document.querySelector<HTMLDialogElement>('#priorities-window')!;
const prioritiesRows = document.querySelector<HTMLTableSectionElement>('#priorities-rows')!;
function createPawnPortrait(index: number): SVGSVGElement {
  const portrait = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  portrait.setAttribute('viewBox', '-12 -14 24 28');
  portrait.setAttribute('aria-hidden', 'true');
  portrait.innerHTML = `<ellipse cx="0" cy="7" rx="7" ry="3" fill="#17261c" opacity=".5"/><rect x="-5" y="-1" width="10" height="10" rx="4" fill="#${spawnTiles[index].color.toString(16)}"/><circle cx="0" cy="-5" r="4" fill="#ffe3bd" stroke="#25312a" stroke-width="1"/>`;
  return portrait;
}
for (const [index, pawn] of pawns.entries()) {
  const row = document.createElement('tr');
  const name = document.createElement('th');
  name.scope = 'row';
  const nameLabel = document.createElement('span');
  nameLabel.textContent = formatPawnName(pawn.name);
  const identity = document.createElement('div');
  identity.className = 'priority-pawn';
  identity.append(createPawnPortrait(index), nameLabel);
  name.appendChild(identity);
  row.appendChild(name);
  for (const [task, label] of [['construction', '建設'], ['harvesting', '収集'], ['hauling', '運搬'], ['butchery', '解体'], ['hunting','狩猟'], ['free', '自由']] as const) {
    const cell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'priority-value';
    const refresh = () => {
      button.textContent = String(pawn.priorities[task] ?? 3);
      button.dataset.priority = button.textContent;
      button.setAttribute('aria-label', `${formatPawnName(pawn.name)} ${label}の優先順位 ${pawn.priorities[task]}`);
    };
    button.addEventListener('click', () => { pawn.priorities[task] = nextPriority(pawn.priorities[task] ?? 3); refresh(); });
    button.addEventListener('contextmenu', (event) => { event.preventDefault(); pawn.priorities[task] = nextPriority(pawn.priorities[task] ?? 3, -1); refresh(); });
    refresh(); cell.appendChild(button); row.appendChild(cell);
  }
  prioritiesRows.appendChild(row);
}
prioritiesTab.addEventListener('click', () => {
  if (prioritiesWindow.open) prioritiesWindow.close(); else {
    constructionSubtabs.hidden = true;
    constructionTab.setAttribute('aria-expanded', 'false');
    closeConstructionOptions();
    prioritiesWindow.show();
  }
  prioritiesTab.setAttribute('aria-expanded', String(prioritiesWindow.open));
});
document.querySelector<HTMLButtonElement>('#close-priorities')!.addEventListener('click', () => prioritiesWindow.close());
prioritiesWindow.addEventListener('close', () => prioritiesTab.setAttribute('aria-expanded', 'false'));
prioritiesWindow.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); prioritiesWindow.close(); }
});
const constructionProgressLayer = new Container();
map.addChild(constructionProgressLayer);
const constructionProgressViews = new Map<string, { view: Container; fill: Graphics; progress: number }>();
const butcherProgressViews = new Map<Wall,{view:Container;fill:Graphics}>();
function updateButcherProgress(): void {
  for(const station of walls.items.values()) {
    const state=station.butcher;
    if(station.state!=='completed'||!state?.corpse||state.seconds<=0||state.seconds>=BUTCHER_SECONDS)continue;
    let entry=butcherProgressViews.get(station);
    if(!entry){entry=createProgressBar();entry.view.position.set(station.column*TILE_SIZE,(station.row+1)*TILE_SIZE+1);constructionProgressLayer.addChild(entry.view);butcherProgressViews.set(station,entry);}
    entry.view.visible=true;entry.fill.scale.x=state.seconds/BUTCHER_SECONDS;
  }
  for(const [station,entry] of butcherProgressViews) {
    const state=station.butcher;
    if(walls.at(station)!==station||!state?.corpse||state.seconds<=0||state.seconds>=BUTCHER_SECONDS){entry.view.destroy({children:true});butcherProgressViews.delete(station);}
  }
}


function updateConstructionProgress(): void {
  for (const [key, entry] of constructionProgressViews) {
    const building = walls.items.get(key)!;
    const recipe = BUILD_RECIPES[building.kind];
    const progress = recipe && recipe.seconds > 0 ? Math.min(1, building.workSeconds / recipe.seconds) : 0;
    entry.view.visible = building.state === 'planned' && progress > 0 && progress < 1;
    if (!entry.view.visible || entry.progress === progress) continue;
    entry.progress = progress;
    entry.fill.scale.x = progress;
  }
}
let selectedStation: Wall | null = null;
const selectedStructures=new Set<Wall>();
let buildingInfoActive=false;
let selectedPawn: (typeof pawns)[number] | null = null;
const selectedPawns = new Set<(typeof pawns)[number]>();
const pawnModeButton = document.querySelector<HTMLButtonElement>('#pawn-mode-button')!;
const pawnModeIcon = document.querySelector<HTMLElement>('#pawn-mode-icon')!;
const pawnModeLabel = document.querySelector<HTMLElement>('#pawn-mode-label')!;
const dropInventoryButton = document.querySelector<HTMLButtonElement>('#drop-inventory-button')!;
const pawnSpecs = document.querySelector<HTMLElement>('#pawn-specs')!;
const pawnPanelMenus = [...document.querySelectorAll<HTMLElement>('.construction-subtabs, .building-options, .wall-materials')];
let pawnPanelLayoutDirty = true;
const invalidatePawnPanelLayout = () => { pawnPanelLayoutDirty = true; };
const menuResizeObserver = new ResizeObserver(invalidatePawnPanelLayout);
const menuVisibilityObserver = new MutationObserver(invalidatePawnPanelLayout);
for (const menu of pawnPanelMenus) {
  menuResizeObserver.observe(menu);
  menuVisibilityObserver.observe(menu, { attributes: true, attributeFilter: ['hidden'] });
}
window.addEventListener('resize', invalidatePawnPanelLayout);

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}
function setAttribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
const pawnSpecsName = document.createElement('h2');
const pawnSpecsAction = document.createElement('div');
const pawnSpecsFaction = document.createElement('div');
const pawnSpecsHp = document.createElement('div');
const pawnSpecsWeapon = document.createElement('div');
const pawnCorpseMass = document.createElement('div');
pawnSpecsWeapon.id = 'pawn-weapon';
pawnSpecsHp.id = 'pawn-hp';
const pawnSpecsInventory = document.createElement('div');
pawnSpecsInventory.className = 'pawn-specs-inventory';
const pawnSpecsItemIcon = document.createElement('span');
pawnSpecsItemIcon.className = 'item-icon';
pawnSpecsItemIcon.setAttribute('aria-hidden', 'true');
const pawnSpecsItemLabel = document.createElement('span');
pawnSpecsInventory.append(pawnSpecsItemIcon, pawnSpecsItemLabel);
const pawnSpecsTabs = document.createElement('nav');
pawnSpecsTabs.className = 'pawn-specs-tabs';
pawnSpecsTabs.setAttribute('aria-label', 'ポーン情報');
const overviewTab = document.createElement('button');
overviewTab.type = 'button'; overviewTab.textContent = '概要'; overviewTab.setAttribute('aria-pressed', 'true');
const needsTab = document.createElement('button');
needsTab.type = 'button'; needsTab.textContent = '欲求'; needsTab.setAttribute('aria-pressed', 'false');
pawnSpecsTabs.append(overviewTab, needsTab);
const pawnOverview = document.createElement('div');
pawnOverview.className = 'pawn-overview';
pawnOverview.append(pawnSpecsName, pawnSpecsFaction, pawnSpecsAction, pawnSpecsHp, pawnSpecsWeapon, pawnCorpseMass, pawnSpecsInventory);
const pawnNeeds = document.createElement('div');
pawnNeeds.className = 'pawn-needs'; pawnNeeds.hidden = true;
const needsMeters = (['満腹感', '健康'] as const).map(label => {
  const row = document.createElement('label');
  const title = document.createElement('span'); title.textContent = label;
  const meter = document.createElement('progress'); meter.max = 100; meter.value = 100; meter.setAttribute('aria-label', label);
  const value = document.createElement('span'); value.textContent = '100%';
  row.append(title, meter, value); pawnNeeds.appendChild(row);
  return { meter, value };
});
function selectPawnInfoTab(needs: boolean): void {
  pawnOverview.hidden = needs; pawnNeeds.hidden = !needs;
  overviewTab.setAttribute('aria-pressed', String(!needs)); needsTab.setAttribute('aria-pressed', String(needs));
  updatePawnPanels();
}
overviewTab.addEventListener('click', () => selectPawnInfoTab(false));
needsTab.addEventListener('click', () => selectPawnInfoTab(true));
pawnSpecs.append(pawnSpecsTabs, pawnOverview, pawnNeeds);
const pawnRoster = document.querySelector<HTMLElement>('#pawn-roster')!;
const rosterButtons = pawns.map((pawn, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pawn-roster-button';
  button.setAttribute('aria-label', `${formatPawnName(pawn.name)}を選択`);
  button.setAttribute('aria-pressed', 'false');
  button.title = formatPawnName(pawn.name);
  const portrait = createPawnPortrait(index);
  const label = document.createElement('span');
  label.textContent = pawn.name.nickname || pawn.name.givenName;
  button.append(portrait, label);
  button.addEventListener('click', event => selectPawn(pawn, event.shiftKey));
  button.addEventListener('dblclick', event => {
    selectPawn(pawn, event.shiftKey);
    camera.x = pawn.view.x;
    camera.y = pawn.view.y;
    applyCamera();
  });
  pawnRoster.appendChild(button);
  return { pawn, button, portrait, dead: false };
});

function clearSelection(): void {
  buildingInfoActive=false;selectedStructures.clear();
  selectedStation = null; selectedPawn = null; selectedDeer = null; selectedItem = null; infoFocus = null;
  selectedPawns.clear(); selectedDeerSet.clear(); selectedItems.clear(); selectedEnvironment.clear();
}

function refreshSelection(): void {
  for(const structure of selectedStructures)if(walls.at(structure)!==structure)selectedStructures.delete(structure);
  if(!selectedStation||!selectedStructures.has(selectedStation))selectedStation=selectedStructures.values().next().value??null;
  if(!selectedStation)buildingInfoActive=false;
  structureSelection.clear();
  for(const structure of selectedStructures)for(const cell of footprint(structure))structureSelection.rect(cell.column*TILE_SIZE+1,cell.row*TILE_SIZE+1,TILE_SIZE-2,TILE_SIZE-2);
  if(selectedStructures.size)structureSelection.stroke({color:0xfff2a3,width:1.5});

  if (!selectedPawn || !selectedPawns.has(selectedPawn)) selectedPawn = selectedPawns.values().next().value ?? null;
  if (!selectedDeer || !selectedDeerSet.has(selectedDeer)) selectedDeer = selectedDeerSet.values().next().value ?? null;
  if (!selectedItem || !selectedItems.has(selectedItem)) selectedItem = selectedItems.values().next().value ?? null;
  if (infoFocus === 'item' && !selectedItem || infoFocus === 'environment' && !selectedEnvironment.size || infoFocus === 'deer' && !selectedDeer) infoFocus = null;
  infoFocus ??= selectedItem ? 'item' : selectedEnvironment.size ? 'environment' : selectedDeer ? 'deer' : null;
  for (const pawn of pawns) pawn.selection.visible = selectedPawns.has(pawn);
  for (const [deer, entry] of deerViews) entry.selection.visible = selectedDeerSet.has(deer);
  updateItemSelection();
  updatePawnModeButton();
  if (stationWorkWindow.open && workStation !== selectedStation) stationWorkWindow.close();
  updateStationInfo();
}

function selectedCorpses(): EatingWorker[] {
  return [...selectedPawns,...selectedDeerSet].filter(pawn=>pawn.dead&&!pawn.consumed&&!pawn.corpseCarrier&&!pawn.corpseStation&&!pawn.corpseStorage);
}

function controlledSelection() {
  return [...selectedPawns].filter(pawn => isPlayerControlled(pawn) && !pawn.dead);
}

function selectPawn(pawn: (typeof pawns)[number], additive = false): void {
  selectConstruction(null);
  if (!additive) clearSelection();
  selectedPawn = pawn;
  selectedPawns.add(pawn);
  refreshSelection();
}

function updatePawnPanels(): void {
  const hidden = selectedPawn === null;
  const cannotDrop = !controlledSelection().some(pawn => (pawn.inventory?.quantity || pawn.weapon !== 'unarmed') && !pawn.dropRequested);
  if (dropInventoryButton.hidden !== hidden) dropInventoryButton.hidden = hidden;
  if (dropInventoryButton.disabled !== cannotDrop) dropInventoryButton.disabled = cannotDrop;
  const specsHidden=hidden||buildingInfoActive;
  if (pawnSpecs.hidden !== specsHidden) pawnSpecs.hidden = specsHidden;
  if (!selectedPawn) return;
  setText(pawnSpecsFaction, `勢力：${FACTIONS[selectedPawn.faction]}`);
  pawnCorpseMass.hidden=!selectedPawn.dead;
  if(selectedPawn.dead)setText(pawnCorpseMass,`質量：${ITEM_APPEARANCE.humanCorpse.massKg}kg`);
  setText(pawnSpecsHp, `HP：${Math.round(selectedPawn.hp)}%`);
  setText(pawnSpecsWeapon, `装備：${WEAPONS[selectedPawn.weapon].name}`);
  const action = selectedPawn.dead ? '死亡' : selectedPawn.equipJob ? '装備へ移動中' : selectedPawn.attackJob ? (selectedPawn.attackJob.hunting?'狩猟中':'攻撃中') : selectedPawn.eatJob ? (selectedPawn.eatJob.eatingSeconds !== undefined ? '食事中' : '食料へ移動中') : currentAction(selectedPawn);
  if (!pawnNeeds.hidden) for (const [index, value] of [selectedPawn.needs.satiety, selectedPawn.needs.health].entries()) {
    if (needsMeters[index].meter.value !== value) needsMeters[index].meter.value = value;
    setText(needsMeters[index].value, `${Math.round(value)}%`);
  }
  const fullName = formatPawnName(selectedPawn.name);
  if (pawnSpecsName.textContent !== fullName) pawnSpecsName.textContent = fullName;
  if (pawnSpecsAction.textContent !== action) pawnSpecsAction.textContent = action;
  const held = selectedPawn.inventory;
  if (pawnSpecsItemIcon.hidden !== !held?.quantity) pawnSpecsItemIcon.hidden = !held?.quantity;
  const inventoryLabel = held?.quantity ? `所持：${ITEM_APPEARANCE[held.type].name} × ${held.quantity}` : '所持：なし';
  if (pawnSpecsItemLabel.textContent !== inventoryLabel) pawnSpecsItemLabel.textContent = inventoryLabel;
  if (held && pawnSpecsItemIcon.dataset.type !== held.type) {
    pawnSpecsItemIcon.dataset.type = held.type;
    pawnSpecsItemIcon.style.backgroundColor = `#${ITEM_APPEARANCE[held.type].color.toString(16).padStart(6, '0')}`;
  }
  if (pawnPanelLayoutDirty) {
    let top = window.innerHeight - 40;
    for (const menu of pawnPanelMenus) if (!menu.hidden) top = Math.min(top, menu.getBoundingClientRect().top);
    pawnSpecs.style.bottom = `${window.innerHeight - top}px`;
    pawnPanelLayoutDirty = false;
  }
}
dropInventoryButton.addEventListener('click', () => {
  for (const pawn of controlledSelection()) if (pawn.inventory?.quantity || pawn.weapon !== 'unarmed') { combat.cancel(pawn); pawn.manualMove = false; hauling.cancel(pawn); harvesting.cancel(pawn); construction.requestDrop(pawn); }
  updatePawnPanels();
});
const itemInfoButton = document.querySelector<HTMLButtonElement>('#item-info-button')!;
const itemProperties = document.querySelector<HTMLDialogElement>('#item-properties')!;
const itemPropertiesName = document.querySelector<HTMLElement>('#item-properties-name')!;
const itemPropertiesMass = document.querySelector<HTMLElement>('#item-properties-mass')!;
const acquisitionButton = document.querySelector<HTMLButtonElement>('#acquisition-button')!;
const huntingButton=document.querySelector<HTMLButtonElement>('#hunting-button')!;
huntingButton.addEventListener('click',()=>{
  const targets=[...selectedDeerSet].filter(deer=>deer.kind==='deer'&&!deer.dead&&!deer.departed);
  const hunt=!targets.every(deer=>deer.hunt);
  for(const deer of targets)deer.hunt=hunt;
  updateItemSelection();
});
const collectionButton = document.querySelector<HTMLButtonElement>('#collection-button')!;
const harvestSpeed = document.querySelector<HTMLElement>('#environment-harvest-speed')!;
const harvestQuantity = document.querySelector<HTMLElement>('#environment-harvest-quantity')!;
const environmentHp = document.querySelector<HTMLElement>('#environment-hp')!;
const animalFaction = document.querySelector<HTMLElement>('#animal-faction')!;
const animalAction = document.querySelector<HTMLElement>('#animal-action')!;
const animalSatiety = document.querySelector<HTMLElement>('#animal-satiety')!;
const animalHp = document.querySelector<HTMLElement>('#animal-hp')!;
const animalHealth = document.querySelector<HTMLElement>('#animal-health')!;
function updateObjectProperties(): void {
  if (!itemProperties.open) return;
  const environment = selectedEnvironment.values().next().value;
  if (infoFocus === 'environment' && environment) {
    setText(environmentHp, `${Math.round(environment.hp)}%`);
    setText(harvestQuantity, String(harvestYield(environment)));
  } else if (infoFocus === 'deer' && selectedDeer) {
    setText(animalFaction, FACTIONS[selectedDeer.faction]);
    setText(animalAction, deerAction(selectedDeer));
    setText(animalSatiety, `${Math.round(selectedDeer.needs.satiety)}%`);
    setText(animalHp, `${Math.round(selectedDeer.hp ?? 100)}%`);
    setText(animalHealth, `${Math.round(selectedDeer.needs.health)}%`);
  }
}

const devourButton=document.querySelector<HTMLButtonElement>('#devour-button')!;
const haulCommandWindow = document.querySelector<HTMLDialogElement>('#haul-command')!;
let haulCommand: { pawn: (typeof pawns)[number]; source: MapItem | Corpse } | null = null;
const immediateHaulButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-immediate-haul]')];
function prepareHaulCommand(pawn: (typeof pawns)[number], source: MapItem | Corpse): void {
  haulCommand = { pawn, source };
  devourButton.hidden='type' in source;
  devourButton.disabled=!('type' in source)&&!corpseEating.canEat(pawn,source);
  for (const button of immediateHaulButtons) {
    button.hidden = pawn.mode !== 'automatic' || ('type' in source && !mapItems.includes(source));
    button.disabled = !button.hidden && !('type' in source ? hauling.canRequest(pawn, source) : butchery.canRequest(pawn, source));
    button.title = button.disabled ? '運搬できる経路と、このアイテムを受け入れる保管場所が必要です。' : '';
  }
}
function openHaulCommand(pawn: (typeof pawns)[number], source: MapItem | Corpse, event: MouseEvent): void {
  prepareHaulCommand(pawn, source);
  equipmentCommandWindow.close(); foodCommandWindow.close();
  haulCommandWindow.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - 190))}px`;
  haulCommandWindow.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - 100))}px`;
  if (!haulCommandWindow.open) haulCommandWindow.show();
}
for (const button of immediateHaulButtons) button.addEventListener('click', () => {
  if (haulCommand && haulCommand.pawn === selectedPawn) { const {pawn,source}=haulCommand; if('type' in source)hauling.request(pawn,source);else butchery.request(pawn,source); }
  haulCommandWindow.close(); equipmentCommandWindow.close(); foodCommandWindow.close();
});
devourButton.addEventListener('click',()=>{
  if(haulCommand&&haulCommand.pawn===selectedPawn&&!('type' in haulCommand.source)){const {pawn,source}=haulCommand;if(corpseEating.request(pawn,source)){combat.cancel(pawn);pawn.manualMove=false;}}
  haulCommandWindow.close();
});
document.querySelector<HTMLButtonElement>('#close-haul-command')!.addEventListener('click', () => haulCommandWindow.close());
haulCommandWindow.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); haulCommandWindow.close(); } });

const equipmentCommandWindow = document.querySelector<HTMLDialogElement>('#equipment-command')!;
let equipmentCommand: { pawn: (typeof pawns)[number]; source: (typeof mapItems)[number] } | null = null;
function openEquipmentCommand(pawn: (typeof pawns)[number], source: (typeof mapItems)[number], event: MouseEvent): void {
  prepareHaulCommand(pawn, source); haulCommandWindow.close(); foodCommandWindow.close();
  equipmentCommand = { pawn, source };
  equipmentCommandWindow.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - 190))}px`;
  equipmentCommandWindow.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - 80))}px`;
  if (!equipmentCommandWindow.open) equipmentCommandWindow.show();
}
document.querySelector<HTMLButtonElement>('#equip-button')!.addEventListener('click', () => {
  if (equipmentCommand && combat.requestEquip(equipmentCommand.pawn, equipmentCommand.source)) equipmentCommand.pawn.manualMove = false;
  equipmentCommandWindow.close();
});
document.querySelector<HTMLButtonElement>('#close-equipment-command')!.addEventListener('click', () => equipmentCommandWindow.close());
equipmentCommandWindow.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); equipmentCommandWindow.close(); } });

const foodCommandWindow = document.querySelector<HTMLDialogElement>('#food-command')!;
let foodCommand: { pawn: (typeof pawns)[number]; source: (typeof mapItems)[number] } | null = null;
function openFoodCommand(pawn: (typeof pawns)[number], source: (typeof mapItems)[number], event: MouseEvent): void {
  prepareHaulCommand(pawn, source); haulCommandWindow.close(); equipmentCommandWindow.close();
  foodCommand = { pawn, source };
  foodCommandWindow.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - 190))}px`;
  foodCommandWindow.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - 80))}px`;
  if (!foodCommandWindow.open) foodCommandWindow.show();
}
document.querySelector<HTMLButtonElement>('#eat-now-button')!.addEventListener('click', () => {
  if (foodCommand && requestEat(foodCommand.pawn, foodCommand.source, construction, harvesting, hauling)) { combat.cancel(foodCommand.pawn); foodCommand.pawn.manualMove = false; }
  foodCommandWindow.close();
});
document.querySelector<HTMLButtonElement>('#close-food-command')!.addEventListener('click', () => foodCommandWindow.close());
foodCommandWindow.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); foodCommandWindow.close(); } });

const storageSettings = document.querySelector<HTMLDialogElement>('#storage-settings')!;
const storageSettingsFields = ITEM_TYPES.map(type => ({
  type,
  quantity: document.querySelector<HTMLElement>(`#stored-${type}`)!,
  accepted: document.querySelector<HTMLInputElement>(`[data-storage-type="${type}"]`)!,
}));
let configuredBox: Wall | null = null;
function updateStorageSettings(): void {
  if (!configuredBox || !storageSettings.open) return;
  for (const entry of storageSettingsFields) {
    setText(entry.quantity, `：${configuredBox.stored?.[entry.type] ?? 0}`);
    const accepted = configuredBox.accepted?.[entry.type] !== false;
    if (entry.accepted.checked !== accepted) entry.accepted.checked = accepted;
  }
}
function openStorageSettings(box: Wall): void {
  configuredBox = box;
  if (!storageSettings.open) storageSettings.show();
  updateStorageSettings();
}
for (const input of document.querySelectorAll<HTMLInputElement>('[data-storage-type]')) {
  input.addEventListener('change', () => {
    if (!configuredBox) return;
    configuredBox.accepted ??= { wood: true, stone: true, strawberry: true, ration: true, rifle: true, knife: true, meat: true, humanCorpse: true, deerCorpse: true, wolfCorpse: true };
    configuredBox.accepted[input.dataset.storageType as (typeof ITEM_TYPES)[number]] = input.checked;
  });
}
document.querySelector<HTMLButtonElement>('#close-storage-settings')!.addEventListener('click', () => storageSettings.close());
storageSettings.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); storageSettings.close(); } });

function updateEnvironmentViews(): void {
  let changed = false;
  for (const object of selectedEnvironment) if (object.collected) { selectedEnvironment.delete(object); changed = true; }
  for (const entry of environmentViews.values()) {
    if (entry.object.collected) {
      entry.view.destroy({ children: true });
      entry.collectIcon.destroy();
      entry.progressBar.destroy({ children: true });
      environmentViews.delete(entry.object);
      continue;
    }
    entry.outline.visible = selectedEnvironment.has(entry.object);
    if (entry.object.type !== 'rock') entry.shape.scale.set(.35 + .65 * entry.object.hp / 100);
    entry.collectIcon.visible = entry.object.collect && !entry.object.collected;
    const progress = Math.min(1, entry.object.workSeconds / ENVIRONMENT_PROPERTIES[entry.object.type].seconds);
    entry.progressBar.visible = !entry.object.collected && progress > 0 && progress < 1;
    if (entry.progressBar.visible && entry.progress !== progress) {
      entry.progress = progress;
      entry.progressFill.scale.x = progress;
    }
  }
  if (changed) refreshSelection();
}
collectionButton.addEventListener('click', () => {
  const collect = ![...selectedEnvironment].every((object) => object.collect);
  for (const object of selectedEnvironment) object.collect = collect;
  updateItemSelection();
});

acquisitionButton.addEventListener('click', () => {
  const corpses=selectedCorpses();
  const collect = !([...selectedItems].every(item => item.collect)&&corpses.every(corpse=>corpse.collectCorpse));
  for (const item of selectedItems) if(!storage.isSource(item))item.collect = collect;
  for (const corpse of corpses) corpse.collectCorpse=collect;
  updateItemSelection();
});

function updateItemSelection(): void {
  foodCommandWindow.close();
  equipmentCommandWindow.close();
  haulCommandWindow.close();
  const environment = [...selectedEnvironment][0];
  const hasSelection = infoFocus !== null;
  itemInfoButton.hidden = !hasSelection;
  itemInfoButton.setAttribute('aria-label', infoFocus === 'deer' ? '動物のインフォメーション' : infoFocus === 'environment' ? '環境オブジェクトのインフォメーション' : 'アイテムのインフォメーション');
  const huntable=[...selectedDeerSet].filter(deer=>deer.kind==='deer'&&!deer.dead&&!deer.departed);
  huntingButton.hidden=!huntable.length;
  const huntingSelected=huntable.length>0&&huntable.every(deer=>deer.hunt);
  huntingButton.textContent=huntingSelected?'🏹 狩猟':'無視';
  huntingButton.setAttribute('aria-pressed',String(huntingSelected));
  const corpses=selectedCorpses();
  acquisitionButton.hidden = ![...selectedItems].some(item=>!storage.isSource(item))&&!corpses.length;
  const acquire = (selectedItems.size > 0||corpses.length>0) && [...selectedItems].every(item => item.collect)&&corpses.every(corpse=>corpse.collectCorpse);
  acquisitionButton.textContent = acquire ? '🧺 収集' : '無視';
  acquisitionButton.setAttribute('aria-pressed', String(acquire));
  collectionButton.hidden = !environment;
  collectionButton.textContent = (selectedItems.size ? '収集：' : '') + ([...selectedEnvironment].every(object => object.collect) ? '収集' : '無視');
  collectionButton.setAttribute('aria-pressed', String(Boolean(environment) && [...selectedEnvironment].every((object) => object.collect)));
  for (const element of document.querySelectorAll<HTMLElement>('[data-item-property]')) element.hidden = infoFocus !== 'item';
  for (const element of document.querySelectorAll<HTMLElement>('[data-environment-property]')) element.hidden = infoFocus !== 'environment';
  for (const element of document.querySelectorAll<HTMLElement>('[data-animal-property]')) element.hidden = infoFocus !== 'deer';
  for (const element of document.querySelectorAll<HTMLElement>('[data-corpse-property]')) element.hidden=!(infoFocus==='deer'&&selectedDeer?.dead);
  if(selectedDeer?.dead)setText(document.querySelector<HTMLElement>('#corpse-mass')!,`${ITEM_APPEARANCE[corpseItemType(selectedDeer)].massKg}kg`);
  for(const element of document.querySelectorAll<HTMLElement>('[data-food-property]'))element.hidden=infoFocus!=='item'||!selectedItem||foodNutrition(selectedItem.type)<=0;
  if(infoFocus==='item'&&selectedItem&&foodNutrition(selectedItem.type)>0)setText(document.querySelector<HTMLElement>('#food-nutrition')!,String(foodNutrition(selectedItem.type)));
  for (const element of document.querySelectorAll<HTMLElement>('[data-weapon-property]')) element.hidden = infoFocus !== 'item' || !selectedItem || !isWeaponItem(selectedItem.type);
  itemSelection.visible = selectedItems.size > 0;
  itemSelection.clear();
  for (const item of selectedItems) itemSelection.rect(item.column * TILE_SIZE + 1, item.row * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  if (selectedItems.size) itemSelection.stroke({ color: 0xfff2a3, width: 1.5 });
  pawnModeButton.hidden = !selectedPawns.size && hasSelection;
  if (infoFocus === 'item' && selectedItem) {
    const properties = ITEM_APPEARANCE[selectedItem.type];

    itemPropertiesName.textContent = properties.name;
    itemPropertiesMass.textContent = `${properties.massKg}kg`;
    if (isWeaponItem(selectedItem.type)) {
      setText(document.querySelector<HTMLElement>('#weapon-range')!, selectedItem.type === 'rifle' ? '半径16マス' : '隣接1マス（斜め含む）');
      setText(document.querySelector<HTMLElement>('#weapon-damage')!, '40% / HIT');
      setText(document.querySelector<HTMLElement>('#weapon-accuracy')!, `${WEAPONS[selectedItem.type].accuracy*100}%`);
      setText(document.querySelector<HTMLElement>('#weapon-interval')!, `${WEAPONS[selectedItem.type].interval}秒`);
    }
  } else if (infoFocus === 'environment' && environment) {
    const properties = ENVIRONMENT_PROPERTIES[environment.type];
    itemPropertiesName.textContent = properties.name;
    harvestSpeed.textContent = `${properties.seconds}s`;
    harvestQuantity.textContent = String(harvestYield(environment));
    environmentHp.textContent = `${Math.round(environment.hp)}%`;
  } else if (infoFocus === 'deer' && selectedDeer) {
    itemPropertiesName.textContent = selectedDeer.kind==='wolf'?'狼':'鹿';
    animalFaction.textContent = FACTIONS[selectedDeer.faction];
    animalAction.textContent = deerAction(selectedDeer);
    animalSatiety.textContent = `${Math.round(selectedDeer.needs.satiety)}%`;
    animalHp.textContent = `${Math.round(selectedDeer.hp ?? 100)}%`;
    animalHealth.textContent = `${Math.round(selectedDeer.needs.health)}%`;
  } else itemProperties.close();
  updateEnvironmentViews();
}
itemInfoButton.addEventListener('click', () => {
  if ((selectedItem || selectedEnvironment.size || selectedDeer) && !itemProperties.open) { itemProperties.show(); updateObjectProperties(); }
});
document.querySelector<HTMLButtonElement>('#close-item-properties')!.addEventListener('click', () => itemProperties.close());
itemProperties.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); itemProperties.close(); }
});

function updatePawnModeButton(): void {
  const controlled = controlledSelection();
  const drafted = !controlled.length || controlled.every(pawn => pawn.mode === 'drafted');
  const mixed = controlled.some(pawn => pawn.mode === 'drafted') && controlled.some(pawn => pawn.mode === 'automatic');
  const label = mixed ? '混在' : drafted ? '徴兵' : '自動';
  const disabled = !controlled.length;
  if (pawnModeButton.disabled !== disabled) pawnModeButton.disabled = disabled;
  updatePawnPanels();
  for (const entry of rosterButtons) setAttribute(entry.button, 'aria-pressed', String(selectedPawns.has(entry.pawn)));
  setText(pawnModeIcon, drafted ? '⚔' : '⚙');
  setText(pawnModeLabel, label);
  setAttribute(pawnModeButton, 'data-mode', drafted ? 'drafted' : 'automatic');
  setAttribute(pawnModeButton, 'aria-label', selectedPawn
    ? `ポーンの状態：${label}。${drafted ? '自動' : '徴兵'}へ切り替え`
    : 'ポーンを選択して状態を切り替え');
}

pawnModeButton.addEventListener('click', () => {
  const controlled = controlledSelection();
  const mode = controlled.every(pawn => pawn.mode === 'drafted') ? 'automatic' : 'drafted';
  for (const pawn of controlled) {
    pawn.mode = mode;
    if(mode==='drafted'&&pawn.eatJob&&!pawn.eatJob.manual)pawn.eatJob=null;
    pawn.manualMove = false;
    combat.cancel(pawn);
    hauling.cancel(pawn); construction.cancel(pawn); harvesting.cancel(pawn);
    if (mode === 'automatic') stopAtNextSafeTile(pawn.movement, walls.cannotStop);
  }
  updatePawnModeButton();
});
updatePawnModeButton();
const destinationMarkerLayer = new Container();
map.addChild(destinationMarkerLayer);
const destinationMarkers: { view: Graphics; ageSeconds: number }[] = [];
const MARKER_HOLD_SECONDS = 0.5;
const MARKER_FADE_SECONDS = 0.25;
app.stage.addChild(map);

let selectedConstruction: ConstructionKind | null = null;
let demolitionSelected = false;
const demolitionButton = document.querySelector<HTMLButtonElement>('#demolition-button')!;
const demolitionMarks = new Map<Wall, Graphics>();
const constructionMaterials: Record<ConstructionKind, WallMaterial> = { wall: 'wood', door: 'wood', barricade: 'wood', storage: 'wood', storageArea: 'wood', butcher: 'wood' };
let stationOrientation: 0 | 1 = 0;
let drawingPointer: number | null = null;
let previousDragTile: Tile | null = null;
const constructionTab = document.querySelector<HTMLButtonElement>('.construction-tab')!;
const constructionSubtabs = document.querySelector<HTMLElement>('#construction-subtabs')!;
const constructionChoices = [
  { kind: 'butcher' as const, tabId: '#workshops-tab', optionsId: '#workshop-options', buttonId: '#butcher-button', materialsId: '#butcher-materials' },
  { kind: 'door' as const, tabId: '#buildings-tab', optionsId: '#building-options', buttonId: '#door-button', materialsId: '#door-materials' },
  { kind: 'wall' as const, tabId: '#buildings-tab', optionsId: '#building-options', buttonId: '#wall-button', materialsId: '#wall-materials' },
  { kind: 'storageArea' as const, tabId: '#storage-tab', optionsId: '#storage-options', buttonId: '#storage-area-button', materialsId: '#storage-area-materials' },
  { kind: 'storage' as const, tabId: '#storage-tab', optionsId: '#storage-options', buttonId: '#storage-button', materialsId: '#storage-materials' },
  { kind: 'barricade' as const, tabId: '#defense-tab', optionsId: '#defense-options', buttonId: '#barricade-button', materialsId: '#barricade-materials' },
].map((choice) => ({
  kind: choice.kind,
  tab: document.querySelector<HTMLButtonElement>(choice.tabId)!,
  options: document.querySelector<HTMLElement>(choice.optionsId)!,
  button: document.querySelector<HTMLButtonElement>(choice.buttonId)!,
  materials: document.querySelector<HTMLElement>(choice.materialsId)!,
}));
function updateConstructionLabels(): void {
  for (const choice of constructionChoices) {
    if (choice.kind === 'storageArea') { choice.button.textContent = '保管エリア'; continue; }
    choice.button.textContent = `${choice.kind === 'wall' ? '壁' : choice.kind === 'door' ? '扉' : choice.kind === 'storage' ? '保管箱' : choice.kind === 'butcher' ? '解体所' : 'バリケード'}（${ITEM_APPEARANCE[constructionMaterials[choice.kind]].name}）`;
  }
}
updateConstructionLabels();

function stopDrawing(): void {
  if (drawingPointer !== null && app.canvas.hasPointerCapture(drawingPointer)) {
    app.canvas.releasePointerCapture(drawingPointer);
  }
  drawingPointer = null;
  previousDragTile = null;
}

function selectConstruction(kind: ConstructionKind | null): void {
  demolitionSelected = false;
  demolitionButton.setAttribute('aria-pressed', 'false');
  selectedConstruction = kind;
  for (const choice of constructionChoices) choice.button.setAttribute('aria-pressed', String(choice.kind === kind));
  app.canvas.style.cursor = kind ? 'crosshair' : '';
  stopDrawing();
  cancelSelectionDrag();
  stationPreview.visible = kind === 'butcher';
  drawStationPreview();
  if (kind) {
    clearSelection();
    updateItemSelection();
    for (const pawn of pawns) pawn.selection.visible = false;
    updatePawnModeButton();
  }
}

function hideMaterials(): void {
  for (const choice of constructionChoices) {
    choice.materials.hidden = true;
    choice.button.setAttribute('aria-expanded', 'false');
  }
}

function closeConstructionOptions(): void {
  for (const choice of constructionChoices) {
    choice.options.hidden = true;
    choice.tab.setAttribute('aria-expanded', 'false');
  }
  hideMaterials();
  selectConstruction(null);
}

constructionTab.addEventListener('click', () => {
  prioritiesWindow.close();
  constructionSubtabs.hidden = !constructionSubtabs.hidden;
  constructionTab.setAttribute('aria-expanded', String(!constructionSubtabs.hidden));
  if (constructionSubtabs.hidden) closeConstructionOptions();
});
for (const button of constructionSubtabs.querySelectorAll<HTMLButtonElement>('button')) {
  if (button !== demolitionButton && !constructionChoices.some((choice) => choice.tab === button)) button.addEventListener('click', closeConstructionOptions);
}
for (const choice of constructionChoices) {
  if (constructionChoices.find(entry => entry.tab === choice.tab) === choice) choice.tab.addEventListener('click', () => {
    const opening = choice.options.hidden;
    closeConstructionOptions();
    choice.options.hidden = !opening;
    choice.tab.setAttribute('aria-expanded', String(opening));
  });
  choice.button.addEventListener('click', () => {
    selectConstruction(selectedConstruction === choice.kind ? null : choice.kind);
    hideMaterials();
  });
  choice.button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (choice.kind === 'door' || choice.kind === 'storage' || choice.kind === 'storageArea' || choice.kind === 'butcher') return;
    const opening = choice.materials.hidden;
    hideMaterials();
    choice.materials.hidden = !opening;
    choice.button.setAttribute('aria-expanded', String(opening));
  });
  for (const button of choice.materials.querySelectorAll<HTMLButtonElement>('button')) {
    button.addEventListener('click', () => {
      constructionMaterials[choice.kind] = button.dataset.material as WallMaterial;
      updateConstructionLabels();
      for (const option of choice.materials.querySelectorAll('button')) {
        option.setAttribute('aria-pressed', String(option === button));
      }
      selectConstruction(choice.kind);
      hideMaterials();
    });
  }
}

demolitionButton.addEventListener('click', () => {
  const enabled = !demolitionSelected;
  closeConstructionOptions();
  if (enabled) {
    clearSelection();
    for (const pawn of pawns) pawn.selection.visible = false;
    updateItemSelection();
    updatePawnModeButton();
  }
  demolitionSelected = enabled;
  demolitionButton.setAttribute('aria-pressed', String(enabled));
  app.canvas.style.cursor = enabled ? 'crosshair' : '';
});

function markDemolition(tile: Tile): void {
  const target = walls.at(tile);
  if (!target || target.state !== 'completed' || (target.kind !== 'wall' && target.kind !== 'storage') || target.demolition) return;
  target.demolition = true;
  const mark = new Graphics().moveTo(4, 4).lineTo(TILE_SIZE - 4, TILE_SIZE - 4)
    .moveTo(TILE_SIZE - 4, 4).lineTo(4, TILE_SIZE - 4).stroke({ color: 0xff8a80, width: 2 });
  mark.position.set(tile.column * TILE_SIZE, tile.row * TILE_SIZE);
  destinationMarkerLayer.addChild(mark);
  demolitionMarks.set(target, mark);
}

function completeDemolition(tile: Tile, attacked=false): boolean {
  const target = attacked?destroyStructure(walls,mapItems,tile):demolishStructure(walls, mapItems, tile);
  if (!target) return false;
  const key = `${tile.column},${tile.row}`;
  wallViews.get(key)?.destroy();
  wallViews.delete(key);
  constructionProgressViews.get(key)?.view.destroy({ children: true });
  constructionProgressViews.delete(key);
  demolitionMarks.get(target)?.destroy();
  demolitionMarks.delete(target);
  for(const pawn of pawns){if(pawn.job?.target===target)construction.cancel(pawn);if(pawn.butcherJob?.station===target)butchery.cancel(pawn);if(pawn.haulJob?.target===target)hauling.cancel(pawn);}
  const bodies=[...(target.storedCorpses??[]),...(target.butcher?.corpse?[target.butcher.corpse]:[])];
  if(target.butcher)target.butcher.corpse=undefined;
  for (const corpse of bodies) {
    corpse.corpseStation=undefined;
    corpse.corpseStorage=undefined;
    const carrier={movement:createMovement(target),mode:'automatic' as const,inventory:null,job:null,retrySeconds:0,carryingCorpse:corpse};
    carrier.movement.stopBlocked=tile=>pawnOccupancy.occupied(tile);
    corpse.corpseCarrier=carrier;
    if(!butchery.dropCorpse(carrier)){corpse.corpseCarrier=undefined;corpse.deadPosition={column:target.column,row:target.row};corpse.movement.tile={...corpse.deadPosition};corpse.movement.destination={...corpse.deadPosition};pawnOccupancy.track(corpse.movement);}
  }
  target.storedCorpses=[];
  selectedStructures.delete(target);refreshSelection();
  if (configuredBox === target) { configuredBox = null; storageSettings.close(); }
  return true;
}

combat.onDestroyStructure=structure=>{completeDemolition(structure,true);};

function placeConstruction(tile: Tile): void {
  if (!selectedConstruction) return;
  const wall = walls.plan(tile, constructionMaterials[selectedConstruction], selectedConstruction, stationOrientation);
  if (!wall) return;
  for (const cell of footprint(wall)) {
    const environment = environmentByTile.get(`${cell.column},${cell.row}`);
    if (environment && !environment.collected) environment.collect = true;
  }
  const lowerHalf = wall.kind === 'barricade';
  const view = new Graphics()
    .rect(0, lowerHalf ? TILE_SIZE / 2 : 0, TILE_SIZE, lowerHalf ? TILE_SIZE / 2 : TILE_SIZE)
    .fill(WALL_COLORS[wall.material]);
  if(wall.kind==='door')drawDoor(view,0);
  if (wall.kind === 'butcher') {
    view.clear();
    for (const cell of footprint(wall)) view.rect((cell.column-tile.column)*TILE_SIZE, (cell.row-tile.row)*TILE_SIZE, TILE_SIZE, TILE_SIZE);
    view.fill(0x9c7953).rect(2,2,TILE_SIZE-4,TILE_SIZE-4).fill(0xb1a091).stroke({color:0x43392f,width:2});
  }
  if (wall.kind === 'storageArea') view.clear().rect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2).fill({ color: 0xd7b97d, alpha: 0.15 }).stroke({ color: 0xd7b97d, width: 1 });
  if (wall.kind === 'storage') view.rect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4).stroke({ color: 0xd7b97d, width: 2 }).moveTo(2, 8).lineTo(TILE_SIZE - 2, 8).stroke({ color: 0xd7b97d, width: 1 }).rect(10, 7, 4, 5).fill(0xd7b97d);
  view.position.set(tile.column * TILE_SIZE, tile.row * TILE_SIZE);
  view.alpha = WALL_PLAN_ALPHA;
  wallLayer.addChild(view);
  wallViews.set(`${tile.column},${tile.row}`, view);
  const { view: progressView, fill } = createProgressBar();
  progressView.position.set(tile.column * TILE_SIZE, (tile.row + 1) * TILE_SIZE + 1);
  progressView.visible = false;
  constructionProgressLayer.addChild(progressView);
  constructionProgressViews.set(`${tile.column},${tile.row}`, { view: progressView, fill, progress: -1 });
  if (wall.kind === 'storageArea' && !needsClearing(tile)) { walls.complete(tile); view.alpha = 1; }
}

// Finalize only when no pawn or active route would be trapped by the new structure.
export function completeConstruction(tile: Tile): boolean {
  const item = walls.at(tile);
  if (!item || item.state === 'completed') return false;
  if (needsClearing(tile)) return false;
  const sameTile = (entry: Tile): boolean => footprint(item).some(cell => entry.column === cell.column && entry.row === cell.row);
  const blockedAfter = (entry: Tile): boolean => walls.isBlocked(entry) || ((item.kind === 'wall' || item.kind === 'storage' || item.kind === 'butcher') && sameTile(entry));
  const cannotStopAfter = (entry: Tile): boolean => walls.cannotStop(entry) || (item.kind === 'barricade' && sameTile(entry));
  if ([...pawns, ...wildlife.animals].filter(pawn => !pawn.consumed && !pawn.corpseCarrier && !pawn.corpseStation && !pawn.corpseStorage).some(({ movement,faction }) => {
    const occupied = [movement.tile, movement.nextTile, movement.destination];
    if ((item.kind === 'wall' || item.kind === 'storage' || item.kind === 'butcher') && movement.nextTile && movement.nextTile.column !== movement.tile.column && movement.nextTile.row !== movement.tile.row) {
      occupied.push(
        { column: movement.nextTile.column, row: movement.tile.row },
        { column: movement.tile.column, row: movement.nextTile.row },
      );
    }
    return occupied.some((entry) => entry && sameTile(entry))
      || !movementHasSafeExit(movement, faction!=='player' ? entry=>walls.nonPlayerBlocked(entry)||blockedAfter(entry)||(item.kind==='door'&&sameTile(entry)) : blockedAfter, cannotStopAfter);
  })) return false;
  if (!walls.complete(tile)) return false;
  const key = `${tile.column},${tile.row}`;
  wallViews.get(key)!.alpha = 1;
  constructionProgressViews.get(key)?.view.destroy({ children: true });
  constructionProgressViews.delete(key);
  return true;
}

export const completeWall = completeConstruction;

function removeConstructionPlan(tile: Tile): boolean {
  const removed = walls.removePlan(tile);
  if (!removed) return false;
  for (const pawn of pawns) {
    if (pawn.job?.target === removed) construction.cancel(pawn);
    if (pawn.clearJob?.target === removed) clearing.cancel(pawn);
  }
  returnItems(mapItems, removed, removed.material, removed.delivered);
  const key = `${removed.column},${removed.row}`;
  wallViews.get(key)?.destroy();
  wallViews.delete(key);
  constructionProgressViews.get(key)?.view.destroy({ children: true });
  constructionProgressViews.delete(key);
  updateItemSummary();
  return true;
}

function showDestination(column: number, row: number): void {
  const marker = new Graphics()
    .circle(0, 0, (TILE_SIZE - 4) / 2)
    .stroke({ color: 0x152019, width: 4 })
    .circle(0, 0, (TILE_SIZE - 4) / 2)
    .stroke({ color: 0xffffff, width: 2 });
  marker.position.set((column + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE);
  destinationMarkerLayer.addChild(marker);
  destinationMarkers.push({ view: marker, ageSeconds: 0 });
}

const camera = { x: MAP_PIXELS / 2, y: MAP_PIXELS / 2, zoom: 1 };
const cameraKeys = new Set<string>();
const CAMERA_SPEED = 400;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

function applyCamera(): void {
  const scale = Math.min(app.screen.width, app.screen.height) / MAP_PIXELS * camera.zoom;
  map.scale.set(scale);
  for (const { quantity } of itemViews.values()) {
    quantity.scale.set(1 / scale);
    quantity.y = 13 + 2 / scale;
  }
  for (const { quantity } of storedItemViews.values()) { quantity.scale.set(1 / scale); quantity.y = 13 + 2 / scale; }
  map.position.set(
    app.screen.width / 2 - camera.x * scale,
    app.screen.height / 2 - camera.y * scale,
  );
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR' && selectedConstruction === 'butcher' && !event.repeat && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); stationOrientation = stationOrientation ? 0 : 1; drawStationPreview(); }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
    event.preventDefault();
    cameraKeys.add(event.code);
  }
});
window.addEventListener('keyup', (event) => cameraKeys.delete(event.code));
window.addEventListener('blur', () => { cameraKeys.clear(); stopDrawing(); cancelSelectionDrag(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cameraKeys.clear(); stopDrawing(); cancelSelectionDrag(); }
});

app.canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const bounds = app.canvas.getBoundingClientRect();
  const screenX = (event.clientX - bounds.left) * app.screen.width / bounds.width;
  const screenY = (event.clientY - bounds.top) * app.screen.height / bounds.height;
  const worldX = (screenX - map.x) / map.scale.x;
  const worldY = (screenY - map.y) / map.scale.y;
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? app.screen.height : 1);
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * Math.exp(-pixels * 0.001)));
  applyCamera();
  // Keep the world point under the cursor fixed while zooming.
  camera.x += worldX - (screenX - map.x) / map.scale.x;
  camera.y += worldY - (screenY - map.y) / map.scale.y;
  applyCamera();
}, { passive: false });

function mapPosition(event: MouseEvent): { x: number; y: number } {
  const bounds = app.canvas.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) * app.screen.width / bounds.width - map.x) / map.scale.x;
  const y = ((event.clientY - bounds.top) * app.screen.height / bounds.height - map.y) / map.scale.y;
  return { x, y };
}

function drawWalls(event: PointerEvent): void {
  const { x, y } = mapPosition(event);
  const tile = { column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
  if (tile.column < 0 || tile.row < 0 || tile.column >= MAP_SIZE || tile.row >= MAP_SIZE) {
    previousDragTile = null;
    return;
  }
  if (selectedConstruction === 'butcher') { if (!previousDragTile) placeConstruction(tile); }
  else for (const entry of dragTiles(previousDragTile ?? tile, tile)) placeConstruction(entry);
  previousDragTile = tile;
}

type Point = { x: number; y: number };
let selectionDrag: { pointerId: number; start: Point; end: Point; additive: boolean; dragged: boolean } | null = null;
const selectionBox = new Graphics();
selectionBox.eventMode = 'none';
app.stage.addChild(selectionBox);

function cancelSelectionDrag(): void {
  const pointerId = selectionDrag?.pointerId;
  selectionDrag = null;
  selectionBox.clear();
  if (pointerId !== undefined && app.canvas.hasPointerCapture(pointerId)) app.canvas.releasePointerCapture(pointerId);
}

function hitSelection(event: MouseEvent) {
  const { x, y } = mapPosition(event);
  const building = walls.at({column:Math.floor(x/TILE_SIZE),row:Math.floor(y/TILE_SIZE)});
  if (building?.kind === 'butcher' && building.state === 'completed') return {kind:'structure' as const,value:building};
  const pawn = [...pawns].reverse().find(({ view, consumed, corpseCarrier, corpseStation, corpseStorage }) => !consumed && !corpseCarrier && !corpseStation && !corpseStorage && Math.abs(view.x - x) <= TILE_SIZE * .45 && Math.abs(view.y - y) <= TILE_SIZE * .45);
  if (pawn) return { kind: 'pawn' as const, value: pawn };
  const deer = [...deerViews].reverse().find(([deer, { view }]) => !deer.consumed && !deer.corpseCarrier && !deer.corpseStation && !deer.corpseStorage && Math.abs(view.x - x) <= TILE_SIZE * .5 && Math.abs(view.y - y) <= TILE_SIZE * .5)?.[0];
  if (deer) return { kind: 'deer' as const, value: deer };
  const tile = { column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
  if (walls.isBlocked(tile)) return building?.state==='completed'?{kind:'structure' as const,value:building}:null;
  const item = [...mapItems].reverse().find(item => item.quantity > 0 && item.column === tile.column && item.row === tile.row);
  if (item) return { kind: 'item' as const, value: item };
  if(building?.kind==='storageArea'&&building.state==='completed'){
    const type=ITEM_TYPES.find(type=>(building.stored?.[type]??0)>0);
    const stored=type?storage.sources(type).find(source=>source.column===building.column&&source.row===building.row):null;
    if(stored)return {kind:'item' as const,value:stored};
  }
  if(building?.state==='completed')return {kind:'structure' as const,value:building};
  const environment = environmentByTile.get(`${tile.column},${tile.row}`);
  return environment && !environment.collected ? { kind: 'environment' as const, value: environment } : null;
}

function selectHit(event: MouseEvent, additive: boolean, nearby = false): void {
  const hit = hitSelection(event);
  if (!additive) clearSelection();
  buildingInfoActive=hit?.kind==='structure';
  if (hit?.kind === 'structure') { selectedStructures.add(hit.value);selectedStation = hit.value; pawnPanelLayoutDirty=true; }
  else if (hit?.kind === 'pawn') { selectedPawns.add(hit.value); selectedPawn = hit.value; }
  else if (hit?.kind === 'deer') { selectedDeerSet.add(hit.value); selectedDeer = hit.value; infoFocus = 'deer'; }
  else if (hit?.kind === 'item') {
    for (const item of nearby ? nearbyItems([...mapItems,...ITEM_TYPES.flatMap(type=>storage.sources(type).filter(source=>walls.at(source)?.kind==='storageArea'))], hit.value) : [hit.value]) selectedItems.add(item);
    selectedItem = hit.value; infoFocus = 'item';
  } else if (hit?.kind === 'environment') {
    for (const object of nearby ? nearbySameType(environmentObjects, hit.value) : [hit.value]) selectedEnvironment.add(object);
    // The most recently selected object is shown in the information window.
    selectedEnvironment.delete(hit.value); selectedEnvironment = new Set([hit.value, ...selectedEnvironment]);
    infoFocus = 'environment';
  }
  refreshSelection();
}

function updateSelectionDrag(event: PointerEvent): void {
  const drag = selectionDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.end = { x: event.clientX, y: event.clientY };
  drag.dragged ||= Math.hypot(drag.end.x - drag.start.x, drag.end.y - drag.start.y) >= 4;
  if (!drag.dragged) return;
  const bounds = app.canvas.getBoundingClientRect();
  const x = (Math.min(drag.start.x, drag.end.x) - bounds.left) * app.screen.width / bounds.width;
  const y = (Math.min(drag.start.y, drag.end.y) - bounds.top) * app.screen.height / bounds.height;
  const width = Math.abs(drag.start.x - drag.end.x) * app.screen.width / bounds.width;
  const height = Math.abs(drag.start.y - drag.end.y) * app.screen.height / bounds.height;
  selectionBox.clear().rect(x, y, width, height).fill({ color: 0xfff2a3, alpha: .12 }).stroke({ color: 0xfff2a3, width: 1 });
}

function finishSelection(event: PointerEvent): void {
  if (selectionDrag?.pointerId !== event.pointerId || event.button !== 0) return;
  updateSelectionDrag(event);
  const drag = selectionDrag!;
  if (!drag.dragged) selectHit(event, drag.additive);
  else {
    if (!drag.additive) clearSelection();
    const bounds = app.canvas.getBoundingClientRect();
    const inside = (view: Container) => {
      const x = bounds.left + (map.x + view.x * map.scale.x) * bounds.width / app.screen.width;
      const y = bounds.top + (map.y + view.y * map.scale.y) * bounds.height / app.screen.height;
      return x >= Math.min(drag.start.x, drag.end.x) && x <= Math.max(drag.start.x, drag.end.x)
        && y >= Math.min(drag.start.y, drag.end.y) && y <= Math.max(drag.start.y, drag.end.y);
    };
    for (const pawn of pawns) if (!pawn.consumed && !pawn.corpseCarrier && !pawn.corpseStation && !pawn.corpseStorage && inside(pawn.view)) selectedPawns.add(pawn);
    for (const [deer, { view }] of deerViews) if (!deer.consumed && !deer.corpseCarrier && !deer.corpseStation && !deer.corpseStorage && inside(view)) selectedDeerSet.add(deer);
    refreshSelection();
  }
  cancelSelectionDrag();
}

app.canvas.addEventListener('pointerdown', (event) => {
  if (event.button === 2 && selectionDrag) { cancelSelectionDrag(); return; }
  const { x, y } = mapPosition(event);
  if (demolitionSelected) {
    if (event.button === 0) markDemolition({ column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) });
    else if (event.button === 2) selectConstruction(null);
    return;
  }
  if (event.button === 2 && removeConstructionPlan({ column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) })) {
    if (selectedConstruction) { selectConstruction(null); hideMaterials(); }
    return;
  }
  if (event.button === 2) {
    const hit = hitSelection(event);
    const storedBody=hit?.kind==='item'&&walls.at(hit.value)?.kind==='storageArea'?walls.at(hit.value)?.storedCorpses?.find(body=>corpseItemType(body)===hit.value.type):undefined;
    const target = hit?.kind === 'pawn' || hit?.kind === 'deer' ? hit.value : hit?.kind==='structure'?combat.structureTarget(hit.value):null;
    if (target) {
      let commanded = false;
      for (const pawn of controlledSelection()) if (combat.requestAttack(pawn, target)) { pawn.manualMove = false; commanded = true; }
      if (commanded) { showAttackCommand(target); return; }
      if (target.dead && !('structure' in target) && !target.consumed && selectedPawn && !selectedPawn.dead && isPlayerControlled(selectedPawn)) { openHaulCommand(selectedPawn,target,event);return; }
    }
    if(storedBody&&selectedPawn&&!selectedPawn.dead&&isPlayerControlled(selectedPawn)){openHaulCommand(selectedPawn,storedBody,event);return;}
    if (selectedPawn && !selectedPawn.dead && isPlayerControlled(selectedPawn)) {
      const tile = { column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
      const source = [...mapItems].reverse().find(item => isWeaponItem(item.type) && item.quantity > 0 && item.column === tile.column && item.row === tile.row)
        ?? (walls.at(tile)?.kind === 'storageArea' ? [...storage.sources('rifle'),...storage.sources('knife')].find(item => item.column === tile.column && item.row === tile.row) : undefined);
      if (source) { openEquipmentCommand(selectedPawn, source, event); return; }
    }
  }
  if (event.button === 2 && selectedPawn && isPlayerControlled(selectedPawn) && !selectedPawn.dead) {
    const tile = { column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
    const source = [...mapItems].reverse().find(item => foodNutrition(item.type) > 0 && item.quantity > 0 && item.column === tile.column && item.row === tile.row)
      ?? (walls.at(tile)?.kind === 'storageArea' ? [...storage.sources('strawberry'), ...storage.sources('meat'),...storage.sources('ration')].find(item => item.column === tile.column && item.row === tile.row) : undefined);
    if (source) { openFoodCommand(selectedPawn, source, event); return; }
  }
  if (event.button === 2 && selectedPawn?.mode === 'automatic' && !selectedPawn.dead && isPlayerControlled(selectedPawn)) {
    const tile = { column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
    const source = [...mapItems].reverse().find(item => item.quantity > 0 && item.column === tile.column && item.row === tile.row);
    if (source) { openHaulCommand(selectedPawn, source, event); return; }
  }
  const clickedStructure = walls.items.get(`${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`);
  if (event.button === 2 && clickedStructure?.kind === 'storage' && clickedStructure.state === 'completed') {
    openStorageSettings(clickedStructure);
    return;
  }
  if (event.button === 2 && selectedConstruction) {
    selectConstruction(null);
    hideMaterials();
    return;
  }
  if (event.button === 0 && selectedConstruction) {
    drawingPointer = event.pointerId;
    previousDragTile = null;
    app.canvas.setPointerCapture(event.pointerId);
    drawWalls(event);
    return;
  }
  if (event.button === 0) {
    selectionDrag = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY },
      end: { x: event.clientX, y: event.clientY }, additive: event.shiftKey, dragged: false };
    app.canvas.setPointerCapture(event.pointerId);
  } else if (event.button === 2) {
    const tile = { column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
    const movements = controlledSelection().filter(pawn => pawn.mode === 'drafted').map(pawn => pawn.movement);
    const previousRoutes = new Map(movements.map(movement => [movement, movement.route]));
    for (const goal of commandGroup(movements, tile, MAP_SIZE, walls.isBlocked, walls.cannotStop, pawnOccupancy)) showDestination(goal.column, goal.row);
    for (const pawn of selectedPawns) if (previousRoutes.has(pawn.movement) && pawn.movement.route !== previousRoutes.get(pawn.movement)) { pawn.manualMove = true; combat.cancel(pawn); pawn.eatJob = null; }
  }
});
app.canvas.addEventListener('dblclick', event => {
  if (!selectedConstruction && !demolitionSelected) selectHit(event, event.shiftKey, true);
});
app.canvas.addEventListener('pointermove', event => {
  if (selectedConstruction === 'butcher') { stationPreviewPoint = mapPosition(event); drawStationPreview(); }
  if (drawingPointer === event.pointerId && selectedConstruction) drawWalls(event);
  else updateSelectionDrag(event);
});
app.canvas.addEventListener('pointerup', event => { finishSelection(event); stopDrawing(); });
for (const eventName of ['pointercancel', 'lostpointercapture'] as const) {
  app.canvas.addEventListener(eventName, () => { stopDrawing(); cancelSelectionDrag(); });
}

function showAttackCommand(target: CombatPawn): void {
  const position = target.deadPosition ?? renderedPosition(target.movement);
  const icon = new Graphics()
    .moveTo(-7, -8).lineTo(6, 6).moveTo(7, -8).lineTo(-6, 6).stroke({ color: 0xffffff, width: 2.5 })
    .moveTo(2, 7).lineTo(7, 2).moveTo(-2, 7).lineTo(-7, 2).stroke({ color: 0xf2c66d, width: 2 })
    .moveTo(5, 5).lineTo(9, 9).moveTo(-5, 5).lineTo(-9, 9).stroke({ color: 0x916039, width: 3 });
  icon.position.set((position.column + .5) * TILE_SIZE, (position.row + .5) * TILE_SIZE);
  destinationMarkerLayer.addChild(icon);
  destinationMarkers.push({ view: icon, ageSeconds: 0 });
}

function updateMovementPaths(): void {
  for (const pawn of pawns) {
    const movement = pawn.movement;
    const moving = movement.nextTile || movement.tile.column !== movement.destination.column || movement.tile.row !== movement.destination.row;
    if (!pawn.manualMove || pawn.mode !== 'drafted' || pawn.dead || !moving || pawn.eatJob || pawn.attackJob || pawn.equipJob) {
      if (pawn.pathSignature) { pawn.movementPath.clear(); pawn.pathSignature = ''; }
      if (!moving || pawn.dead || pawn.mode !== 'drafted') pawn.manualMove = false;
      continue;
    }
    const position = renderedPosition(movement);
    const tiles = [position, ...(movement.nextTile ? [movement.nextTile] : []), ...(movement.route ?? [])];
    const signature = tiles.map(tile => `${tile.column},${tile.row}`).join(';');
    if (signature === pawn.pathSignature) continue;
    pawn.pathSignature = signature;
    pawn.movementPath.clear().moveTo((position.column + .5) * TILE_SIZE, (position.row + .5) * TILE_SIZE);
    for (const tile of tiles.slice(1)) pawn.movementPath.lineTo((tile.column + .5) * TILE_SIZE, (tile.row + .5) * TILE_SIZE);
    pawn.movementPath.stroke({ color: 0xffffff, width: 1.5, alpha: .85 });
  }
}

const attackEffects = new AttackEffects(TILE_SIZE);
map.addChild(attackEffects.view);
combat.onAttack = event => {
  attackEffects.show(event);
  const pawn = pawns.find(pawn => pawn === event.attacker);
  if (pawn && event.weapon === 'rifle') { pawn.weaponView.rotation = Math.atan2(event.to.row - event.from.row, event.to.column - event.from.column); pawn.shotSeconds=.12; }
  if(pawn && event.weapon==='knife'){pawn.swingSeconds=.25;pawn.swingAngle=Math.atan2(event.to.row-event.from.row,event.to.column-event.from.column);}
  if ('kind' in event.target && event.target.kind === 'deer') wildlife.flee(event.target as Deer, event.from);
};

function updateAttackRanges(): void {
  for (const pawn of pawns) {
    const visible = selectedPawns.has(pawn) && !pawn.dead && pawn.mode === 'drafted' && WEAPONS[pawn.weapon].range > 1;
    pawn.attackRange.visible = visible;
    if (!visible) continue;
    const tile = pawn.movement.tile;
    const signature = `${pawn.weapon}:${tile.column},${tile.row}`;
    if (signature === pawn.rangeSignature) continue;
    pawn.rangeSignature = signature;
    pawn.attackRange.clear();
    for (const edge of attackRangeEdges(tile, pawn.weapon, MAP_SIZE)) {
      pawn.attackRange.moveTo(edge.from.column * TILE_SIZE, edge.from.row * TILE_SIZE)
        .lineTo(edge.to.column * TILE_SIZE, edge.to.row * TILE_SIZE);
    }
    pawn.attackRange.stroke({ color: 0xffffff, width: 1, alpha: .65 });
  }
}

const stationPreview = new Graphics();
stationPreview.eventMode = 'none'; stationPreview.visible = false; map.addChild(stationPreview);
let stationPreviewPoint = {x:MAP_PIXELS/2,y:MAP_PIXELS/2};
function drawStationPreview(): void {
  stationPreview.clear();
  if (selectedConstruction !== 'butcher') { stationPreview.visible = false; return; }
  stationPreview.visible = true;
  const center = {column:Math.floor(stationPreviewPoint.x/TILE_SIZE),row:Math.floor(stationPreviewPoint.y/TILE_SIZE),kind:'butcher' as const,orientation:stationOrientation};
  const cells = footprint(center);
  const valid = cells.every(cell => cell.column>=0&&cell.row>=0&&cell.column<MAP_SIZE&&cell.row<MAP_SIZE&&!walls.at(cell));
  for (const cell of cells) stationPreview.rect(cell.column*TILE_SIZE,cell.row*TILE_SIZE,TILE_SIZE,TILE_SIZE);
  stationPreview.fill({color:valid?0xfff2a3:0xdc3548,alpha:.15}).stroke({color:valid?0xfff2a3:0xdc3548,width:1});
}
const stationInfo = document.querySelector<HTMLElement>('#station-info')!;
const stationStatus = document.querySelector<HTMLElement>('#station-status')!;
const stationWorkWindow = document.querySelector<HTMLDialogElement>('#station-work')!;
let workStation: Wall | null = null;
const billCount = document.querySelector<HTMLElement>('#butcher-count')!;
const meatTarget = document.querySelector<HTMLInputElement>('#meat-target')!;
function updateStationInfo(): void {
  stationInfo.hidden = !selectedStation||!buildingInfoActive;
  if (selectedStation && pawnPanelLayoutDirty) {
    let top = window.innerHeight-40;
    for (const menu of pawnPanelMenus) if (!menu.hidden) top=Math.min(top,menu.getBoundingClientRect().top);
    stationInfo.style.bottom = `${window.innerHeight-top}px`;
    pawnPanelLayoutDirty=false;
  }
  if (selectedStation) {
    const names:Record<ConstructionKind,string>={wall:'壁',door:'扉',barricade:'バリケード',storage:'保管箱',storageArea:'保管エリア',butcher:'解体所'};
    setText(document.querySelector<HTMLElement>('#station-info h2')!,names[selectedStation.kind]);
    setText(document.querySelector<HTMLElement>('#structure-hp')!,`HP ${Math.round(selectedStation.hp??100)}%`);
    document.querySelector<HTMLButtonElement>('#station-work-button')!.hidden=selectedStation.kind!=='butcher';
    const state=selectedStation.butcher;
    setText(stationStatus,state?(state.corpse?`解体進捗：${Math.round(state.seconds/5*100)}%`:'死体なし'):`${ITEM_APPEARANCE[selectedStation.material].name}${selectedStructures.size>1?`・${selectedStructures.size}個選択中`:''}`);
  }
  if (stationWorkWindow.open && workStation?.butcher) {
    const state=workStation.butcher;
    setText(billCount,state.mode==='forever'?'∞':state.mode==='until'?`肉 ${butchery.meatStock()} / ${state.target}`:String(state.remaining));
    setAttribute(billCount,'data-zero',String(state.mode==='count'&&state.remaining===0));
    setAttribute(document.querySelector<HTMLElement>('#repeat-until')!,'aria-pressed',String(state.mode==='until'));
    setAttribute(document.querySelector<HTMLElement>('#repeat-forever')!,'aria-pressed',String(state.mode==='forever'));
  }
}
document.querySelector<HTMLButtonElement>('#station-work-button')!.addEventListener('click',()=>{
  if (!selectedStation?.butcher) return;
  workStation=selectedStation; meatTarget.value=String(workStation.butcher!.target);
  if (!stationWorkWindow.open) stationWorkWindow.show(); updateStationInfo();
});
for (const [selector,amount] of [['#butcher-once',1],['#butcher-plus',1],['#butcher-minus',-1]] as const) document.querySelector<HTMLButtonElement>(selector)!.addEventListener('click',()=>{if(workStation?.butcher){adjustButcherCount(workStation.butcher,amount);updateStationInfo();}});
document.querySelector<HTMLButtonElement>('#repeat-until')!.addEventListener('click',()=>{if(workStation?.butcher){workStation.butcher.target=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(meatTarget.value)||0)));workStation.butcher.mode='until';updateStationInfo();}});
meatTarget.addEventListener('change',()=>{if(workStation?.butcher)workStation.butcher.target=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(meatTarget.value)||0)));});
document.querySelector<HTMLButtonElement>('#repeat-forever')!.addEventListener('click',()=>{if(workStation?.butcher){workStation.butcher.mode='forever';updateStationInfo();}});
document.querySelector<HTMLButtonElement>('#close-station-work')!.addEventListener('click',()=>stationWorkWindow.close());
stationWorkWindow.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();stationWorkWindow.close();}});

const simulationClock = new SimulationClock();
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-game-speed]')];
for (const button of speedButtons) {
  button.addEventListener('click', () => {
    simulationClock.speed = Number(button.dataset.gameSpeed) as GameSpeed;
    for (const choice of speedButtons) choice.setAttribute('aria-pressed', String(choice === button));
  });
}

app.ticker.add((ticker) => {
  for (let index = destinationMarkers.length - 1; index >= 0; index--) {
    const marker = destinationMarkers[index];
    marker.ageSeconds += ticker.deltaMS / 1000;
    marker.view.alpha = Math.max(0, 1 - Math.max(0, marker.ageSeconds - MARKER_HOLD_SECONDS) / MARKER_FADE_SECONDS);
    if (marker.view.alpha === 0) {
      marker.view.destroy();
      destinationMarkers.splice(index, 1);
    }
  }
  const horizontal = Number(cameraKeys.has('KeyD')) - Number(cameraKeys.has('KeyA'));
  const vertical = Number(cameraKeys.has('KeyS')) - Number(cameraKeys.has('KeyW'));
  const directionLength = Math.hypot(horizontal, vertical);
  if (directionLength > 0) {
    const distance = CAMERA_SPEED * ticker.deltaMS / 1000 / map.scale.x;
    camera.x += horizontal / directionLength * distance;
    camera.y += vertical / directionLength * distance;
    applyCamera();
  }
  simulationClock.advance(ticker.deltaMS / 1000, (seconds) => {
    plantGrowth.update(seconds);
    corpseEating.updateClaims();
    for (const pawn of pawns) {
      walls.bindMovement(pawn.movement,pawn.faction);
      pawn.shotSeconds=Math.max(0,pawn.shotSeconds-seconds);
      pawn.swingSeconds=Math.max(0,pawn.swingSeconds-seconds);
      const eating = updateNeeds(pawn, construction, harvesting, hauling, seconds, !pawn.attackJob && !pawn.equipJob && !pawn.forcedHaulSource && !pawn.forcedCorpse,corpseEating.automatic);
      if (pawn.dead && (pawn.butcherJob || pawn.carryingCorpse)) butchery.cancel(pawn);
      const commanding = pawn.attackJob?.hunting?false:combat.update(pawn, seconds, pawns);
      if (!eating && !commanding && pawn.forcedCorpse) butchery.update(pawn,seconds,'transport');
      else if (!eating && !commanding && pawn.forcedHaulSource) hauling.update(pawn);
      else if (!eating && !commanding) updateWork(pawn, construction, harvesting, seconds, Math.random, seconds, hauling, clearing, butchery,hunting);
      if (!pawn.dead) advancePathMovement(pawn.movement, seconds, MAP_SIZE, walls.isBlocked, walls.cannotStop);
    }
    wildlife.update(seconds, pawnOccupies);
    attackEffects.update(seconds);
    for (const deer of wildlife.animals) if (!deer.dead) advancePathMovement(deer.movement, seconds, MAP_SIZE, walls.isBlocked, walls.cannotStop);
    updateDoors(seconds);
  });
  updateMovementPaths();
  updateAttackRanges();
  for (const pawn of pawns) {
    const position = pawn.dead ? corpsePosition(pawn) : renderedPosition(pawn.movement);
    pawn.view.visible = !pawn.consumed && !pawn.corpseStorage;
    pawn.corpseIcon.visible = Boolean(pawn.dead&&pawn.collectCorpse&&!pawn.consumed&&!pawn.corpseCarrier&&!pawn.corpseStation&&!pawn.corpseStorage);
    pawn.corpseIcon.position.set(pawn.view.x,pawn.view.y-8);
    pawn.view.rotation = pawn.dead ? Math.PI / 2 : 0;
    pawn.view.position.set((position.column + 0.5) * TILE_SIZE, (position.row + 0.5) * TILE_SIZE);
    if(pawn.drawnWeapon!==pawn.weapon){drawWeapon(pawn.weaponView,pawn.weapon);pawn.drawnWeapon=pawn.weapon;}
    if(pawn.shotSeconds<=0 || pawn.weapon!=='rifle')pawn.weaponView.rotation=0;
    if(pawn.weapon==='knife'&&pawn.swingSeconds>0)pawn.weaponView.rotation=pawn.swingAngle+(.5-pawn.swingSeconds/.25)*Math.PI;
    pawn.weaponView.visible = pawn.weapon !== 'unarmed';
    pawn.heldItem.visible = Boolean(pawn.inventory?.quantity);
    if (pawn.inventory) pawn.heldItem.tint = ITEM_APPEARANCE[pawn.inventory.type].color;
  }
  for (const entry of rosterButtons) if (entry.dead !== entry.pawn.dead) {
    entry.dead = entry.pawn.dead;
    entry.portrait.style.transform = entry.dead ? 'rotate(90deg)' : '';
  }
  if (foodCommandWindow.open && (!foodCommand || foodCommand.pawn !== selectedPawn || foodCommand.pawn.dead || foodCommand.source.quantity <= 0)) foodCommandWindow.close();
  if (equipmentCommandWindow.open && (!equipmentCommand || equipmentCommand.pawn !== selectedPawn || equipmentCommand.pawn.dead || equipmentCommand.source.quantity <= 0)) equipmentCommandWindow.close();
  if (haulCommandWindow.open && (!haulCommand || haulCommand.pawn !== selectedPawn || haulCommand.pawn.dead || ('type' in haulCommand.source ? haulCommand.pawn.mode!=='automatic'||haulCommand.source.quantity<=0 : haulCommand.source.consumed))) haulCommandWindow.close();
  updateStorageSettings();
  updateStoredItemViews();
  updateConstructionProgress();
  updateButcherProgress();
  updateEnvironmentViews();
  updateDeerViews();
  updateObjectProperties();
  updatePawnModeButton();
  updateItemSummary();
  updateStationInfo();
});

app.renderer.on('resize', applyCamera);
applyCamera();
