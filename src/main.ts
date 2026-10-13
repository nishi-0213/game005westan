import { Application, Container, Graphics, Text } from 'pixi.js';
import './style.css';
import { createMovement, movementHasSafeExit, renderedPosition, stopAtNextSafeTile } from './movement';
import { advancePathMovement, commandMove } from './pathfinding';
import type { Tile } from './movement';
import { BUILD_RECIPES, dragTiles, Walls, WALL_COLORS, WALL_PLAN_ALPHA } from './walls';
import type { ConstructionKind, WallMaterial, Wall } from './walls';
import { nearbyItems, initialItems, ITEM_APPEARANCE, ITEM_TYPES, returnItems } from './items';
import { Storage } from './storage';
import { Hauling } from './hauling';
import type { HaulWorker } from './hauling';
import { Construction } from './construction';
import { ENVIRONMENT_PROPERTIES, initialEnvironment, nearbySameType } from './environment';
import type { EnvironmentObject } from './environment';
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
let selectedEnvironment = new Set<EnvironmentObject>();
const environmentLayer = new Container();
const environmentHud = new Container();
map.addChild(environmentLayer);
const environmentViews = environmentObjects.map((object) => {
  const view = new Container();
  view.position.set((object.column + 0.5) * TILE_SIZE, (object.row + 0.5) * TILE_SIZE);
  const outline = new Graphics().rect(-11, -11, 22, 22).stroke({ color: 0xfff2a3, width: 1.5 });
  outline.visible = false;
  const shape = new Graphics();
  if (object.type === 'tree') shape.rect(-2, 1, 4, 8).fill(0x916039).circle(0, -3, 8).fill(0x8fba7a);
  else shape.ellipse(0, 1, 9, 7).fill(0xb6b6b6);
  const collectIcon = new Graphics()
    .moveTo(-4, -2).lineTo(0, -4).lineTo(4, -2).stroke({ color: 0xf2c66d, width: 2 })
    .moveTo(0, -3).lineTo(-3, 3).stroke({ color: 0xf2c66d, width: 2 });
  collectIcon.position.set(view.x, view.y - 16);
  collectIcon.visible = false;
  const progressBar = new Graphics();
  progressBar.position.set(object.column * TILE_SIZE, (object.row + 1) * TILE_SIZE + 1);
  progressBar.visible = false;
  view.addChild(outline, shape);
  environmentHud.addChild(collectIcon, progressBar);
  environmentLayer.addChild(view);
  return { object, view, outline, collectIcon, progressBar, progress: -1 };
});
const walls = new Walls(MAP_SIZE);
const storage = new Storage(walls);
const mapItems = initialItems();
let selectedItems = new Set<(typeof mapItems)[number]>();
let selectedItem: (typeof mapItems)[number] | null = null;
const itemLayer = new Container();
const itemViews: { item: (typeof mapItems)[number]; view: Container; quantity: Text; collectIcon: Graphics }[] = [];
map.addChild(itemLayer);
function createItemView(item: (typeof mapItems)[number]): void {
  const view = new Container();
  view.position.set((item.column + 0.5) * TILE_SIZE, item.row * TILE_SIZE);
  const icon = new Graphics().rect(-6, 1, 12, 12).fill(ITEM_APPEARANCE[item.type].color);
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
  itemViews.push({ item, view, quantity, collectIcon });
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
  for (const item of selectedItems) if (item.quantity <= 0 || !mapItems.includes(item)) { selectedItems.delete(item); selectionChanged = true; }
  if (selectionChanged) { selectedItem = [...selectedItems][0] ?? null; updateItemSelection(); }
  for (const item of mapItems) if (!itemViews.some((entry) => entry.item === item)) createItemView(item);
  for (const { item, view, quantity, collectIcon } of itemViews) {
    view.visible = item.quantity > 0;
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

walls.environmentCannotStop = (tile) => environmentObjects.some((object) => !object.collected && object.column === tile.column && object.row === tile.row);
const wallLayer = new Container();
const wallViews = new Map<string, Graphics>();
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
      view.addChild(icon, quantity);
      storedItemLayer.addChild(view);
      entry = { view, icon, quantity };
      storedItemViews.set(area, entry);
    }
    const type = ITEM_TYPES.find(type => (area.stored?.[type] ?? 0) > 0);
    entry.view.visible = Boolean(type);
    if (type) { entry.icon.tint = ITEM_APPEARANCE[type].color; entry.quantity.text = String(area.stored![type]); }
    entry.quantity.scale.set(1 / map.scale.x);
    entry.quantity.position.set(0, 13 + 2 / map.scale.y);
  }
}

const spawnTiles = [
  { column: 15, row: 15, color: 0xf2c66d },
  { column: 16, row: 15, color: 0x82c6dc },
  { column: 15, row: 16, color: 0xdb96b5 },
];
const pawnNames = generatePawnNames(spawnTiles.length);
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
  view.position.set((column + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE);
  map.addChild(view);
  const builder: HarvestWorker & HaulWorker = { movement: createMovement({ column, row }), mode: 'drafted', inventory: null, job: null, retrySeconds: 0, harvestJob: null, harvestRetrySeconds: 0 };
  return { view, selection, heldItem, ...builder, name: pawnNames[index], priorities: { ...INITIAL_PRIORITIES[index] } };
});
const needsClearing = (tile: Tile) => environmentObjects.some((object) => !object.collected && object.column === tile.column && object.row === tile.row);
const construction = new Construction(walls, mapItems, completeConstruction, needsClearing);
construction.storage = storage;
const hauling = new Hauling(mapItems, storage);
const harvesting = new Harvesting(environmentObjects, mapItems, walls);
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
  for (const [task, label] of [['construction', '建設'], ['harvesting', '収集'], ['free', '自由']] as const) {
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
const constructionProgressViews = new Map<string, { view: Graphics; progress: number }>();

function updateConstructionProgress(): void {
  for (const [key, entry] of constructionProgressViews) {
    const building = walls.items.get(key)!;
    const recipe = BUILD_RECIPES[building.kind];
    const progress = recipe && recipe.seconds > 0 ? Math.min(1, building.workSeconds / recipe.seconds) : 0;
    entry.view.visible = building.state === 'planned' && progress > 0 && progress < 1;
    if (!entry.view.visible || entry.progress === progress) continue;
    entry.progress = progress;
    entry.view.clear()
      .rect(0, 0, TILE_SIZE, 4).fill(0x152019)
      .rect(1, 1, (TILE_SIZE - 2) * progress, 2).fill(0xf2c66d);
  }
}
let selectedPawn: (typeof pawns)[number] | null = null;
const pawnModeButton = document.querySelector<HTMLButtonElement>('#pawn-mode-button')!;
const pawnModeIcon = document.querySelector<HTMLElement>('#pawn-mode-icon')!;
const pawnModeLabel = document.querySelector<HTMLElement>('#pawn-mode-label')!;
const dropInventoryButton = document.querySelector<HTMLButtonElement>('#drop-inventory-button')!;
const pawnSpecs = document.querySelector<HTMLElement>('#pawn-specs')!;
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
  button.addEventListener('click', () => selectPawn(pawn));
  button.addEventListener('dblclick', () => {
    selectPawn(pawn);
    camera.x = pawn.view.x;
    camera.y = pawn.view.y;
    applyCamera();
  });
  pawnRoster.appendChild(button);
  return { pawn, button };
});

function selectPawn(pawn: (typeof pawns)[number]): void {
  selectConstruction(null);
  selectedPawn = pawn;
  selectedItem = null;
  selectedItems.clear();
  selectedEnvironment.clear();
  for (const entry of pawns) entry.selection.visible = entry === pawn;
  updateItemSelection();
  updatePawnModeButton();
}

function updatePawnPanels(): void {
  dropInventoryButton.hidden = selectedPawn === null;
  dropInventoryButton.disabled = !selectedPawn?.inventory?.quantity || Boolean(selectedPawn.dropRequested);
  pawnSpecs.hidden = selectedPawn === null;
  if (!selectedPawn) return;
  const action = currentAction(selectedPawn);
  if (pawnSpecs.textContent !== action) pawnSpecs.textContent = action;
  const visibleMenus = document.querySelectorAll<HTMLElement>('.construction-subtabs, .building-options, .wall-materials');
  let top = window.innerHeight - 40;
  for (const menu of visibleMenus) if (!menu.hidden) top = Math.min(top, menu.getBoundingClientRect().top);
  pawnSpecs.style.bottom = `${window.innerHeight - top}px`;
}
dropInventoryButton.addEventListener('click', () => {
  if (selectedPawn) { hauling.cancel(selectedPawn); harvesting.cancel(selectedPawn); construction.requestDrop(selectedPawn); }
  updatePawnPanels();
});
const itemInfoButton = document.querySelector<HTMLButtonElement>('#item-info-button')!;
const itemProperties = document.querySelector<HTMLDialogElement>('#item-properties')!;
const itemPropertiesName = document.querySelector<HTMLElement>('#item-properties-name')!;
const itemPropertiesMass = document.querySelector<HTMLElement>('#item-properties-mass')!;
const acquisitionButton = document.querySelector<HTMLButtonElement>('#acquisition-button')!;
const collectionButton = document.querySelector<HTMLButtonElement>('#collection-button')!;
const harvestSpeed = document.querySelector<HTMLElement>('#environment-harvest-speed')!;
const harvestQuantity = document.querySelector<HTMLElement>('#environment-harvest-quantity')!;

const storageSettings = document.querySelector<HTMLDialogElement>('#storage-settings')!;
let configuredBox: Wall | null = null;
function updateStorageSettings(): void {
  if (!configuredBox) return;
  for (const type of ITEM_TYPES) {
    document.querySelector<HTMLElement>(`#stored-${type}`)!.textContent = `：${configuredBox.stored?.[type] ?? 0}`;
    document.querySelector<HTMLInputElement>(`[data-storage-type="${type}"]`)!.checked = configuredBox.accepted?.[type] !== false;
  }
}
function openStorageSettings(box: Wall): void {
  configuredBox = box;
  updateStorageSettings();
  if (!storageSettings.open) storageSettings.show();
}
for (const input of document.querySelectorAll<HTMLInputElement>('[data-storage-type]')) {
  input.addEventListener('change', () => {
    if (!configuredBox) return;
    configuredBox.accepted ??= { wood: true, stone: true };
    configuredBox.accepted[input.dataset.storageType as WallMaterial] = input.checked;
  });
}
document.querySelector<HTMLButtonElement>('#close-storage-settings')!.addEventListener('click', () => storageSettings.close());
storageSettings.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); storageSettings.close(); } });

function updateEnvironmentViews(): void {
  let changed = false;
  for (const object of selectedEnvironment) if (object.collected) { selectedEnvironment.delete(object); changed = true; }
  for (const entry of environmentViews) {
    entry.view.visible = !entry.object.collected;
    entry.outline.visible = selectedEnvironment.has(entry.object);
    entry.collectIcon.visible = entry.object.collect && !entry.object.collected;
    const progress = Math.min(1, entry.object.workSeconds / ENVIRONMENT_PROPERTIES[entry.object.type].seconds);
    entry.progressBar.visible = !entry.object.collected && progress > 0 && progress < 1;
    if (entry.progressBar.visible && entry.progress !== progress) {
      entry.progress = progress;
      entry.progressBar.clear().rect(0, 0, TILE_SIZE, 4).fill(0x152019)
        .rect(1, 1, (TILE_SIZE - 2) * progress, 2).fill(0xf2c66d);
    }
  }
  if (changed) updateItemSelection();
}
collectionButton.addEventListener('click', () => {
  const collect = ![...selectedEnvironment].every((object) => object.collect);
  for (const object of selectedEnvironment) object.collect = collect;
  updateItemSelection();
});

acquisitionButton.addEventListener('click', () => {
  const collect = ![...selectedItems].every(item => item.collect);
  for (const item of selectedItems) item.collect = collect;
  updateItemSelection();
});

function updateItemSelection(): void {
  const environment = [...selectedEnvironment][0];
  const hasSelection = selectedItem !== null || Boolean(environment);
  itemInfoButton.hidden = !hasSelection;
  itemInfoButton.setAttribute('aria-label', environment ? '環境オブジェクトのインフォメーション' : 'アイテムのインフォメーション');
  acquisitionButton.hidden = !selectedItems.size;
  const acquire = selectedItems.size > 0 && [...selectedItems].every(item => item.collect);
  acquisitionButton.textContent = acquire ? '取得' : '無視';
  acquisitionButton.setAttribute('aria-pressed', String(acquire));
  collectionButton.hidden = !environment;
  collectionButton.textContent = [...selectedEnvironment].every((object) => object.collect) ? '収集' : '無視';
  collectionButton.setAttribute('aria-pressed', String(Boolean(environment) && [...selectedEnvironment].every((object) => object.collect)));
  for (const element of document.querySelectorAll<HTMLElement>('[data-item-property]')) element.hidden = !selectedItem;
  for (const element of document.querySelectorAll<HTMLElement>('[data-environment-property]')) element.hidden = !environment;
  itemSelection.visible = selectedItems.size > 0;
  itemSelection.clear();
  for (const item of selectedItems) itemSelection.rect(item.column * TILE_SIZE + 1, item.row * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  if (selectedItems.size) itemSelection.stroke({ color: 0xfff2a3, width: 1.5 });
  pawnModeButton.hidden = hasSelection;
  if (selectedItem) {
    const properties = ITEM_APPEARANCE[selectedItem.type];

    itemPropertiesName.textContent = properties.name;
    itemPropertiesMass.textContent = `${properties.massKg}kg`;
  } else if (environment) {
    const properties = ENVIRONMENT_PROPERTIES[environment.type];
    itemPropertiesName.textContent = properties.name;
    harvestSpeed.textContent = `${properties.seconds}s`;
    harvestQuantity.textContent = String(properties.quantity);
  } else itemProperties.close();
  updateEnvironmentViews();
}
itemInfoButton.addEventListener('click', () => {
  if ((selectedItem || selectedEnvironment.size) && !itemProperties.open) itemProperties.show();
});
document.querySelector<HTMLButtonElement>('#close-item-properties')!.addEventListener('click', () => itemProperties.close());
itemProperties.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); itemProperties.close(); }
});

function updatePawnModeButton(): void {
  const drafted = selectedPawn?.mode !== 'automatic';
  pawnModeButton.disabled = selectedPawn === null;
  updatePawnPanels();
  for (const entry of rosterButtons) entry.button.setAttribute('aria-pressed', String(entry.pawn === selectedPawn));
  pawnModeIcon.textContent = drafted ? '⚔' : '⚙';
  pawnModeLabel.textContent = drafted ? '徴兵' : '自動';
  pawnModeButton.dataset.mode = drafted ? 'drafted' : 'automatic';
  pawnModeButton.setAttribute('aria-label', selectedPawn
    ? `ポーンの状態：${drafted ? '徴兵' : '自動'}。${drafted ? '自動' : '徴兵'}へ切り替え`
    : 'ポーンを選択して状態を切り替え');
}

pawnModeButton.addEventListener('click', () => {
  if (!selectedPawn) return;
  selectedPawn.mode = selectedPawn.mode === 'drafted' ? 'automatic' : 'drafted';
  hauling.cancel(selectedPawn);
  construction.cancel(selectedPawn);
  harvesting.cancel(selectedPawn);
  if (selectedPawn.mode === 'automatic') stopAtNextSafeTile(selectedPawn.movement, walls.cannotStop);
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
const constructionMaterials: Record<ConstructionKind, WallMaterial> = { wall: 'wood', barricade: 'wood', storage: 'wood', storageArea: 'wood' };
let drawingPointer: number | null = null;
let previousDragTile: Tile | null = null;
const constructionTab = document.querySelector<HTMLButtonElement>('.construction-tab')!;
const constructionSubtabs = document.querySelector<HTMLElement>('#construction-subtabs')!;
const constructionChoices = [
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
    choice.button.textContent = `${choice.kind === 'wall' ? '壁' : choice.kind === 'storage' ? '保管箱' : 'バリケード'}（${ITEM_APPEARANCE[constructionMaterials[choice.kind]].name}）`;
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
  selectedConstruction = kind;
  for (const choice of constructionChoices) choice.button.setAttribute('aria-pressed', String(choice.kind === kind));
  app.canvas.style.cursor = kind ? 'crosshair' : '';
  stopDrawing();
  if (kind) {
    selectedPawn = null;
    selectedItem = null;
    selectedItems.clear();
    selectedEnvironment.clear();
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
  if (!constructionChoices.some((choice) => choice.tab === button)) button.addEventListener('click', closeConstructionOptions);
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
    if (choice.kind === 'storage' || choice.kind === 'storageArea') return;
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

function placeConstruction(tile: Tile): void {
  if (!selectedConstruction) return;
  const wall = walls.plan(tile, constructionMaterials[selectedConstruction], selectedConstruction);
  if (!wall) return;
  const environment = environmentObjects.find((object) => !object.collected && object.column === tile.column && object.row === tile.row);
  if (environment) environment.collect = true;
  const lowerHalf = wall.kind === 'barricade';
  const view = new Graphics()
    .rect(0, lowerHalf ? TILE_SIZE / 2 : 0, TILE_SIZE, lowerHalf ? TILE_SIZE / 2 : TILE_SIZE)
    .fill(WALL_COLORS[wall.material]);
  if (wall.kind === 'storageArea') view.clear().rect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2).fill({ color: 0xd7b97d, alpha: 0.15 }).stroke({ color: 0xd7b97d, width: 1 });
  if (wall.kind === 'storage') view.rect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4).stroke({ color: 0xd7b97d, width: 2 }).moveTo(2, 8).lineTo(TILE_SIZE - 2, 8).stroke({ color: 0xd7b97d, width: 1 }).rect(10, 7, 4, 5).fill(0xd7b97d);
  view.position.set(tile.column * TILE_SIZE, tile.row * TILE_SIZE);
  view.alpha = WALL_PLAN_ALPHA;
  wallLayer.addChild(view);
  wallViews.set(`${tile.column},${tile.row}`, view);
  const progressView = new Graphics();
  progressView.position.set(tile.column * TILE_SIZE, (tile.row + 1) * TILE_SIZE + 1);
  progressView.visible = false;
  constructionProgressLayer.addChild(progressView);
  constructionProgressViews.set(`${tile.column},${tile.row}`, { view: progressView, progress: -1 });
  if (wall.kind === 'storageArea' && !needsClearing(tile)) { walls.complete(tile); view.alpha = 1; }
}

// Finalize only when no pawn or active route would be trapped by the new structure.
export function completeConstruction(tile: Tile): boolean {
  const item = walls.items.get(`${tile.column},${tile.row}`);
  if (!item || item.state === 'completed') return false;
  if (needsClearing(tile)) return false;
  const sameTile = (entry: Tile): boolean => entry.column === tile.column && entry.row === tile.row;
  const blockedAfter = (entry: Tile): boolean => walls.isBlocked(entry) || ((item.kind === 'wall' || item.kind === 'storage') && sameTile(entry));
  const cannotStopAfter = (entry: Tile): boolean => walls.cannotStop(entry) || (item.kind === 'barricade' && sameTile(entry));
  if (pawns.some(({ movement }) => {
    const occupied = [movement.tile, movement.nextTile, movement.destination];
    if ((item.kind === 'wall' || item.kind === 'storage') && movement.nextTile && movement.nextTile.column !== movement.tile.column && movement.nextTile.row !== movement.tile.row) {
      occupied.push(
        { column: movement.nextTile.column, row: movement.tile.row },
        { column: movement.tile.column, row: movement.nextTile.row },
      );
    }
    return occupied.some((entry) => entry && sameTile(entry))
      || !movementHasSafeExit(movement, blockedAfter, cannotStopAfter);
  })) return false;
  if (!walls.complete(tile)) return false;
  wallViews.get(`${tile.column},${tile.row}`)!.alpha = 1;
  return true;
}

export const completeWall = completeConstruction;

function removeConstructionPlan(tile: Tile): boolean {
  const removed = walls.removePlan(tile);
  if (!removed) return false;
  for (const pawn of pawns) if (pawn.job?.target === removed) construction.cancel(pawn);
  returnItems(mapItems, tile, removed.material, removed.delivered);
  const key = `${tile.column},${tile.row}`;
  wallViews.get(key)?.destroy();
  wallViews.delete(key);
  constructionProgressViews.get(key)?.view.destroy();
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
  for (const { quantity } of itemViews) {
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
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
    event.preventDefault();
    cameraKeys.add(event.code);
  }
});
window.addEventListener('keyup', (event) => cameraKeys.delete(event.code));
window.addEventListener('blur', () => { cameraKeys.clear(); stopDrawing(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cameraKeys.clear();
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
  for (const entry of dragTiles(previousDragTile ?? tile, tile)) placeConstruction(entry);
  previousDragTile = tile;
}

app.canvas.addEventListener('pointerdown', (event) => {
  const { x, y } = mapPosition(event);
  if (event.button === 2 && removeConstructionPlan({ column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) })) {
    if (selectedConstruction) { selectConstruction(null); hideMaterials(); }
    return;
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
    const clickedPawn = [...pawns].reverse().find(({ view }) =>
      Math.abs(view.x - x) <= TILE_SIZE * 0.45 && Math.abs(view.y - y) <= TILE_SIZE * 0.45,
    );
    selectedPawn = clickedPawn ?? null;
    const column = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    selectedItem = clickedPawn || walls.isBlocked({ column, row }) ? null
      : [...mapItems].reverse().find((item) => item.quantity > 0 && item.column === column && item.row === row) ?? null;
    selectedItems = new Set(selectedItem ? [selectedItem] : []);
    const environment = !clickedPawn && !selectedItem && !walls.isBlocked({ column, row })
      ? environmentObjects.find((object) => !object.collected && object.column === column && object.row === row) : undefined;
    selectedEnvironment = new Set(environment ? [environment] : []);
    updateItemSelection();
    for (const pawn of pawns) pawn.selection.visible = pawn === selectedPawn;
    updatePawnModeButton();
  } else if (event.button === 2 && selectedPawn?.mode === 'drafted') {
    const column = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    if (column >= 0 && column < MAP_SIZE && row >= 0 && row < MAP_SIZE
      && commandMove(selectedPawn.movement, { column, row }, MAP_SIZE, walls.isBlocked, walls.cannotStop)) {
      showDestination(column, row);
    }
  }
});
app.canvas.addEventListener('dblclick', (event) => {
  if (selectedConstruction) return;
  const { x, y } = mapPosition(event);
  const column = Math.floor(x / TILE_SIZE), row = Math.floor(y / TILE_SIZE);
  if (selectedItem && !selectedPawn) { selectedItems = new Set(nearbyItems(mapItems, selectedItem)); updateItemSelection(); return; }
  const object = environmentObjects.find((entry) => !entry.collected && entry.column === column && entry.row === row);
  if (!object || selectedPawn || selectedItem) return;
  selectedEnvironment = new Set(nearbySameType(environmentObjects, object));
  updateItemSelection();
});
app.canvas.addEventListener('pointermove', (event) => {
  if (drawingPointer === event.pointerId && selectedConstruction) drawWalls(event);
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  app.canvas.addEventListener(eventName, stopDrawing);
}

app.ticker.add((ticker) => {
  updateItemSummary();
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
  for (const pawn of pawns) {
    updateWork(pawn, construction, harvesting, ticker.deltaMS / 1000, Math.random, ticker.elapsedMS / 1000, hauling);
    advancePathMovement(pawn.movement, ticker.deltaMS / 1000, MAP_SIZE, walls.isBlocked, walls.cannotStop);
    const position = renderedPosition(pawn.movement);
    pawn.view.position.set((position.column + 0.5) * TILE_SIZE, (position.row + 0.5) * TILE_SIZE);
    pawn.heldItem.visible = Boolean(pawn.inventory?.quantity);
    if (pawn.inventory) pawn.heldItem.tint = ITEM_APPEARANCE[pawn.inventory.type].color;
  }
  for (const [key, view] of wallViews) if (walls.items.get(key)?.state === 'completed') view.alpha = 1;
  updateStorageSettings();
  updateStoredItemViews();
  updateConstructionProgress();
  updateEnvironmentViews();
  updatePawnPanels();
  updateItemSummary();
});

app.renderer.on('resize', applyCamera);
applyCamera();
