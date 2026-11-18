/**
 * Crests and competition badges drawn from a design: a shape in two colours, a
 * pattern across it and a few letters — or a picture the player chose, which
 * then stands for the lot. Clubs designed in the editor wear theirs; every
 * competition has a badge, made from its name until one is designed.
 */

import { useId, type JSX } from 'react';
import { hashString } from '../engine/core/rng.ts';
import type { CrestDesign, CrestPattern, CrestShape } from '../engine/model/club.ts';
import type { Competition } from '../engine/world/world.ts';

export const CREST_SHAPES: ReadonlyArray<readonly [CrestShape, string]> = [
  ['shield', 'Shield'], ['round', 'Round'], ['diamond', 'Diamond'], ['hexagon', 'Hexagon'], ['square', 'Square'],
];
export const CREST_PATTERNS: ReadonlyArray<readonly [CrestPattern, string]> = [
  ['plain', 'Plain'], ['stripes', 'Stripes'], ['halves', 'Halves'], ['chevron', 'Chevron'], ['sash', 'Sash'], ['ring', 'Ring'],
];

/** The outline of each shape, on a 24 × 24 board. */
const OUTLINE: Readonly<Record<CrestShape, string>> = {
  shield: 'M12 1.4 L21 4.8 V11.5 C21 17.5 16.8 21.3 12 22.6 C7.2 21.3 3 17.5 3 11.5 V4.8 Z',
  round: 'M12 1.4 A10.6 10.6 0 1 1 11.99 1.4 Z',
  diamond: 'M12 1.2 L22.8 12 L12 22.8 L1.2 12 Z',
  hexagon: 'M12 1.3 L21.3 6.6 V17.4 L12 22.7 L2.7 17.4 V6.6 Z',
  square: 'M5 2 H19 A3 3 0 0 1 22 5 V19 A3 3 0 0 1 19 22 H5 A3 3 0 0 1 2 19 V5 A3 3 0 0 1 5 2 Z',
};

/** Whether dark letters read better than white on a colour. */
function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62;
}

function Pattern({ pattern, colour }: { pattern: CrestPattern; colour: string }): JSX.Element | null {
  switch (pattern) {
    case 'stripes':
      return <g fill={colour}><rect x="5.6" y="0" width="2.6" height="24" /><rect x="10.7" y="0" width="2.6" height="24" /><rect x="15.8" y="0" width="2.6" height="24" /></g>;
    case 'halves':
      return <rect x="12" y="0" width="12" height="24" fill={colour} />;
    case 'chevron':
      return <path d="M0 8.5 L12 14.5 L24 8.5 V12.8 L12 18.8 L0 12.8 Z" fill={colour} />;
    case 'sash':
      return <path d="M-2 19 L19 -2 L24 3 L3 24 Z" fill={colour} />;
    case 'ring':
      return <circle cx="12" cy="12" r="7" fill="none" stroke={colour} strokeWidth="1.8" />;
    default:
      return null;
  }
}

/** A design, drawn. `title` names it for a screen reader and on hover. */
export function CrestArt({ design, size = 28, title, className = 'club-crest' }: {
  design: CrestDesign;
  size?: number;
  title: string;
  className?: string;
}): JSX.Element {
  const id = useId();
  if (design.image !== undefined && design.image !== '') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={title}>
        <title>{title}</title>
        <image href={design.image} x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
      </svg>
    );
  }
  const text = design.text.slice(0, 4);
  const fontSize = text.length <= 2 ? 8 : text.length === 3 ? 6.2 : 5;
  const dark = isLight(design.primary);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <clipPath id={`${id}c`}><path d={OUTLINE[design.shape]} /></clipPath>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect x="0" y="0" width="24" height="24" fill={design.primary} />
        <Pattern pattern={design.pattern} colour={design.secondary} />
        <rect x="0" y="0" width="24" height="24" fill={`url(#${id}g)`} />
      </g>
      <path d={OUTLINE[design.shape]} fill="none" style={{ stroke: 'rgba(255,255,255,0.85)' }} strokeWidth="1.1" />
      {text !== '' && (
        <text
          x="12" y={12 + fontSize * 0.36} textAnchor="middle" fontSize={fontSize} fontWeight="800"
          fill={dark ? '#14202c' : '#fff'}
          style={{ paintOrder: 'stroke', stroke: dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)', strokeWidth: 0.45 }}
        >
          {text}
        </text>
      )}
    </svg>
  );
}

/** An HSL colour as #rrggbb, for the colour pickers. */
export function hslHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Letters for a name: its main words' first letters, up to three ("Italy Superliga" → "IS"). */
export function crestLetters(name: string, max = 3): string {
  const small = new Set(['of', 'the', 'de', 'da', 'do', 'di', 'la', 'le', 'el', 'and', '·', '-']);
  const words = name.split(/[\s·]+/).filter((w) => w !== '' && !small.has(w.toLowerCase()) && !/^\d+$/.test(w));
  if (words.length === 1) return words[0].slice(0, Math.min(3, max)).toUpperCase();
  return words.slice(0, max).map((w) => w[0]).join('').toUpperCase();
}

/** A competition's badge before anyone designs one: its shape by kind, its colour from its name. */
export function defaultCompetitionLogo(comp: Competition): CrestDesign {
  const h = hashString(comp.key ?? comp.name) % 360;
  const shape: CrestShape = comp.kind === 'league' ? 'round'
    : comp.kind === 'cup' || comp.kind === 'supercup' ? 'shield'
      : comp.kind === 'international' ? 'hexagon' : 'diamond';
  return {
    shape,
    primary: hslHex(h, 48, 30),
    secondary: '#e8c45a',
    pattern: comp.kind === 'league' ? 'ring' : comp.kind === 'friendly' ? 'plain' : 'chevron',
    text: crestLetters(comp.name),
  };
}

/** A competition's badge: the one designed in the editor, or its own. */
export function CompetitionLogo({ comp, size = 22 }: { comp: Competition; size?: number }): JSX.Element {
  return <CrestArt design={comp.logo ?? defaultCompetitionLogo(comp)} size={size} title={comp.name} className="comp-logo" />;
}

/**
 * A picture the player picked, made small enough to keep in a save: drawn to fit
 * a 128-pixel square and written back as a PNG data URL.
 */
export function shrinkImage(file: File, side = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(side / img.width, side / img.height, 1);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d');
      if (ctx === null) { URL.revokeObjectURL(url); reject(new Error('No canvas')); return; }
      ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not an image')); };
    img.src = url;
  });
}
