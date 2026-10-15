/** Shared gauge and percentage display for human and animal needs. */
export function createNeedsMeter(label: string) {
  const meter = document.createElement('progress');
  meter.max = 100;
  meter.value = 100;
  meter.className = 'needs-gauge';
  meter.setAttribute('aria-label', label);
  const value = document.createElement('span');
  value.textContent = '100%';
  return {
    meter,
    value,
    update(amount: number): void {
      if (meter.value !== amount) meter.value = amount;
      const text = `${Math.round(amount)}%`;
      if (value.textContent !== text) value.textContent = text;
    },
  };
}
