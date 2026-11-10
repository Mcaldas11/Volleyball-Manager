/**
 * Every slider's track gold up to its value: `--fill` on each range input, as it is dragged and
 * whenever the game moves it itself (a preference loaded, a photo picked).
 */

function fillOf(el: HTMLInputElement): void {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const v = Number(el.value);
  const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`);
}

function sweep(): void {
  for (const el of document.querySelectorAll<HTMLInputElement>('input[type="range"]')) fillOf(el);
}

export function watchRangeFill(): void {
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'range') fillOf(t);
  }, true);
  // A value set by the game, or a slider just drawn: caught on the next sweep.
  let due = false;
  new MutationObserver(() => {
    if (due) return;
    due = true;
    requestAnimationFrame(() => { due = false; sweep(); });
  }).observe(document.body, { childList: true, subtree: true });
  window.setInterval(sweep, 400);
  sweep();
}
