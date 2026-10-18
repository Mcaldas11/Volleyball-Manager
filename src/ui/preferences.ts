/**
 * The player's own settings, kept in this browser: how big the text is, colours a colour-blind
 * eye can tell apart, and less motion.
 *
 * Text size scales the whole interface — everything is laid out in pixels, so the page is zoomed
 * and the height it has to fit is divided by the same factor (see fitWindow.ts), and every screen
 * still fits the window. The colour-blind palette swaps the game's green and red — good and bad,
 * won and lost, up and down — for blue and orange, which every common kind of colour blindness
 * keeps apart. Less motion stills the interface's animations.
 */

export type TextScale = 1 | 1.1 | 1.25;

export interface Preferences {
  textScale: TextScale;
  colourBlind: boolean;
  reducedMotion: boolean;
}

const KEY = 'vm.prefs';
const DEFAULTS: Preferences = {
  textScale: 1, colourBlind: false, reducedMotion: false,
};

export function loadPreferences(): Preferences {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return structuredClone(DEFAULTS);
    const v = JSON.parse(raw) as Partial<Preferences>;
    return {
      textScale: v.textScale === 1.1 || v.textScale === 1.25 ? v.textScale : 1,
      colourBlind: v.colourBlind === true,
      reducedMotion: v.reducedMotion === true,
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function savePreferences(p: Preferences): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: they last as long as the page.
  }
}

/** The smallest window, CSS px, the layout is drawn for: text grows only as far as the window keeps that much room. */
const LAYOUT_W = 1366;
const LAYOUT_H = 650;

/** The text size asked for. */
export function chosenScale(): number {
  const z = Number(document.documentElement.dataset.scaleChosen ?? '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** The zoom the interface can be drawn at in a window this size: what was asked for, as far as it fits. */
export function fittingScale(width: number, height: number): number {
  return Math.max(1, Math.min(chosenScale(), width / LAYOUT_W, height / LAYOUT_H));
}

/** The zoom the interface is drawn at now. */
export function textScale(): number {
  const z = Number(document.documentElement.dataset.scale ?? '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** Draw the interface at a zoom. */
export function setScale(z: number): void {
  const de = document.documentElement;
  de.dataset.scale = String(z);
  de.style.setProperty('zoom', z === 1 ? '' : String(z));
}

/** Whether animations should be stilled: asked for here, or by the system. */
export function lessMotion(): boolean {
  return document.documentElement.dataset.motion === 'reduced' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Put the settings on the page. */
export function applyPreferences(p: Preferences): void {
  const de = document.documentElement;
  // The zoom itself is set as the window is fitted (fitWindow.ts): as large as asked, as far as it fits.
  de.dataset.scaleChosen = String(p.textScale);
  if (p.colourBlind) de.dataset.cvd = 'on';
  else delete de.dataset.cvd;
  if (p.reducedMotion) de.dataset.motion = 'reduced';
  else delete de.dataset.motion;
  // Fit the window again, at the new size.
  window.dispatchEvent(new Event('resize'));
}
