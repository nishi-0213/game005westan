/** Shared gauge and percentage display for human and animal needs. */
export function createNeedsMeter(label: string, thresholds: readonly number[] = []) {
  const meter = document.createElement('progress');
  meter.max = 100;
  meter.value = 100;
  meter.className = 'needs-gauge';
  meter.setAttribute('aria-label', label);
  const track = document.createElement('span');
  track.className = 'needs-track';
  track.append(meter);
  for (const threshold of thresholds) {
    const tick = document.createElement('span');
    tick.className = 'needs-tick';
    tick.style.left = `${threshold}%`;
    tick.title = `${threshold}%`;
    tick.setAttribute('aria-hidden', 'true');
    track.append(tick);
  }
  const value = document.createElement('span');
  value.textContent = '100%';
  return {
    meter,
    track,
    value,
    update(amount: number): void {
      if (meter.value !== amount) meter.value = amount;
      const text = `${Math.round(amount)}%`;
      if (value.textContent !== text) value.textContent = text;
    },
  };
}
