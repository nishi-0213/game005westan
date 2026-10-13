export interface Tile {
  column: number;
  row: number;
}

export interface Movement {
  tile: Tile;
  destination: Tile;
  nextTile: Tile | null;
  progress: number;
  route?: Tile[];
}

const TILES_PER_SECOND = 4;

export function createMovement(tile: Tile): Movement {
  return { tile: { ...tile }, destination: { ...tile }, nextTile: null, progress: 0 };
}

type TileRule = (tile: Tile) => boolean;
const allowAll: TileRule = () => false;

export function setDestination(movement: Movement, destination: Tile, isBlocked: TileRule = allowAll, cannotStop: TileRule = allowAll): boolean {
  if (isBlocked(destination) || cannotStop(destination)) return false;
  // When already crossing a barricade, reject orders that would strand the pawn there.
  const start = movement.nextTile ?? movement.tile;
  if (cannotStop(start) && !hasSafeExit(start, destination, isBlocked, cannotStop)) return false;
  movement.destination = { ...destination };
  movement.route = undefined;
  // Finish an active segment before changing direction, so every turn is at a tile center.
  return true;
}

function nextStep(tile: Tile, destination: Tile): Tile | null {
  if (tile.column !== destination.column || tile.row !== destination.row) {
    return {
      column: tile.column + Math.sign(destination.column - tile.column),
      row: tile.row + Math.sign(destination.row - tile.row),
    };
  }
  return null;
}

export function stopAtNextSafeTile(movement: Movement, cannotStop: TileRule = allowAll): void {
  let stop = movement.nextTile ?? movement.tile;
  const remaining = movement.route?.slice();
  const route: Tile[] = [];
  while (cannotStop(stop)) {
    const next = remaining ? remaining.shift() : nextStep(stop, movement.destination);
    if (!next) return;
    stop = next;
    route.push(next);
  }
  movement.destination = { ...stop };
  if (movement.route) movement.route = route;
}

export function setRoute(movement: Movement, route: Tile[]): void {
  movement.route = route.map((tile) => ({ ...tile }));
  movement.destination = { ...(route.at(-1) ?? movement.tile) };
}

export function movementHasSafeExit(movement: Movement, blocked: TileRule, cannotStop: TileRule): boolean {
  const start = movement.nextTile ?? movement.tile;
  if (!movement.route) return hasSafeExit(start, movement.destination, blocked, cannotStop);
  let current = start;
  for (const next of movement.route) {
    if (!cannotStop(current)) return !blocked(current);
    if (blockedStep(current, next, blocked)) return false;
    current = next;
  }
  return !cannotStop(current) && !blocked(current);
}

function blockedStep(from: Tile, to: Tile, isBlocked: TileRule): boolean {
  return isBlocked(to) || (to.column !== from.column && to.row !== from.row && (
    isBlocked({ column: to.column, row: from.row }) || isBlocked({ column: from.column, row: to.row })
  ));
}

export function hasSafeExit(from: Tile, destination: Tile, isBlocked: TileRule, cannotStop: TileRule): boolean {
  let current = from;
  while (cannotStop(current)) {
    const next = nextStep(current, destination);
    if (!next || blockedStep(current, next, isBlocked)) return false;
    current = next;
  }
  return !isBlocked(current);
}

export function advanceMovement(movement: Movement, seconds: number, isBlocked: TileRule = allowAll, cannotStop: TileRule = allowAll): void {
  let remaining = Math.max(0, seconds) * TILES_PER_SECOND;
  while (remaining > 0) {
    movement.nextTile ??= movement.route ? (movement.route.shift() ?? null) : nextStep(movement.tile, movement.destination);
    if (!movement.nextTile) return;
    const next = movement.nextTile;
    if (blockedStep(movement.tile, next, isBlocked)
      || !movementHasSafeExit(movement, isBlocked, cannotStop)) {
      movement.nextTile = null;
      movement.progress = 0;
      movement.destination = { ...movement.tile };
      movement.route = undefined;
      return;
    }
    const segmentLength = Math.hypot(
      movement.nextTile.column - movement.tile.column,
      movement.nextTile.row - movement.tile.row,
    );
    const progress = Math.min(remaining / segmentLength, 1 - movement.progress);
    movement.progress += progress;
    remaining = Math.max(0, remaining - progress * segmentLength);
    if (movement.progress >= 1) {
      movement.tile = movement.nextTile;
      movement.nextTile = null;
      movement.progress = 0;
    }
  }
}

export function renderedPosition(movement: Movement): Tile {
  const next = movement.nextTile ?? movement.tile;
  return {
    column: movement.tile.column + (next.column - movement.tile.column) * movement.progress,
    row: movement.tile.row + (next.row - movement.tile.row) * movement.progress,
  };
}
