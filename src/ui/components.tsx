/**
 * Shared presentation helpers.
 *
 * Formatting rules live here rather than being repeated per screen, so that
 * ability, money and injury status read identically everywhere they appear.
 */

import type { JSX } from 'react';
import { POSITION_SHORT, type Position } from '../engine/model/positions.ts';
import { INJURY_NAMES, type PlayerStore } from '../engine/model/players.ts';
import { NATIONS } from '../engine/world/nations.ts';

/** Ability bands, so a squad list can be read without parsing every number. */
export function abilityClass(ca: number): string {
  if (ca >= 1650) return 'a-elite';
  if (ca >= 1400) return 'a-great';
  if (ca >= 1100) return 'a-good';
  if (ca >= 800) return 'a-ok';
  return 'a-poor';
}

export function money(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}€${Math.round(abs / 1_000)}k`;
  return `${sign}€${Math.round(abs)}`;
}

export function Pos({ pos }: { pos: Position }): JSX.Element {
  return <span className="pill pos">{POSITION_SHORT[pos]}</span>;
}

export function Flag({ nation }: { nation: number }): JSX.Element {
  return <span className="faint">{NATIONS[nation]?.code ?? '???'}</span>;
}

/** A small horizontal meter, used for condition and morale. */
export function Bar({ value, max = 100 }: { value: number; max?: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colour = pct > 66 ? 'var(--good)' : pct > 33 ? 'var(--warn)' : 'var(--bad)';
  return (
    <span className="bar" title={`${Math.round(value)}`}>
      <span style={{ width: `${pct}%`, background: colour }} />
    </span>
  );
}

/**
 * Availability: injured players show their injury and how long is left, which
 * is the single most important thing about them for team selection.
 */
export function Status({ store, i }: { store: PlayerStore; i: number }): JSX.Element {
  const days = store.injuryDaysLeft[i];
  if (days > 0) {
    return (
      <span className="bad" title={INJURY_NAMES[store.injuryType[i]]}>
        {INJURY_NAMES[store.injuryType[i]]} ({days}d)
      </span>
    );
  }
  if (store.condition[i] < 60) return <span className="warn">Tired</span>;
  return <span className="faint">Fit</span>;
}

export function Empty({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="dim" style={{ padding: '20px 0' }}>{children}</p>;
}
