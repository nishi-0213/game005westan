export interface Tile {
  column: number;
  row: number;
}

export interface Movement {
  tile: Tile;
  destination: Tile;
  nextTile: Tile | null;
  progress: number;
}

const TILES_PER_SECOND = 4;

export function createMovement(tile: Tile): Movement {
  return { tile: { ...tile }, destination: { ...tile }, nextTile: null, progress: 0 };
}

export function setDestination(movement: Movement, destination: Tile): void {
  movement.destination = { ...destination };
  // Finish an active segment before changing direction, so every turn is at a tile center.
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

export function advanceMovement(movement: Movement, seconds: number, isBlocked: (tile: Tile) => boolean = () => false): void {
  let remaining = Math.max(0, seconds) * TILES_PER_SECOND;
  while (remaining > 0) {
    movement.nextTile ??= nextStep(movement.tile, movement.destination);
    if (!movement.nextTile) return;
    const next = movement.nextTile;
    const diagonal = next.column !== movement.tile.column && next.row !== movement.tile.row;
    if (isBlocked(next) || (diagonal && (
      isBlocked({ column: next.column, row: movement.tile.row })
      || isBlocked({ column: movement.tile.column, row: next.row })
    ))) {
      movement.nextTile = null;
      movement.progress = 0;
      movement.destination = { ...movement.tile };
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
