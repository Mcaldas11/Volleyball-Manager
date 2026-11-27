/**
 * A drawn portrait for a real player the sources have no photo of: a flat,
 * friendly bust in his club's shirt, with his number and a little badge.
 * Everything about the face comes from his id, so he looks the same every time.
 */

export interface AvatarLook {
  /** Permanent player id: the face is drawn from it. */
  seed: number;
  women: boolean;
  /** Shirt and trim colours. */
  shirt: string;
  trim: string;
  number: number | null;
  /** One or two letters on the badge. */
  badge: string;
  /** Skin tones to draw from, darkest last: a range suited to where he is from. */
  skinRange: readonly [number, number];
  /** Years old: grey creeps in from the forties. */
  age: number;
}

/** Skin tones, light to dark. */
export const SKIN = ['#f7d9c0', '#f0c8a6', '#e4b48d', '#d29e74', '#b9825a', '#99643f', '#7a4b2e', '#5c3720'] as const;
const SKIN_SHADE = ['#e6bfa1', '#dcae89', '#cf9b73', '#bb855c', '#a06b45', '#80512f', '#633a21', '#472817'] as const;
const HAIR = ['#1c1714', '#2e2119', '#4a3121', '#6b4a2f', '#8c6a43', '#c79b5b', '#e0c07a', '#9b4a26'] as const;

/** A small, stable pseudo-random sequence for one face. */
function dice(seed: number): () => number {
  let h = (Math.imul(seed ^ 0x5bd1e995, 0x27d4eb2d) >>> 0) || 1;
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length) % list.length];
}

/** The portrait as an SVG document. */
export function avatarSvg(a: AvatarLook): string {
  const r = dice(a.seed);
  const [lo, hi] = a.skinRange;
  const tone = Math.min(SKIN.length - 1, lo + Math.floor(r() * (hi - lo + 1)));
  const skin = SKIN[tone];
  const shade = SKIN_SHADE[tone];
  // Darker skin, darker hair, mostly; fair hair only on the fairest.
  const hairPool = tone >= 4 ? HAIR.slice(0, 2) : tone >= 2 ? HAIR.slice(0, 5) : HAIR;
  let hair: string = pick(r, hairPool);
  if (a.age >= 42 && r() < 0.6) hair = '#9a9893';
  const style = Math.floor(r() * 4);
  const beard = !a.women && r() < 0.28;
  const smile = r() < 0.8;
  const brow = a.women ? 1.6 : 2.4;

  // Hair behind the head (long styles), and on top of it.
  let back = '';
  let top = '';
  if (a.women) {
    if (style === 0) { // long and loose
      back = `<path d="M29 40 Q28 20 50 18 Q72 20 71 40 L74 76 Q62 82 50 80 Q38 82 26 76 Z" fill="${hair}"/>`;
      top = `<path d="M32 42 Q31 21 50 20 Q69 21 68 42 Q63 31 54 29 Q46 34 36 35 Q33 38 32 42 Z" fill="${hair}"/>`;
    } else if (style === 1) { // ponytail
      back = `<path d="M66 30 Q82 34 78 56 Q76 66 70 70 Q72 54 66 44 Z" fill="${hair}"/>`;
      top = `<path d="M32 42 Q31 20 50 19 Q69 20 68 40 Q60 28 50 28 Q40 28 34 36 Z" fill="${hair}"/>`;
    } else if (style === 2) { // bun
      back = `<circle cx="50" cy="17" r="8" fill="${hair}"/>`;
      top = `<path d="M32 41 Q31 21 50 21 Q69 21 68 41 Q62 30 50 30 Q38 30 32 41 Z" fill="${hair}"/>`;
    } else { // curls
      back = `<path d="M27 44 Q24 18 50 15 Q76 18 73 44 Q78 60 70 68 Q50 74 30 68 Q22 60 27 44 Z" fill="${hair}"/>`;
      top = `<path d="M31 40 Q30 20 50 19 Q70 20 69 40 Q64 30 56 31 Q50 27 44 31 Q36 30 31 40 Z" fill="${hair}"/>`;
    }
  } else if (style === 0) { // short crop
    top = `<path d="M32 40 Q30 19 50 18 Q70 19 68 40 Q66 30 58 28 Q50 31 42 28 Q34 31 32 40 Z" fill="${hair}"/>`;
  } else if (style === 1) { // side part
    top = `<path d="M32 42 Q30 18 52 18 Q71 20 68 40 Q64 27 48 29 Q40 27 34 34 Z" fill="${hair}"/>`;
  } else if (style === 2) { // buzz
    top = `<path d="M33 37 Q33 21 50 20 Q67 21 67 37 Q60 28 50 28 Q40 28 33 37 Z" fill="${hair}" opacity="0.92"/>`;
  } else { // curly top
    top = `<path d="M31 40 Q27 22 38 18 Q44 12 52 16 Q60 12 66 19 Q73 24 69 40 Q64 29 50 29 Q36 29 31 40 Z" fill="${hair}"/>`;
  }

  const num = a.number !== null ? String(a.number) : '';
  const face = [
    `<ellipse cx="32.5" cy="45" rx="3.5" ry="5" fill="${shade}"/>`,
    `<ellipse cx="67.5" cy="45" rx="3.5" ry="5" fill="${shade}"/>`,
    `<ellipse cx="50" cy="42" rx="17.5" ry="21" fill="${skin}"/>`,
    beard ? `<path d="M33 46 Q34 64 50 66 Q66 64 67 46 Q64 58 50 58 Q36 58 33 46 Z" fill="${hair}" opacity="0.85"/>` : '',
    top,
    `<rect x="${40 - brow}" y="36" width="8" height="${brow}" rx="1" fill="${hair}"/>`,
    `<rect x="${52 + brow - 2.4}" y="36" width="8" height="${brow}" rx="1" fill="${hair}"/>`,
    `<ellipse cx="44" cy="42.5" rx="1.9" ry="2.3" fill="#2b211d"/>`,
    `<ellipse cx="56" cy="42.5" rx="1.9" ry="2.3" fill="#2b211d"/>`,
    `<path d="M49 46 Q50 51 52 50" stroke="${shade}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
    smile
      ? `<path d="M43 54 Q50 61 57 54 Z" fill="#fff" stroke="#8a3b32" stroke-width="1.1" stroke-linejoin="round"/>`
      : `<path d="M44.5 55 Q50 58 55.5 55" stroke="#8a3b32" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
    a.women ? `<ellipse cx="40" cy="50" rx="2.6" ry="1.5" fill="#e88a7a" opacity="0.35"/><ellipse cx="60" cy="50" rx="2.6" ry="1.5" fill="#e88a7a" opacity="0.35"/>` : '',
  ].join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`
    + `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3f6fa"/><stop offset="1" stop-color="#d9e1ea"/></linearGradient></defs>`
    + `<rect width="100" height="100" fill="url(#bg)"/>`
    + back
    // Neck, then the shirt: dark shoulder panels, the club colour down the front, a V collar.
    + `<path d="M43 58 L57 58 L58 72 L42 72 Z" fill="${shade}"/>`
    + `<path d="M10 100 Q12 78 30 73 L42 69 Q50 76 58 69 L70 73 Q88 78 90 100 Z" fill="#4b5058"/>`
    + `<path d="M24 100 Q26 82 36 75 L42 69 Q50 76 58 69 L64 75 Q74 82 76 100 Z" fill="${a.shirt}"/>`
    + `<path d="M42 69 Q50 76 58 69 L56 68 Q50 73 44 68 Z" fill="${a.trim}"/>`
    + (num !== '' ? `<text x="40" y="94" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="15" fill="#fff" stroke="${a.trim}" stroke-width="0.8">${num}</text>` : '')
    + `<path d="M58 80 L68 80 L68 87 Q68 92 63 94 Q58 92 58 87 Z" fill="#fff" stroke="${a.trim}" stroke-width="1"/>`
    + `<text x="63" y="89.5" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="5.2" fill="${a.trim}">${a.badge}</text>`
    + face
    + `</svg>`;
}

/** The portrait as an image address, for an <img>. */
export function avatarUrl(a: AvatarLook): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(a))}`;
}
