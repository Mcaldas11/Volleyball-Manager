/**
 * The interface's icon set — small monochrome line icons drawn on a 24px
 * grid, inheriting `color` from wherever they sit, so one glyph serves the
 * sidebar, buttons and inbox rows alike without per-context variants.
 */

import type { JSX } from 'react';

export type IconName =
  | 'home' | 'squad' | 'tactics' | 'training' | 'youth' | 'schedule' | 'trophy'
  | 'scouting' | 'transfers' | 'staff' | 'finances' | 'world' | 'club'
  | 'back' | 'forward' | 'search' | 'menu' | 'chevronDown' | 'chevronRight'
  | 'play' | 'pause' | 'save' | 'exit' | 'close' | 'news' | 'task' | 'offer'
  | 'press' | 'whistle' | 'clock' | 'star' | 'ball' | 'alert' | 'collapse'
  | 'expand' | 'swap' | 'fastForward' | 'calendar' | 'user' | 'stats' | 'check';

const PATHS: Readonly<Record<IconName, JSX.Element>> = {
  home: <><path d="M3.5 10.5 12 4l8.5 6.5" /><path d="M5.5 9v10.5h13V9" /><path d="M10 19.5v-5h4v5" /></>,
  squad: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5" /><path d="M15.5 5.2a3 3 0 0 1 0 5.6" /><path d="M17 14.3c1.9.6 3.1 2.2 3.5 4.7" /></>,
  tactics: <><rect x="4" y="3.5" width="16" height="17" rx="1.5" /><path d="M4 12h16" /><circle cx="8.5" cy="7.8" r="1.1" /><circle cx="15.5" cy="7.8" r="1.1" /><path d="m8 15.5 2 2m0-2-2 2" /><path d="M14 17.5c1-1.8 2.2-2.5 3.5-2.2" /></>,
  training: <><circle cx="12" cy="13" r="6.5" /><path d="M12 9.5V13l2.3 1.7" /><path d="M9.5 3.5h5" /><path d="M12 3.5v3" /></>,
  youth: <><path d="M12 20.5v-9" /><path d="M12 11.5c0-3.6 2.4-6 6.5-6 0 3.9-2.5 6-6.5 6Z" /><path d="M12 14c0-3-2-5-5.5-5 0 3.2 2.1 5 5.5 5Z" /></>,
  schedule: <><rect x="3.5" y="5" width="17" height="15.5" rx="1.5" /><path d="M3.5 9.5h17" /><path d="M8 3v4M16 3v4" /><path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="1.5" /><path d="M3.5 9.5h17" /><path d="M8 3v4M16 3v4" /></>,
  trophy: <><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" /><path d="M7 5.5H4c0 2.8 1.4 4.3 3.4 4.6" /><path d="M17 5.5h3c0 2.8-1.4 4.3-3.4 4.6" /><path d="M9 20h6M12 13v7" /></>,
  scouting: <><circle cx="6.8" cy="15" r="3.6" /><circle cx="17.2" cy="15" r="3.6" /><path d="M10.4 15h3.2" /><path d="M4.2 12.5 6.5 5h2.8l1.1 6.2" /><path d="M19.8 12.5 17.5 5h-2.8l-1.1 6.2" /></>,
  transfers: <><path d="M4 8h14" /><path d="m14.5 4.5 3.5 3.5-3.5 3.5" /><path d="M20 16H6" /><path d="M9.5 12.5 6 16l3.5 3.5" /></>,
  swap: <><path d="M7 4v16" /><path d="m3.5 7.5 3.5-3.5 3.5 3.5" /><path d="M17 20V4" /><path d="m20.5 16.5-3.5 3.5-3.5-3.5" /></>,
  staff: <><rect x="3.5" y="5.5" width="17" height="13" rx="1.5" /><circle cx="9" cy="11" r="2" /><path d="M5.8 16c.5-1.6 1.7-2.4 3.2-2.4s2.7.8 3.2 2.4" /><path d="M14.5 10h3.5M14.5 13.5h3.5" /></>,
  finances: <><ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" /><path d="M5.5 6.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" /><path d="M5.5 11.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" /></>,
  world: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.4-3.8-8.5S9.5 5.9 12 3.5Z" /></>,
  club: <path d="M12 3 19.5 5.8v5.7c0 4.8-3.3 7.9-7.5 9.5-4.2-1.6-7.5-4.7-7.5-9.5V5.8L12 3Z" />,
  back: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  forward: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  play: <path d="M7.5 5v14l11-7-11-7Z" />,
  fastForward: <><path d="M4 6v12l8-6-8-6Z" /><path d="M12 6v12l8-6-8-6Z" /></>,
  pause: <path d="M8 5v14M16 5v14" />,
  save: <><path d="M5 4h11l3 3v13H5V4Z" /><path d="M8 4v5h7V4" /><path d="M8 20v-6h8v6" /></>,
  exit: <><path d="M14 4h5v16h-5" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h10" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  news: <><path d="M4.5 5.5h12v14h-10a2 2 0 0 1-2-2v-12Z" /><path d="M16.5 9h3v8.5a2 2 0 0 1-2 2" /><path d="M7.5 9h6M7.5 12.5h6M7.5 16h4" /></>,
  task: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 12.3 2.7 2.7L16.5 9" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  offer: <><path d="M3.5 12.5 11 5h7.5v7.5L11 20l-7.5-7.5Z" /><circle cx="15" cy="8.8" r="1.3" /></>,
  press: <><rect x="9" y="3.5" width="6" height="10" rx="3" /><path d="M6 11a6 6 0 0 0 12 0" /><path d="M12 17v3.5M9 20.5h6" /></>,
  whistle: <><circle cx="9" cy="14" r="5" /><path d="M13 11.5 20 8v4h-5" /><path d="M9 6V3.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
  star: <path d="m12 3.8 2.5 5.2 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8L12 3.8Z" />,
  ball: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5c-3 3-3 14 0 17" /><path d="M4.2 8.6c5 2.2 10.6 2.2 15.6 0" /><path d="M4.6 16.2c4.8-2.6 10-2.6 14.8 0" /></>,
  alert: <><path d="M12 4 21 19.5H3L12 4Z" /><path d="M12 10v4.5M12 17v.1" /></>,
  collapse: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M9 4.5v15" /><path d="m15.5 9.5-2.5 2.5 2.5 2.5" /></>,
  expand: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M9 4.5v15" /><path d="m13 9.5 2.5 2.5-2.5 2.5" /></>,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c.9-4 3.8-6.2 7.5-6.2s6.6 2.2 7.5 6.2" /></>,
  stats: <><path d="M4 20h16" /><path d="M7 16.5v-5M12 16.5V6.5M17 16.5v-8" /></>,
};

export function Icon({
  name, size = 18, className, strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icon${className !== undefined ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
