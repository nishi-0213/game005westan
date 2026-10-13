import { Application, Container, Graphics } from 'pixi.js';
import './style.css';

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

const spawnTiles = [
  { column: 15, row: 15, color: 0xf2c66d },
  { column: 16, row: 15, color: 0x82c6dc },
  { column: 15, row: 16, color: 0xdb96b5 },
];
for (const { column, row, color } of spawnTiles) {
  const pawn = new Graphics()
    .ellipse(0, 7, 7, 3).fill({ color: 0x17261c, alpha: 0.5 })
    .roundRect(-5, -1, 10, 10, 4).fill(color)
    .circle(0, -5, 4).fill(0xffe3bd)
    .stroke({ color: 0x25312a, width: 1 });
  pawn.position.set((column + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE);
  map.addChild(pawn);
}
app.stage.addChild(map);

function fitMap(): void {
  const scale = Math.min(app.screen.width, app.screen.height) / MAP_PIXELS;
  map.scale.set(scale);
  map.position.set(
    (app.screen.width - MAP_PIXELS * scale) / 2,
    (app.screen.height - MAP_PIXELS * scale) / 2,
  );
}
app.renderer.on('resize', fitMap);
fitMap();
