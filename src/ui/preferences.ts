/**
 * The player's own preferences, kept in this browser: how big the text is, colours a colour-blind
 * eye can tell apart, less motion — and how the 3D views are drawn: their sharpness, smoothing and
 * shadows, how many frames a second at most, and a counter of them.
 *
 * Text size scales the whole interface — everything is laid out in pixels, so the page is zoomed
 * and the height it has to fit is divided by the same factor (see fitWindow.ts), and every screen
 * still fits the window. The colour-blind palette swaps the game's green and red — good and bad,
 * won and lost, up and down — for blue and orange, which every common kind of colour blindness
 * keeps apart. Less motion stills the interface's animations.
 *
 * The graphics come in four presets, each a set of the details below it. The 3D views read them as
 * they draw (graphics(), frameCap()): a change shows at once — but for the smoothing of edges,
 * which a 3D view takes up only when it next opens.
 */

export type TextScale = 1 | 1.1 | 1.25;

/** Shadows on the 3D court: none, or drawn from a map this sharp. */
export type Shadows = 'off' | 'low' | 'high' | 'ultra';

export interface Graphics {
  /** The most pixels a 3D view is drawn with for each pixel of the page — never more than the screen has. */
  pixelRatio: 0.75 | 1 | 1.5 | 2;
  /** Edges smoothed. */
  antialias: boolean;
  shadows: Shadows;
}

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY: Readonly<Record<Quality, Graphics>> = {
  low: { pixelRatio: 0.75, antialias: false, shadows: 'off' },
  medium: { pixelRatio: 1, antialias: true, shadows: 'low' },
  high: { pixelRatio: 1.5, antialias: true, shadows: 'high' },
  ultra: { pixelRatio: 2, antialias: true, shadows: 'ultra' },
};

/** The side of the shadow map, px, for each setting. */
export const SHADOW_MAP: Readonly<Record<Shadows, number>> = { off: 0, low: 1024, high: 2048, ultra: 4096 };

/** Which preset a set of details is — or none of them, set by hand. */
export function qualityOf(g: Graphics): Quality | 'custom' {
  const hit = (Object.keys(QUALITY) as Quality[]).find((q) => {
    const p = QUALITY[q];
    return p.pixelRatio === g.pixelRatio && p.antialias === g.antialias && p.shadows === g.shadows;
  });
  return hit ?? 'custom';
}

/** At most this many frames a second — 0: as many as the screen shows. */
export type FrameCap = 0 | 30 | 60 | 120;

export interface Preferences {
  textScale: TextScale;
  colourBlind: boolean;
  reducedMotion: boolean;
  graphics: Graphics;
  frameCap: FrameCap;
  /** The frame rate shown in a corner. */
  showFps: boolean;
}

const KEY = 'vm.prefs';
const DEFAULTS: Preferences = {
  textScale: 1, colourBlind: false, reducedMotion: false, graphics: QUALITY.high, frameCap: 0, showFps: false,
};

/** The preferences on the page now. */
let current: Preferences = DEFAULTS;

export function loadPreferences(): Preferences {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return structuredClone(DEFAULTS);
    const v = JSON.parse(raw) as Partial<Preferences>;
    const g: Partial<Graphics> = v.graphics ?? {};
    return {
      textScale: v.textScale === 1.1 || v.textScale === 1.25 ? v.textScale : 1,
      colourBlind: v.colourBlind === true,
      reducedMotion: v.reducedMotion === true,
      graphics: {
        pixelRatio: g.pixelRatio === 0.75 || g.pixelRatio === 1 || g.pixelRatio === 2 ? g.pixelRatio : DEFAULTS.graphics.pixelRatio,
        antialias: g.antialias !== false,
        shadows: g.shadows !== undefined && g.shadows in SHADOW_MAP ? g.shadows : DEFAULTS.graphics.shadows,
      },
      frameCap: v.frameCap === 30 || v.frameCap === 60 || v.frameCap === 120 ? v.frameCap : 0,
      showFps: v.showFps === true,
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

/** How the 3D views are to be drawn now. */
export function graphics(): Graphics {
  return current.graphics;
}

/** The most frames a second the views are to draw now — 0 for no limit. */
export function frameCap(): FrameCap {
  return current.frameCap;
}

/** The pixels a 3D view draws per pixel of the page: what the graphics allow, as far as the screen has them. */
export function renderPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, current.graphics.pixelRatio);
}

/** Put the preferences on the page. */
export function applyPreferences(p: Preferences): void {
  current = p;
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
