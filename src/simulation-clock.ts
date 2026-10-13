export type GameSpeed = 0 | 1 | 3;
export const SIMULATION_STEP_SECONDS = 1 / 60;

export class SimulationClock {
  speed: GameSpeed = 1;
  private pendingSeconds = 0;

  advance(realSeconds: number, update: (seconds: number) => void): void {
    if (this.speed === 0) return;
    this.pendingSeconds += Math.max(0, realSeconds) * this.speed;
    while (this.pendingSeconds + 1e-10 >= SIMULATION_STEP_SECONDS) {
      this.pendingSeconds = Math.max(0, this.pendingSeconds - SIMULATION_STEP_SECONDS);
      update(SIMULATION_STEP_SECONDS);
    }
  }
}
