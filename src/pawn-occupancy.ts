import type { Movement, Tile } from './movement';
import { setRoute } from './movement.ts';
import { findPaths } from './pathfinding.ts';

const key = (tile: Tile): string => `${tile.column},${tile.row}`;

/** Pawns may cross occupied cells, but their stopping cells are exclusive. */
export class PawnOccupancy {
  private cells = new Map<string, Set<Movement>>();
  private positions = new Map<Movement, Set<string>>();

  track(movement: Movement): void {
    movement.stopBlocked = tile => this.occupied(tile, movement);
    movement.reservationBlocked = tile => {
      for (const owner of this.cells.get(key(tile)) ?? []) {
        if (owner !== movement && owner.destination.column === tile.column && owner.destination.row === tile.row) return true;
      }
      return false;
    };
    movement.changed = () => this.refresh(movement);
    this.refresh(movement);
  }

  untrack(movement: Movement): void {
    for (const cell of this.positions.get(movement) ?? []) this.remove(cell, movement);
    this.positions.delete(movement);
    movement.stopBlocked = undefined;
    movement.reservationBlocked = undefined;
    movement.changed = undefined;
  }

  private remove(cell: string, movement: Movement): void {
    const owners = this.cells.get(cell)!;
    owners.delete(movement);
    if (!owners.size) this.cells.delete(cell);
  }

  private refresh(movement: Movement): void {
    const next = new Set([key(movement.tile), key(movement.destination)]);
    if (movement.nextTile) next.add(key(movement.nextTile));
    const previous = this.positions.get(movement);
    for (const cell of previous ?? []) if (!next.has(cell)) this.remove(cell, movement);
    for (const cell of next) if (!previous?.has(cell)) {
      let owners = this.cells.get(cell);
      if (!owners) { owners = new Set(); this.cells.set(cell, owners); }
      owners.add(movement);
    }
    this.positions.set(movement, next);
  }

  occupied(tile: Tile, except?: Movement): boolean {
    const owners = this.cells.get(key(tile));
    return Boolean(owners && (owners.size > 1 || !owners.has(except!)));
  }
}

/** Assign nearby, reachable, distinct destinations, reserving each immediately. */
export function commandGroup(movements: Movement[], target: Tile, size: number,
  blocked: (tile: Tile) => boolean, cannotStop: (tile: Tile) => boolean,
  occupancy: PawnOccupancy): Tile[] {
  if (!movements.length || target.column < 0 || target.row < 0 || target.column >= size || target.row >= size
    || blocked(target) || cannotStop(target) || occupancy.occupied(target)) return [];
  const candidates: Tile[] = movements.length === 1 ? [target] : [];
  if (movements.length > 1) for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) candidates.push({ column, row });
  const distance = (tile: Tile) => (tile.column - target.column) ** 2 + (tile.row - target.row) ** 2;
  candidates.sort((a, b) => distance(a) - distance(b));
  const destinations: Tile[] = [];
  for (const movement of movements) {
    const paths = findPaths(movement.nextTile ?? movement.tile, size, blocked, cannotStop, movement);
    for (const goal of candidates) {
      if (occupancy.occupied(goal)) continue;
      const path = paths.get(goal.row * size + goal.column);
      if (path && setRoute(movement, path.tiles)) { destinations.push(goal); break; }
    }
  }
  return destinations;
}
