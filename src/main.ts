import { Application, Container, Graphics, Text } from 'pixi.js';
import './style.css';
import { advanceMovement, createMovement, movementHasSafeExit, renderedPosition, setDestination, stopAtNextSafeTile } from './movement';
import type { Tile } from './movement';
import { BUILD_RECIPES, dragTiles, Walls, WALL_COLORS, WALL_PLAN_ALPHA } from './walls';
import type { ConstructionKind, WallMaterial } from './walls';
import { countItems, initialItems, ITEM_APPEARANCE, ITEM_TYPES, returnItems } from './items';
import { Construction } from './construction';
import type { Builder } from './construction';

const MAP_SIZE = 32;
const TILE_SIZE = 24;
const MAP_PIXELS = MAP_SIZE * TILE_SIZE;
const app = new Application();

await app.init({
  resizeTo: window,
  background: '#151d19',
  antialias: true,
  resolution: window.devicePixelRatio || 1,
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
const mapItems = initialItems();
let selectedItem: (typeof mapItems)[number] | null = null;
const itemLayer = new Container();
const itemViews: { item: (typeof mapItems)[number]; view: Container; quantity: Text }[] = [];
map.addChild(itemLayer);
function createItemView(item: (typeof mapItems)[number]): void {
  const view = new Container();
  view.position.set((item.column + 0.5) * TILE_SIZE, item.row * TILE_SIZE);
  const icon = new Graphics().rect(-6, 1, 12, 12).fill(ITEM_APPEARANCE[item.type].color);
  const quantity = new Text({
    text: String(item.quantity),
    style: { fontFamily: 'sans-serif', fontSize: 8, lineHeight: 9, fill: 0xffffff, stroke: { color: 0x152019, width: 2 } },
  });
  quantity.anchor.set(0.5, 0);
  quantity.position.set(0, 14);
  view.addChild(icon, quantity);
  itemLayer.addChild(view);
  itemViews.push({ item, view, quantity });
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
  if (selectedItem && (selectedItem.quantity <= 0 || !mapItems.includes(selectedItem))) {
    selectedItem = null;
    updateItemSelection();
  }
  for (const item of mapItems) if (!itemViews.some((entry) => entry.item === item)) createItemView(item);
  for (const { item, view, quantity } of itemViews) {
    view.visible = item.quantity > 0;
    if (quantity.text !== String(item.quantity)) quantity.text = String(item.quantity);
  }
  const totals = countItems(mapItems);
  for (const entry of summaryRows) {
    if (entry.total === totals[entry.type]) continue;
    entry.total = totals[entry.type];
    entry.quantity.textContent = `：${entry.total}`;
    entry.row.setAttribute('aria-label', `${ITEM_APPEARANCE[entry.type].name}：${entry.total}`);
  }
}
updateItemSummary();

const walls = new Walls(MAP_SIZE);
const wallLayer = new Container();
const wallViews = new Map<string, Graphics>();
map.addChild(wallLayer);

const spawnTiles = [
  { column: 15, row: 15, color: 0xf2c66d },
  { column: 16, row: 15, color: 0x82c6dc },
  { column: 15, row: 16, color: 0xdb96b5 },
];
const pawns = spawnTiles.map(({ column, row, color }) => {
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
  const builder: Builder = { movement: createMovement({ column, row }), mode: 'drafted', inventory: null, job: null, retrySeconds: 0 };
  return { view, selection, heldItem, ...builder };
});
const construction = new Construction(walls, mapItems, completeConstruction);
const constructionProgressLayer = new Container();
map.addChild(constructionProgressLayer);
const constructionProgressViews = new Map<string, { view: Graphics; progress: number }>();

function updateConstructionProgress(): void {
  for (const [key, entry] of constructionProgressViews) {
    const building = walls.items.get(key)!;
    const recipe = BUILD_RECIPES[building.kind];
    const progress = recipe ? Math.min(1, building.workSeconds / recipe.seconds) : 0;
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

function updatePawnPanels(): void {
  dropInventoryButton.hidden = selectedPawn === null;
  dropInventoryButton.disabled = !selectedPawn?.inventory?.quantity || Boolean(selectedPawn.dropRequested);
  pawnSpecs.hidden = selectedPawn === null;
  if (!selectedPawn) return;
  const visibleMenus = document.querySelectorAll<HTMLElement>('.construction-subtabs, .building-options, .wall-materials');
  let top = window.innerHeight - 40;
  for (const menu of visibleMenus) if (!menu.hidden) top = Math.min(top, menu.getBoundingClientRect().top);
  pawnSpecs.style.bottom = `${window.innerHeight - top}px`;
}
dropInventoryButton.addEventListener('click', () => {
  if (selectedPawn) construction.requestDrop(selectedPawn);
  updatePawnPanels();
});
const itemInfoButton = document.querySelector<HTMLButtonElement>('#item-info-button')!;
const itemProperties = document.querySelector<HTMLDialogElement>('#item-properties')!;
const itemPropertiesName = document.querySelector<HTMLElement>('#item-properties-name')!;
const itemPropertiesMass = document.querySelector<HTMLElement>('#item-properties-mass')!;

function updateItemSelection(): void {
  itemInfoButton.hidden = selectedItem === null;
  itemSelection.visible = selectedItem !== null;
  pawnModeButton.hidden = selectedItem !== null;
  if (selectedItem) {
    const properties = ITEM_APPEARANCE[selectedItem.type];
    itemSelection.position.set(selectedItem.column * TILE_SIZE, selectedItem.row * TILE_SIZE);
    itemPropertiesName.textContent = properties.name;
    itemPropertiesMass.textContent = `${properties.massKg}kg`;
  } else itemProperties.close();
}
itemInfoButton.addEventListener('click', () => {
  if (selectedItem && !itemProperties.open) itemProperties.show();
});
document.querySelector<HTMLButtonElement>('#close-item-properties')!.addEventListener('click', () => itemProperties.close());
itemProperties.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); itemProperties.close(); }
});

function updatePawnModeButton(): void {
  const drafted = selectedPawn?.mode !== 'automatic';
  pawnModeButton.disabled = selectedPawn === null;
  updatePawnPanels();
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
  construction.cancel(selectedPawn);
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
const constructionMaterials: Record<ConstructionKind, WallMaterial> = { wall: 'wood', barricade: 'wood' };
let drawingPointer: number | null = null;
let previousDragTile: Tile | null = null;
const constructionTab = document.querySelector<HTMLButtonElement>('.construction-tab')!;
const constructionSubtabs = document.querySelector<HTMLElement>('#construction-subtabs')!;
const constructionChoices = [
  { kind: 'wall' as const, tabId: '#buildings-tab', optionsId: '#building-options', buttonId: '#wall-button', materialsId: '#wall-materials' },
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
    choice.button.textContent = `${choice.kind === 'wall' ? '壁' : 'バリケード'}（${ITEM_APPEARANCE[constructionMaterials[choice.kind]].name}）`;
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
  constructionSubtabs.hidden = !constructionSubtabs.hidden;
  constructionTab.setAttribute('aria-expanded', String(!constructionSubtabs.hidden));
  if (constructionSubtabs.hidden) closeConstructionOptions();
});
for (const button of constructionSubtabs.querySelectorAll<HTMLButtonElement>('button')) {
  if (!constructionChoices.some((choice) => choice.tab === button)) button.addEventListener('click', closeConstructionOptions);
}
for (const choice of constructionChoices) {
  choice.tab.addEventListener('click', () => {
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
  const lowerHalf = wall.kind === 'barricade';
  const view = new Graphics()
    .rect(0, lowerHalf ? TILE_SIZE / 2 : 0, TILE_SIZE, lowerHalf ? TILE_SIZE / 2 : TILE_SIZE)
    .fill(WALL_COLORS[wall.material]);
  view.position.set(tile.column * TILE_SIZE, tile.row * TILE_SIZE);
  view.alpha = WALL_PLAN_ALPHA;
  wallLayer.addChild(view);
  wallViews.set(`${tile.column},${tile.row}`, view);
  const progressView = new Graphics();
  progressView.position.set(tile.column * TILE_SIZE, (tile.row + 1) * TILE_SIZE + 1);
  progressView.visible = false;
  constructionProgressLayer.addChild(progressView);
  constructionProgressViews.set(`${tile.column},${tile.row}`, { view: progressView, progress: -1 });
}

// Finalize only when no pawn or active route would be trapped by the new structure.
export function completeConstruction(tile: Tile): boolean {
  const item = walls.items.get(`${tile.column},${tile.row}`);
  if (!item || item.state === 'completed') return false;
  const sameTile = (entry: Tile): boolean => entry.column === tile.column && entry.row === tile.row;
  const blockedAfter = (entry: Tile): boolean => walls.isBlocked(entry) || (item.kind === 'wall' && sameTile(entry));
  const cannotStopAfter = (entry: Tile): boolean => walls.cannotStop(entry) || (item.kind === 'barricade' && sameTile(entry));
  if (pawns.some(({ movement }) => {
    const occupied = [movement.tile, movement.nextTile, movement.destination];
    if (item.kind === 'wall' && movement.nextTile && movement.nextTile.column !== movement.tile.column && movement.nextTile.row !== movement.tile.row) {
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

function mapPosition(event: PointerEvent): { x: number; y: number } {
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
  if (event.button === 2 && selectedConstruction) {
    selectConstruction(null);
    hideMaterials();
    return;
  }
  if (event.button === 2 && removeConstructionPlan({ column: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) })) return;
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
    updateItemSelection();
    for (const pawn of pawns) pawn.selection.visible = pawn === selectedPawn;
    updatePawnModeButton();
  } else if (event.button === 2 && selectedPawn?.mode === 'drafted') {
    const column = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    if (column >= 0 && column < MAP_SIZE && row >= 0 && row < MAP_SIZE
      && setDestination(selectedPawn.movement, { column, row }, walls.isBlocked, walls.cannotStop)) {
      showDestination(column, row);
    }
  }
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
    construction.update(pawn, ticker.deltaMS / 1000);
    advanceMovement(pawn.movement, ticker.deltaMS / 1000, walls.isBlocked, walls.cannotStop);
    const position = renderedPosition(pawn.movement);
    pawn.view.position.set((position.column + 0.5) * TILE_SIZE, (position.row + 0.5) * TILE_SIZE);
    pawn.heldItem.visible = Boolean(pawn.inventory?.quantity);
    if (pawn.inventory) pawn.heldItem.tint = ITEM_APPEARANCE[pawn.inventory.type].color;
  }
  for (const [key, view] of wallViews) if (walls.items.get(key)?.state === 'completed') view.alpha = 1;
  updateConstructionProgress();
  updatePawnPanels();
  updateItemSummary();
});

app.renderer.on('resize', applyCamera);
applyCamera();
