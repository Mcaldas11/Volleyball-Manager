/**
 * Shared presentation helpers.
 *
 * Formatting rules live here rather than being repeated per screen, so that
 * ability, money and injury status read identically everywhere they appear.
 */

import { hueOf } from './kits.ts';
import {
  useEffect, useId, useRef, useState, type CSSProperties, type JSX, type ReactNode, type RefObject,
} from 'react';
import { hashString } from '../engine/core/rng.ts';
import { RATING_BANDS } from '../engine/match/playerRating.ts';
import type { Club } from '../engine/model/club.ts';
import { Position, POSITION_SHORT } from '../engine/model/positions.ts';
import { INJURY_NAMES, PlayerFlag, type PlayerStore } from '../engine/model/players.ts';
import type { ManagerProfile } from '../engine/world/world.ts';
import { flagImageUrlForCode, NATION_BY_CODE, NATIONS } from '../engine/world/nations.ts';
import { playerFaceUrl, portraitUrl } from './faces.ts';
import { usePortrait } from './portraits.ts';
import { Icon, type IconName } from './icons.tsx';
import { useGame } from './state.ts';
import { Dropdown } from './dropdown.tsx';

/** Close a popover when the user clicks anywhere outside it or presses Escape. */
export function useDismiss(open: boolean, close: () => void): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return ref;
}

/**
 * A long list drawn a page at a time: the first `page` items at once, then the
 * next page each time the end of what is drawn nears the bottom of its panel —
 * so a screen of hundreds of rows opens straight away. `keep` is the index of
 * an item that must be drawn however far down it is (the open one), and a new
 * `key` (another folder, another filter) starts again from the top. `more` goes
 * at the end of the list: a row of a table when `colSpan` is given.
 */
export function useListPages<T>(
  items: readonly T[], key: string, keep = -1, colSpan?: number, page = 40,
): { shown: readonly T[]; more: JSX.Element | null } {
  const [state, setState] = useState({ key, limit: page });
  const limit = Math.max(state.key === key ? state.limit : page, keep + 1);
  const shown = items.length > limit ? items.slice(0, limit) : items;
  const grow = (): void => setState({ key, limit: shown.length + page });
  return {
    shown,
    // Keyed by how much is drawn: each page drawn looks again, until the panel is full.
    more: shown.length < items.length ? <ListMore key={shown.length} onNear={grow} colSpan={colSpan} /> : null,
  };
}

/** The end of a list still being drawn: as it comes near the view, the next page is drawn. */
function ListMore({ onNear, colSpan }: { onNear: () => void; colSpan?: number }): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const near = useRef(onNear);
  near.current = onNear;
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (typeof IntersectionObserver === 'undefined') {
      near.current();
      return;
    }
    let io: IntersectionObserver | null = null;
    // Once the screen is painted: finding the panel reads its styles, which
    // before the first paint would mean working them all out early.
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        io = new IntersectionObserver((seen) => {
          if (seen.some((e) => e.isIntersecting)) near.current();
        }, { root: scrollParent(el), rootMargin: '600px 0px' });
        io.observe(el);
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      io?.disconnect();
    };
  }, []);
  return colSpan !== undefined
    ? <tr className="list-more" aria-hidden="true"><td colSpan={colSpan} ref={ref as RefObject<HTMLTableCellElement>} /></tr>
    : <div className="list-more" aria-hidden="true" ref={ref as RefObject<HTMLDivElement>} />;
}

/** The panel an element scrolls in — the nearest ancestor that scrolls — or null for the window. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}

/** One colour per role, used to tell players apart on the court view at a glance. */
export const POSITION_ACCENT: Readonly<Record<Position, string>> = {
  [Position.Setter]: 'var(--pos-s)',
  [Position.Opposite]: 'var(--pos-opp)',
  [Position.OutsideHitter]: 'var(--pos-oh)',
  [Position.MiddleBlocker]: 'var(--pos-mb)',
  [Position.Libero]: 'var(--pos-l)',
};

/** Ability bands, so a squad list can be read without parsing every number. */
export function abilityClass(ca: number): string {
  if (ca >= 1650) return 'a-elite';
  if (ca >= 1400) return 'a-great';
  if (ca >= 1100) return 'a-good';
  if (ca >= 800) return 'a-ok';
  return 'a-poor';
}

/** 1-5 stars from current ability, trading-card style — same scale everywhere it appears. */
export function starRating(ca: number): string {
  const filled = Math.max(1, Math.min(5, Math.round((ca / 2000) * 5)));
  return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled);
}

/**
 * A coach's-eye star meter in half-star steps, the way a staff report rates
 * ability and potential — the same 0-2000 scale as {@link starRating}, just
 * finer-grained, drawn as five stars clipped to the filled fraction.
 */
export function StarMeter({ value, max = 2000, size = 14 }: { value: number; max?: number; size?: number }): JSX.Element {
  const halves = Math.max(1, Math.min(10, Math.round((value / max) * 10)));
  const pct = (halves / 10) * 100;
  // One row of stars, painted gold up to the rating: nothing laid over anything, so nothing can slip out of line.
  return (
    <span className="star-meter" style={{ fontSize: size, '--star-fill': `${pct}%` } as CSSProperties} title={`${(halves / 2).toFixed(1)} / 5`}>
      ★★★★★
    </span>
  );
}

/** Colour band for a 0-10 match rating — every player starts on 6.0 — from a poor night to a standout one. */
export function ratingClass(r: number): string {
  if (r >= RATING_BANDS.star) return 'rt-star';
  if (r >= RATING_BANDS.good) return 'rt-good';
  if (r >= RATING_BANDS.ok) return 'rt-ok';
  if (r >= RATING_BANDS.poor) return 'rt-poor';
  return 'rt-bad';
}

/** A match (or average) rating as a coloured chip — "—" when there is none yet. */
export function RatingBadge({
  value, size = 'md', title,
}: {
  value: number | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
}): JSX.Element {
  if (value === null || value === undefined || value <= 0) {
    return <span className={`rating-badge rating-${size} rt-none`} title={title}>—</span>;
  }
  return (
    <span className={`rating-badge rating-${size} ${ratingClass(value)}`} title={title}>
      {value.toFixed(value >= 10 ? 0 : 1)}
    </span>
  );
}

/** Colour band for a 1-20 attribute, low to high — the same ramp on every screen. */
export function attrClass(v: number): string {
  if (v >= 16) return 'attr-v5';
  if (v >= 13) return 'attr-v4';
  if (v >= 10) return 'attr-v3';
  if (v >= 6) return 'attr-v2';
  return 'attr-v1';
}

/** A labelled dropdown bound to a value on a tactics-shaped object — used both on the
 *  full Tactics/Rotations screens and in the compact in-match timeout panel. */
export function ChoiceField<T extends number>({
  label, value, options, onChange, hint,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
  hint?: string;
}): JSX.Element {
  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label">{label}</span>
        <Dropdown value={value} onChange={onChange} options={options.map(([v, l]) => ({ value: v, label: l }))} />
      </div>
      {hint !== undefined && <div className="field-hint">{hint}</div>}
    </div>
  );
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
    <span className="money-input">
      <span className="money-input-sign">€</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
        }}
      />
    </span>
  );
}

/** A position badge, tinted in that role's colour everywhere it appears. */
export function Pos({ pos }: { pos: Position }): JSX.Element {
  return <span className={`pos-badge pos-${POSITION_SHORT[pos]}`}>{POSITION_SHORT[pos]}</span>;
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

/** The hue every generated club identity is built from — crest, header band
 *  and sidebar accent all share it, so a club reads as one colour everywhere.
 *  The golden-angle step keeps consecutive ids visually distinct. */
export function clubHue(club: Club): number {
  return hueOf(club);
}

/** CSS custom properties that theme a region in a club's colours. */
export function clubThemeStyle(club: Club): CSSProperties {
  return { '--club-h': clubHue(club).toFixed(1) } as CSSProperties;
}

/**
 * No club has a real-world crest, so this generates one: a shield in a colour
 * derived from the club's permanent id with the short-name initials on it.
 * Fully offline — no image request, no rate limit, works for all of them at once.
 */
export function ClubCrest({ club, size = 28 }: { club: Club; size?: number }): JSX.Element {
  const gradId = useId();
  const hue = clubHue(club);
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
          <stop offset="0%" stopColor={`hsl(${hue}, 58%, 48%)`} />
          <stop offset="100%" stopColor={`hsl(${hue}, 52%, 28%)`} />
        </linearGradient>
      </defs>
      <path
        d="M12 1.4 L21 4.8 V11.5 C21 17.5 16.8 21.3 12 22.6 C7.2 21.3 3 17.5 3 11.5 V4.8 Z"
        fill={`url(#${gradId})`}
        style={{ stroke: 'rgba(255,255,255,0.85)' }}
        strokeWidth="1.1"
      />
      <path
        d="M12 3.2 L19.3 6 V11.5"
        fill="none"
        style={{ stroke: 'rgba(255,255,255,0.18)' }}
        strokeWidth="1"
      />
      <text
        x="12" y="14.2" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fff"
      >
        {club.shortName}
      </text>
    </svg>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

/**
 * Any off-pitch face keyed by a direct photo URL rather than a player id —
 * a journalist, the manager's own likeness. Same fallback-to-initials
 * behaviour as {@link PlayerFace}, which is just this with the player photo
 * lookup baked in.
 */
export function PersonFace({
  photoUrl, name, size = 64,
}: {
  photoUrl: string;
  name: string;
  size?: number;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  // A new photo (a portrait picked, say) gets its own chance to load.
  useEffect(() => setFailed(false), [photoUrl]);

  return (
    <span className="player-face" style={{ width: size, height: size }}>
      {!failed
        ? (
          <img
            src={photoUrl}
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
  // A portrait the manager picked for him, if there is one — else the photo the game gives him.
  const custom = usePortrait(playerId);
  return <PersonFace photoUrl={custom ?? playerFaceUrl(playerId)} name={name} size={size} />;
}

/** A stable portrait for the manager's own likeness — there is no photo field
 *  on {@link ManagerProfile}, so one is derived deterministically from their
 *  name, the same way a player's face is derived from their store id. */
export function managerPhotoUrl(manager: ManagerProfile): string {
  if (manager.customPortrait !== undefined) return manager.customPortrait;
  if (manager.portrait !== undefined) return manager.portrait;
  const idx = hashString(`${manager.firstName} ${manager.lastName}`) % 100;
  return portraitUrl(idx, manager.gender === 'female' ? 'women' : 'men');
}

/** A small horizontal meter, used for condition and morale. */
export function Bar({ value, max = 100, wide = false }: { value: number; max?: number; wide?: boolean }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colour = pct > 66 ? 'var(--good)' : pct > 33 ? 'var(--warn)' : 'var(--bad)';
  return (
    <span className={`bar${wide ? ' bar-wide' : ''}`} title={`${Math.round(value)}`}>
      <span style={{ width: `${pct}%`, background: colour }} />
    </span>
  );
}

/** Morale in words, the way a coach would describe the dressing room. */
export function moraleLabel(m: number): { label: string; cls: string } {
  if (m >= 85) return { label: 'Superb', cls: 'good' };
  if (m >= 70) return { label: 'Very good', cls: 'good' };
  if (m >= 55) return { label: 'Good', cls: '' };
  if (m >= 40) return { label: 'Okay', cls: 'dim' };
  if (m >= 25) return { label: 'Poor', cls: 'warn' };
  return { label: 'Very poor', cls: 'bad' };
}

export function Morale({ value }: { value: number }): JSX.Element {
  const { label, cls } = moraleLabel(value);
  return <span className={`morale ${cls}`} title={`${Math.round(value)}/100`}>{label}</span>;
}

/**
 * Availability: injured players show their injury and how long is left, which
 * is the single most important thing about them for team selection.
 */
export function Status({ store, i }: { store: PlayerStore; i: number }): JSX.Element {
  const days = store.injuryDaysLeft[i];
  if (days > 0) {
    return (
      <span className="status-tag status-injured" title={INJURY_NAMES[store.injuryType[i]]}>
        {INJURY_NAMES[store.injuryType[i]]} ({days}d)
      </span>
    );
  }
  if (store.hasFlag(i, PlayerFlag.OnDuty)) return <span className="status-tag status-duty">International duty</span>;
  if (store.condition[i] < 60) return <span className="status-tag status-tired">Tired</span>;
  return <span className="faint">Fit</span>;
}

export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <p className="empty">{children}</p>;
}

/**
 * The building block of every screen — a titled panel, the way a management
 * sim lays out its widgets: a header strip with an optional icon and actions,
 * and a body below.
 */
export function Card({
  title, icon, actions, children, className, flush = false, style,
}: {
  title?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Drop the body padding, for a table or list that runs edge to edge. */
  flush?: boolean;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <section className={`card${className !== undefined ? ` ${className}` : ''}`} style={style}>
      {(title !== undefined || actions !== undefined) && (
        <header className="card-head">
          {icon !== undefined && <Icon name={icon} size={15} />}
          {title !== undefined && <h3 className="card-title">{title}</h3>}
          {actions !== undefined && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={`card-body${flush ? ' card-body-flush' : ''}`}>{children}</div>
    </section>
  );
}

/** One headline number with its label, for the summary strips atop a screen. */
export function StatTile({
  label, value, sub, tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'bad' | 'warn' | 'gold';
}): JSX.Element {
  return (
    <div className={`stat-tile${tone !== undefined ? ` tone-${tone}` : ''}`}>
      <span className="stat-tile-label">{label}</span>
      <span className="stat-tile-value">{value}</span>
      {sub !== undefined && <span className="stat-tile-sub">{sub}</span>}
    </div>
  );
}

/** A label/value line inside a card. */
export function KV({ k, children, cls }: { k: ReactNode; children: ReactNode; cls?: string }): JSX.Element {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v${cls !== undefined ? ` ${cls}` : ''}`}>{children}</span>
    </div>
  );
}

/** A row of mutually exclusive options — tabs within a card, speed selectors, filters. */
export function Segmented<T extends string | number>({
  options, value, onChange, size = 'md',
}: {
  options: ReadonlyArray<readonly [T, ReactNode]>;
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}): JSX.Element {
  return (
    <div className={`segmented segmented-${size}`} role="tablist">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          role="tab"
          aria-selected={v === value}
          className={v === value ? 'active' : ''}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Last results as coloured W/L squares, oldest first — the league-table form guide. */
export function FormGuide({ results }: { results: ReadonlyArray<'W' | 'L'> }): JSX.Element {
  if (results.length === 0) return <span className="faint">—</span>;
  return (
    <span className="form-guide">
      {results.map((r, i) => <span key={i} className={`form-pip ${r === 'W' ? 'win' : 'loss'}`}>{r}</span>)}
    </span>
  );
}

/** Column sorting state for a table: which key, and which way. */
export interface SortState<K extends string> {
  key: K;
  dir: 1 | -1;
}

/** Remembers a table's sort column, flipping direction on a repeated click. */
export function useSort<K extends string>(
  initial: K,
  initialDir: 1 | -1 = -1,
): [SortState<K>, (key: K) => void] {
  const [sort, setSort] = useState<SortState<K>>({ key: initial, dir: initialDir });
  const toggle = (key: K): void => {
    setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) } : { key, dir: -1 }));
  };
  return [sort, toggle];
}

/** Sort `items` by the numeric or string value `get` returns for the active key. */
export function sortBy<T, K extends string>(
  items: readonly T[],
  sort: SortState<K>,
  get: (item: T, key: K) => number | string,
): T[] {
  return [...items].sort((a, b) => {
    const va = get(a, sort.key);
    const vb = get(b, sort.key);
    const cmp = typeof va === 'string' && typeof vb === 'string'
      ? va.localeCompare(vb)
      : (va as number) - (vb as number);
    return cmp * sort.dir;
  });
}

/** A clickable table header that drives a {@link useSort} state. */
export function SortTh<K extends string>({
  k, sort, onSort, children, num = false, title, className,
}: {
  k: K;
  sort: SortState<K>;
  onSort: (k: K) => void;
  children: ReactNode;
  num?: boolean;
  title?: string;
  className?: string;
}): JSX.Element {
  const active = sort.key === k;
  return (
    <th
      className={`sortable${num ? ' num' : ''}${active ? ' sorted' : ''}${className !== undefined ? ` ${className}` : ''}`}
      onClick={() => onSort(k)}
      title={title}
    >
      {children}
      <span className="sort-caret">{active ? (sort.dir === -1 ? '▼' : '▲') : ''}</span>
    </th>
  );
}

/**
 * A document for transfer bids and player signings — the negotiating table:
 * who is involved up top, the terms as rows beneath, and the decision at
 * the foot of the sheet.
 */
export function ContractPaper({
  kicker, title, subtitle, onClose, playerId, portrait, children,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  /** Close the sheet without deciding anything, if the caller supports that. */
  onClose?: () => void;
  /** Permanent id of the player being discussed, for the header portrait. */
  playerId?: number;
  /** A portrait of anyone else — the staff have no photos. */
  portrait?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="contract-wrap">
      <div className="contract">
        <div className="contract-head">
          {playerId !== undefined ? <PlayerFace playerId={playerId} name={title} size={64} /> : portrait}
          <div className="contract-head-text">
            {kicker !== undefined && <span className="contract-kicker">{kicker}</span>}
            <h2 className="contract-title">{title}</h2>
            {subtitle !== undefined && <p className="contract-subtitle">{subtitle}</p>}
          </div>
          {onClose !== undefined && (
            <button className="icon-btn contract-close" title="Close" onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <div className="contract-body">{children}</div>
      </div>
    </div>
  );
}

/** One line of a ContractPaper: a label and its value. */
export function ContractRow({
  label, children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="contract-row">
      <span className="contract-label">{label}</span>
      <span className="contract-value">{children}</span>
    </div>
  );
}

/** "Derby" or "Classic" beside a fixture played under a rivalry. */
export function RivalTag({ kind }: { kind: 'derby' | 'classic' | null }): JSX.Element | null {
  if (kind === null) return null;
  return <span className={`rival-tag ${kind}`} title={kind === 'derby' ? 'City derby' : 'The classic rivalry'}>{kind === 'derby' ? 'Derby' : 'Classic'}</span>;
}

/** A club name that opens that club's detail page when clicked. `crest` can be
 *  turned off where a large crest already sits right beside the name. */
export function ClubLink({
  id, short = false, crest = true,
}: {
  id: number;
  short?: boolean;
  crest?: boolean;
}): JSX.Element {
  const g = useGame();
  const club = g.world?.clubs[id];
  if (club === undefined) return <>—</>;
  // In a match a club's page can't be opened over it: the name is just a name.
  const inMatch = g.matchday !== null;
  return (
    <span
      className={`club-link${inMatch ? ' inert' : ''}`}
      onClick={(e) => {
        if (inMatch) return;
        e.stopPropagation();
        g.selectClub(id);
      }}
    >
      {crest && <ClubCrest club={club} size={16} />}
      <span className="club-link-name">{short ? club.shortName : club.name}</span>
    </span>
  );
}

/** A player's name that opens their profile when clicked. */
export function PlayerLink({ idx, short = false }: { idx: number; short?: boolean }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  return (
    <span
      className="player-link"
      onClick={(e) => { e.stopPropagation(); g.select(idx); }}
    >
      {short ? store.shortName(idx) : store.fullName(idx)}
    </span>
  );
}

/**
 * A workspace's heading, in the 2026-11 redesign: a small gold eyebrow (the
 * area), the screen's line, a sentence under it, and its actions on the right.
 */
export function WorkspaceHeading({ eyebrow, title, description, actions, children }: {
  eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode;
}): JSX.Element {
  return (
    <header className="vm-section-header">
      <div className="vm-section-heading">
        {eyebrow !== undefined && <div className="vm-eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
        {description !== undefined && <p>{description}</p>}
        {children}
      </div>
      {actions !== undefined && <div className="vm-section-actions">{actions}</div>}
    </header>
  );
}

/**
 * A list fitted to its panel, never scrolled: the rows share the height the
 * panel has (between `min` and `max` px each, set as `--row-h` on the panel),
 * and when even the smallest rows will not all fit, the list goes a page at a
 * time — `ListPager` turns them.
 */
export function useFitList(
  wrapRef: RefObject<HTMLElement | null>, count: number, { min = 24, max = 44, head = 'thead' }: { min?: number; max?: number; head?: string } = {},
): { from: number; to: number; page: number; pages: number; setPage: (p: number) => void } {
  const [space, setSpace] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const measure = (): void => {
      const h = wrap.querySelector(head)?.getBoundingClientRect().height ?? 0;
      setSpace(Math.max(0, wrap.clientHeight - h));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    measure();
    return () => ro.disconnect();
  }, [wrapRef, head]);
  // Every row drawn: when they do not all fit at the smallest height, the list scrolls in its box.
  const perPage = count;
  const pages = Math.max(1, Math.ceil(count / Math.max(1, perPage)));
  const shownPage = Math.min(page, pages - 1);
  const rowH = space <= 0 ? max : Math.max(min, Math.min(max, Math.floor(space / Math.max(1, Math.min(perPage, count))) - 1));
  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    wrap.style.setProperty('--row-h', `${rowH}px`);
    // Tight rows drop their second line (styles key on it).
    wrap.dataset.rows = rowH < 36 ? 'tight' : 'roomy';
  }, [wrapRef, rowH]);
  useWheelPages(wrapRef, shownPage, pages, setPage);
  return { from: shownPage * perPage, to: Math.min(count, (shownPage + 1) * perPage), page: shownPage, pages, setPage };
}

/** The pages of a fitted list: back, "2 / 3", on. Nothing when it fits on one. */
export function ListPager(_: { page: number; pages: number; setPage: (p: number) => void }): JSX.Element | null {
  // No arrows: a fitted list turns its pages under the mouse wheel (useWheelPages).
  return null;
}

/** Whether the window is a short one (fitWindow.ts marks it on <html>), kept up to date as it is resized. */
export function useShortWindow(): boolean {
  const read = (): boolean => document.documentElement.classList.contains('short-window');
  const [short, setShort] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setShort(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return short;
}

/** A titled panel of the redesign: an eyebrow, a title and an action in its head. */
export function Panel({ title, eyebrow, action, children, className = '' }: {
  title?: ReactNode; eyebrow?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string;
}): JSX.Element {
  const id = useId();
  return (
    <section className={`vm-panel ${className}`} aria-labelledby={title !== undefined ? id : undefined}>
      {(title !== undefined || action !== undefined || eyebrow !== undefined) && (
        <header className="vm-panel-heading">
          <div>
            {eyebrow !== undefined && <div className="vm-eyebrow">{eyebrow}</div>}
            {title !== undefined && <h3 id={id}>{title}</h3>}
          </div>
          {action !== undefined && <div className="vm-panel-action">{action}</div>}
        </header>
      )}
      <div className="vm-panel-body">{children}</div>
    </section>
  );
}

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'gold';

/** A headline number: its label, the figure, a line under it. */
export function Metric({ label, value, detail, tone = 'neutral' }: { label: ReactNode; value: ReactNode; detail?: ReactNode; tone?: Tone }): JSX.Element {
  return (
    <div className={`vm-metric tone-${tone}`}>
      <span className="vm-metric-label">{label}</span>
      <strong>{value}</strong>
      {detail !== undefined && <span className="vm-metric-detail">{detail}</span>}
    </div>
  );
}

/** A small status pill with a dot. */
export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }): JSX.Element {
  return <span className={`vm-status tone-${tone}`}><i aria-hidden="true" />{children}</span>;
}

/** Nothing here yet — and what will fill it. */
export function EmptyState({ title, description, action, icon = 'ball' }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: IconName }): JSX.Element {
  return (
    <div className="vm-empty-state">
      <Icon name={icon} size={30} />
      <strong>{title}</strong>
      {description !== undefined && <p>{description}</p>}
      {action}
    </div>
  );
}

/** A thin progress meter. */
export function Progress({ value, max = 100, label, tone = 'gold' }: { value: number; max?: number; label: string; tone?: Tone }): JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={`vm-progress tone-${tone}`} role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}
      style={{ '--progress': `${pct}%` } as CSSProperties}>
      <span />
    </div>
  );
}

/**
 * A grid of cards fitted to its panel, never scrolled: as many columns as
 * cards of `minWidth` fit across, as many rows as cards of `height` fit down,
 * and the rest a page at a time (turned with `ListPager`).
 */
export function useFitGrid(
  ref: RefObject<HTMLElement | null>, count: number, { minWidth, height, gap = 12 }: { minWidth: number; height: number; gap?: number },
): { from: number; to: number; page: number; pages: number; setPage: (p: number) => void; cols: number } {
  const [box, setBox] = useState<[number, number]>([0, 0]);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = (): void => setBox([el.clientWidth, el.clientHeight]);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ref]);
  const cols = Math.max(1, Math.floor((box[0] + gap) / (minWidth + gap)));
  const rows = Math.max(1, Math.floor((box[1] + gap) / (height + gap)));
  void rows;
  const per = count;
  const pages = Math.max(1, Math.ceil(count / Math.max(1, per)));
  const p = Math.min(page, pages - 1);
  useWheelPages(ref, p, pages, setPage);
  return { from: p * per, to: Math.min(count, (p + 1) * per), page: p, pages, setPage, cols };
}

/**
 * A long list in its own box: it scrolls inside the box (the bar hidden, the
 * wheel moves it), the page around it never does. `resetKey` sends it back to
 * the top (a new filter, another folder); `follow` keeps a chosen item in view.
 */
export function Paged({ className, resetKey, follow, children, style }: {
  className?: string; items?: string; resetKey?: string;
  /** An item to keep in view: when a new one matches (the message opened), it is scrolled to. */
  follow?: string; children?: ReactNode; style?: CSSProperties;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const followed = useRef<Element | null>(null);
  useEffect(() => { if (ref.current !== null) ref.current.scrollTop = 0; }, [resetKey]);
  useEffect(() => {
    if (follow === undefined) return;
    const target = ref.current?.querySelector(follow) ?? null;
    if (target instanceof HTMLElement && target !== followed.current) {
      followed.current = target;
      target.scrollIntoView({ block: 'nearest' });
    }
  });
  return (
    <div ref={ref} className={`paged${className !== undefined ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  );
}

/** The wheel over a fitted list turns its pages — no arrows, no scroll bar. */
export function useWheelPages(ref: RefObject<HTMLElement | null>, page: number, pages: number, setPage: (p: number) => void): void {
  useEffect(() => {
    const el = ref.current;
    if (el === null || pages <= 1) return;
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) < 4) return;
      const next = Math.max(0, Math.min(pages - 1, page + (e.deltaY > 0 ? 1 : -1)));
      if (next !== page) { e.preventDefault(); setPage(next); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, page, pages, setPage]);
}
