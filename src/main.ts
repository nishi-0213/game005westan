import { Application, Container, Graphics } from 'pixi.js';
import './style.css';
import { advanceMovement, createMovement, renderedPosition, setDestination } from './movement';
import type { Tile } from './movement';
import { dragTiles, Walls, WALL_COLORS, WALL_PLAN_ALPHA } from './walls';
import type { WallMaterial } from './walls';

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
  view.position.set((column + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE);
  map.addChild(view);
  return { view, selection, movement: createMovement({ column, row }) };
});
let selectedPawn: (typeof pawns)[number] | null = null;
const destinationMarkerLayer = new Container();
map.addChild(destinationMarkerLayer);
const destinationMarkers: { view: Graphics; ageSeconds: number }[] = [];
const MARKER_HOLD_SECONDS = 0.5;
const MARKER_FADE_SECONDS = 0.25;
app.stage.addChild(map);

let placingWalls = false;
let wallMaterial: WallMaterial = 'wood';
let drawingPointer: number | null = null;
let previousDragTile: Tile | null = null;
const constructionTab = document.querySelector<HTMLButtonElement>('.construction-tab')!;
const constructionSubtabs = document.querySelector<HTMLElement>('#construction-subtabs')!;
const buildingsTab = document.querySelector<HTMLButtonElement>('#buildings-tab')!;
const buildingOptions = document.querySelector<HTMLElement>('#building-options')!;
const wallButton = document.querySelector<HTMLButtonElement>('#wall-button')!;
const wallMaterials = document.querySelector<HTMLElement>('#wall-materials')!;

function stopDrawing(): void {
  if (drawingPointer !== null && app.canvas.hasPointerCapture(drawingPointer)) {
    app.canvas.releasePointerCapture(drawingPointer);
  }
  drawingPointer = null;
  previousDragTile = null;
}

function selectWall(enabled: boolean): void {
  placingWalls = enabled;
  wallButton.setAttribute('aria-pressed', String(enabled));
  app.canvas.style.cursor = enabled ? 'crosshair' : '';
  stopDrawing();
  if (enabled) {
    selectedPawn = null;
    for (const pawn of pawns) pawn.selection.visible = false;
  }
}

function hideMaterials(): void {
  wallMaterials.hidden = true;
  wallButton.setAttribute('aria-expanded', 'false');
}

function closeBuildings(): void {
  buildingOptions.hidden = true;
  buildingsTab.setAttribute('aria-expanded', 'false');
  hideMaterials();
  selectWall(false);
}

constructionTab.addEventListener('click', () => {
  constructionSubtabs.hidden = !constructionSubtabs.hidden;
  constructionTab.setAttribute('aria-expanded', String(!constructionSubtabs.hidden));
  if (constructionSubtabs.hidden) closeBuildings();
});
buildingsTab.addEventListener('click', () => {
  if (!buildingOptions.hidden) closeBuildings();
  else {
    buildingOptions.hidden = false;
    buildingsTab.setAttribute('aria-expanded', 'true');
  }
});
for (const button of constructionSubtabs.querySelectorAll<HTMLButtonElement>('button')) {
  if (button !== buildingsTab) button.addEventListener('click', closeBuildings);
}
wallButton.addEventListener('click', () => { selectWall(!placingWalls); hideMaterials(); });
wallButton.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  wallMaterials.hidden = !wallMaterials.hidden;
  wallButton.setAttribute('aria-expanded', String(!wallMaterials.hidden));
});
for (const button of wallMaterials.querySelectorAll<HTMLButtonElement>('button')) {
  button.addEventListener('click', () => {
    wallMaterial = button.dataset.material as WallMaterial;
    for (const choice of wallMaterials.querySelectorAll('button')) {
      choice.setAttribute('aria-pressed', String(choice === button));
    }
    selectWall(true);
    hideMaterials();
  });
}

function placeWall(tile: Tile): void {
  const wall = walls.plan(tile, wallMaterial);
  if (!wall) return;
  const view = new Graphics().rect(0, 0, TILE_SIZE, TILE_SIZE).fill(WALL_COLORS[wall.material]);
  view.position.set(tile.column * TILE_SIZE, tile.row * TILE_SIZE);
  view.alpha = WALL_PLAN_ALPHA;
  wallLayer.addChild(view);
  wallViews.set(`${tile.column},${tile.row}`, view);
}

// The future construction algorithm can call this when construction finishes.
// Do not complete walls beneath pawns or their active movement segments.
export function completeWall(tile: Tile): boolean {
  if (pawns.some(({ movement }) => {
    const occupied = [movement.tile, movement.nextTile];
    if (movement.nextTile && movement.nextTile.column !== movement.tile.column && movement.nextTile.row !== movement.tile.row) {
      occupied.push(
        { column: movement.nextTile.column, row: movement.tile.row },
        { column: movement.tile.column, row: movement.nextTile.row },
      );
    }
    return occupied.some((entry) => entry?.column === tile.column && entry.row === tile.row);
  })) return false;
  if (!walls.complete(tile)) return false;
  wallViews.get(`${tile.column},${tile.row}`)!.alpha = 1;
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
  for (const entry of dragTiles(previousDragTile ?? tile, tile)) placeWall(entry);
  previousDragTile = tile;
}

app.canvas.addEventListener('pointerdown', (event) => {
  const { x, y } = mapPosition(event);
  if (event.button === 0 && placingWalls) {
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
    for (const pawn of pawns) pawn.selection.visible = pawn === selectedPawn;
  } else if (event.button === 2 && selectedPawn) {
    const column = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    if (column >= 0 && column < MAP_SIZE && row >= 0 && row < MAP_SIZE && !walls.isBlocked({ column, row })) {
      setDestination(selectedPawn.movement, { column, row });
      showDestination(column, row);
    }
  }
});
app.canvas.addEventListener('pointermove', (event) => {
  if (drawingPointer === event.pointerId && placingWalls) drawWalls(event);
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  app.canvas.addEventListener(eventName, stopDrawing);
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
  for (const pawn of pawns) {
    advanceMovement(pawn.movement, ticker.deltaMS / 1000, walls.isBlocked);
    const position = renderedPosition(pawn.movement);
    pawn.view.position.set((position.column + 0.5) * TILE_SIZE, (position.row + 0.5) * TILE_SIZE);
  }
});

app.renderer.on('resize', applyCamera);
applyCamera();
