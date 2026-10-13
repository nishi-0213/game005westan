// Run against this checkout or pass a separate checkout directory for comparison.
// Deterministic 15-second simulation; excludes rendering and browser/GPU costs.
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
const load = name => import(pathToFileURL(`${root}/src/${name}.ts`));
const [{ Walls }, { Storage }, { Construction }, { Harvesting }, { Hauling }, { initialEnvironment },
  { createMovement }, { advancePathMovement }, { updateWork }] = await Promise.all([
  'walls', 'storage', 'construction', 'harvesting', 'hauling', 'environment', 'movement', 'pathfinding', 'work-priorities',
].map(load));

for (const scenario of ['harvesting', 'free']) {
  let seed = 42;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const walls = new Walls(32), items = [], objects = initialEnvironment(32, random);
  for (const object of objects) object.collect = true;
  const environmentByTile = new Map(objects.map(object => [`${object.column},${object.row}`, object]));
  walls.environmentCannotStop = tile => environmentByTile.get(`${tile.column},${tile.row}`)?.collected === false;
  const storage = new Storage(walls);
  const box = walls.plan({ column: 14, row: 14 }, 'wood', 'storage');
  walls.complete(box);
  storage.deposit(box, 'wood', 100);
  for (let row = 15; row < 18; row++) walls.plan({ column: 18, row }, 'wood');
  const construction = new Construction(walls, items, tile => walls.complete(tile));
  construction.storage = storage;
  const harvesting = new Harvesting(objects, items, walls), hauling = new Hauling(items, storage);
  const workers = [{ column: 15, row: 15 }, { column: 16, row: 15 }, { column: 15, row: 16 }].map(tile => ({
    movement: createMovement(tile), mode: 'automatic', inventory: null, job: null, retrySeconds: 0,
    harvestJob: null, harvestRetrySeconds: 0,
    priorities: { construction: 4, harvesting: scenario === 'harvesting' ? 1 : 3, hauling: 3, free: scenario === 'free' ? 1 : 4 },
  }));
  const start = performance.now();
  let movedSteps = 0;
  for (let step = 0; step < 900; step++) for (const worker of workers) {
    updateWork(worker, construction, harvesting, 1 / 60, random, 1 / 60, hauling);
    advancePathMovement(worker.movement, 1 / 60, 32, walls.isBlocked, walls.cannotStop);
    if (worker.movement.nextTile) movedSteps++;
  }
  console.log(JSON.stringify({ scenario, milliseconds: Math.round(performance.now() - start), simulationSeconds: 15, pawns: workers.length, movedSteps }));
}
