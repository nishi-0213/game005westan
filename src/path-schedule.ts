import type { Movement } from './movement';

export const PATH_SEARCH_PERIOD = 60;
export const ROAMING_PERIOD_STEPS = PATH_SEARCH_PERIOD * 5;
/** Stable lifetime IDs: removing a pawn never shifts another pawn's slot. */
export class PathSearchSchedule {
  frame = -1;
  private nextId = 0;
  private readonly ids = new WeakMap<Movement, number>();
  advance(): void { this.frame++; }
  assign(movement: Movement): void {
    let id = this.ids.get(movement);
    if (id === undefined) { id = this.nextId++; this.ids.set(movement, id); }
    movement.planningAllowed = this.frame % PATH_SEARCH_PERIOD === id % PATH_SEARCH_PERIOD;
    // Spread first60 IDs across all five seconds; later IDs use the next cycle.
    const cycle = (id + Math.floor(id / PATH_SEARCH_PERIOD)) % 5;
    const roamingPhase = id % PATH_SEARCH_PERIOD + cycle * PATH_SEARCH_PERIOD;
    movement.roamingAllowed = this.frame % ROAMING_PERIOD_STEPS === roamingPhase;
  }
}
// Unscheduled callers (including direct player commands) retain synchronous APIs.
export const canPlan = (movement: Movement): boolean => movement.planningAllowed !== false;

export const canRoam = (movement: Movement): boolean => movement.roamingAllowed !== false;
