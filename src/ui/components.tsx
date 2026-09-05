/**
 * Shared presentation helpers.
 *
 * Formatting rules live here rather than being repeated per screen, so that
 * ability, money and injury status read identically everywhere they appear.
 */

import { useEffect, useId, useState, type JSX } from 'react';
import type { Club } from '../engine/model/club.ts';
import { Position, POSITION_SHORT } from '../engine/model/positions.ts';
import { INJURY_NAMES, type PlayerStore } from '../engine/model/players.ts';
import { flagImageUrlForCode, NATION_BY_CODE, NATIONS } from '../engine/world/nations.ts';
import { playerFaceUrl } from './faces.ts';
import { useGame } from './state.ts';

/** One colour per role, used to tell players apart on the court view at a glance. */
export const POSITION_ACCENT: Readonly<Record<Position, string>> = {
  [Position.Setter]: 'var(--gold)',
  [Position.Opposite]: 'var(--bad)',
  [Position.OutsideHitter]: 'var(--accent)',
  [Position.MiddleBlocker]: 'var(--elite)',
  [Position.Libero]: 'var(--good)',
};

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

/** Money without the currency sign, for an editable field: "100k", "2M". */
export function moneyShort(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const rounded = abs >= 10_000_000 ? Math.round(m) : Math.round(m * 10) / 10;
    return `${sign}${rounded}M`;
  }
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

/** Parse shorthand like "100k" or "2.5M" (or a plain number) back into a value. */
export function parseMoneyShort(text: string): number | null {
  const cleaned = text.trim().toLowerCase().replace(/[€,\s]/g, '');
  if (cleaned === '') return null;
  const match = /^(-?\d+(?:\.\d+)?)(k|m)?$/.exec(cleaned);
  if (match === null) return null;
  const n = Number(match[1]);
  if (Number.isNaN(n)) return null;
  const mult = match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : 1;
  return Math.round(n * mult);
}

/** A money field that displays and accepts shorthand ("100k", "2M") rather than raw digits. */
export function MoneyInput({
  value, onChange, min = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
}): JSX.Element {
  const [text, setText] = useState(moneyShort(value));

  useEffect(() => setText(moneyShort(value)), [value]);

  const commit = (): void => {
    const parsed = parseMoneyShort(text);
    if (parsed !== null && parsed >= min) onChange(parsed);
    else setText(moneyShort(value));
  };

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
      }}
      style={{ width: 100, textAlign: 'right' }}
    />
  );
}

export function Pos({ pos }: { pos: Position }): JSX.Element {
  return <span className="pill pos">{POSITION_SHORT[pos]}</span>;
}

/** A flag image looked up directly by FIVB code — for places without a nation index handy. */
export function FlagByCode({ code }: { code: string }): JSX.Element {
  const idx = NATION_BY_CODE.get(code);
  const name = idx !== undefined ? NATIONS[idx].name : code;
  const url = flagImageUrlForCode(code);
  if (url === null) return <span className="flag-img flag-fallback" title={name} />;
  return <img className="flag-img" src={url} alt={name} title={name} loading="lazy" />;
}

export function Flag({ nation }: { nation: number }): JSX.Element {
  const n = NATIONS[nation];
  if (n === undefined) return <span className="flag-img flag-fallback" title="Unknown nation" />;
  return <FlagByCode code={n.code} />;
}

/**
 * No club has a real-world crest, so this generates one: a shield in a colour
 * derived from the club's permanent id (the golden-angle step keeps
 * consecutive ids visually distinct, never near-duplicate hues) with the
 * short-name initials on it. Fully offline — no image request, no rate limit,
 * works for all of them at once.
 */
export function ClubCrest({ club, size = 28 }: { club: Club; size?: number }): JSX.Element {
  const gradId = useId();
  const hue = (club.id * 137.508) % 360;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="club-crest"
      role="img"
      aria-label={`${club.name} crest`}
    >
      <title>{club.name}</title>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`hsl(${hue}, 55%, 46%)`} />
          <stop offset="100%" stopColor={`hsl(${hue}, 50%, 30%)`} />
        </linearGradient>
      </defs>
      <path
        d="M12 1.4 L21 4.8 V11.5 C21 17.5 16.8 21.3 12 22.6 C7.2 21.3 3 17.5 3 11.5 V4.8 Z"
        fill={`url(#${gradId})`}
        style={{ stroke: 'var(--gold)' }}
        strokeWidth="1.1"
      />
      <text
        x="12" y="14.2" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fff"
      >
        {club.shortName}
      </text>
    </svg>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

/**
 * A player's photo, deterministic from their permanent id (see faces.ts) so
 * the same face always shows up for them. Falls back to initials if the
 * photo fails to load (offline, service down).
 */
export function PlayerFace({
  playerId, name, size = 64,
}: {
  playerId: number;
  name: string;
  size?: number;
}): JSX.Element {
  const [failed, setFailed] = useState(false);

  return (
    <span className="player-face" style={{ width: size, height: size }}>
      {!failed
        ? (
          <img
            src={playerFaceUrl(playerId)}
            alt={name}
            width={size}
            height={size}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )
        : <span className="player-face-fallback" style={{ fontSize: size * 0.36 }}>{initials(name)}</span>}
    </span>
  );
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

/** A club name that opens that club's detail page when clicked. */
export function ClubLink({ id, short = false }: { id: number; short?: boolean }): JSX.Element {
  const g = useGame();
  const club = g.world?.clubs[id];
  if (club === undefined) return <>—</>;
  return (
    <span className="club-link" onClick={() => g.selectClub(id)}>
      <ClubCrest club={club} size={16} /> {short ? club.shortName : club.name}
    </span>
  );
}
