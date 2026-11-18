/**
 * Watching another club's match live, from the stands — the buttons that
 * open it: one beside a match on today's fixtures, and a menu of everything
 * on today, the matches with a reason to be there first (see spectator.ts).
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import type { WatchAngle } from '../engine/season/spectator.ts';
import { nationName } from '../engine/world/internationals.ts';
import type { Fixture } from '../engine/world/world.ts';
import { ClubCrest } from './components.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';
import { pageRect, pageSize } from './zoom.ts';

/** Why he might go — a few words, or nothing. */
export function watchReasonText(angle: WatchAngle | null): string {
  if (angle === null) return '';
  switch (angle.kind) {
    case 'former': return 'Your former club';
    case 'national': return `${angle.players.length} ${nationName(angle.nation)} player${angle.players.length === 1 ? '' : 's'}`;
    case 'shortlist': return `${angle.players.length} on your shortlist`;
    case 'job': return angle.open ? 'No head coach there — be seen' : '';
    default: return '';
  }
}

/** "Watch live" beside one of today's matches — only while it can be watched. */
export function WatchLiveButton({ fixture, compact = false }: { fixture: Fixture; compact?: boolean }): JSX.Element | null {
  const g = useGame();
  if (!g.canWatchMatch(fixture)) return null;
  const reason = watchReasonText(g.watchReason(fixture));
  return (
    <button className="sm watch-live-btn" title={`Watch it live from the stands${reason !== '' ? ` — ${reason.toLowerCase()}` : ''}`}
      onClick={(e) => { e.stopPropagation(); g.watchMatch(fixture.id); }}>
      <Icon name="play" size={12} />{!compact && ' Watch live'}
    </button>
  );
}

/** One of today's matches, for a menu: the two clubs, the competition, why. */
export function WatchMatchItem({ fixture, onPick }: { fixture: Fixture; onPick: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const home = world.clubs[fixture.home];
  const away = world.clubs[fixture.away];
  const reason = watchReasonText(g.watchReason(fixture));
  const comp = world.competitions[fixture.competitionId]?.name ?? '';
  return (
    <button className="watch-live-item" onClick={() => { onPick(); g.watchMatch(fixture.id); }}>
      <span className="watch-live-crests">
        <ClubCrest club={home} size={18} /><ClubCrest club={away} size={18} />
      </span>
      <span className="menu-pop-stack">
        <span>{home.shortName} v {away.shortName}</span>
        <span className="faint">{reason !== '' ? `${reason} · ${comp}` : comp}</span>
      </span>
    </button>
  );
}

/** Words a search can find a match by: both clubs, their short names, and the competition. */
function searchText(g: ReturnType<typeof useGame>, f: Fixture): string {
  const w = g.world!;
  const h = w.clubs[f.home];
  const a = w.clubs[f.away];
  return fold(`${h.name} ${h.shortName} ${a.name} ${a.shortName} ${w.competitions[f.competitionId]?.name ?? ''}`);
}

/** Lower case, accents gone: "Kraków" is found by "krakow". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** How many rows a search shows at most — the rest are a narrower search away. */
const MAX_ROWS = 80;

/**
 * A button that opens today's matches to watch — nothing to show when none
 * are on. The list opens over the page (never cut off by the card it sits in),
 * with a search by club or competition, the matches with a reason to go first
 * and the rest by competition.
 */
export function WatchLiveMenu({ align = 'right', label = 'Watch live' }: { align?: 'left' | 'right'; label?: string }): JSX.Element | null {
  const g = useGame();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const day = g.world?.day ?? -1;
  // Worked out once a day: the reason to go is a look through both squads.
  const list = useMemo(() => g.watchList(), [day, g.world]);
  const count = list.length;

  useEffect(() => {
    if (!open) return;
    const place = (): void => {
      // In the page's own units: under a bigger text size the page is zoomed, and the screen's pixels are not its.
      if (trigger.current === null) return;
      const r = pageRect(trigger.current);
      const win = pageSize();
      const width = Math.min(380, win.width - 16);
      const left = Math.max(8, Math.min(win.width - width - 8, align === 'right' ? r.right - width : r.left));
      const below = win.height - r.bottom - 12;
      setAt({ top: r.bottom + 6, left, width, maxHeight: Math.max(220, Math.min(520, below)) });
    };
    place();
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (pop.current?.contains(t) === true || trigger.current?.contains(t) === true) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, align]);

  if (count === 0 || g.matchday !== null || g.postMatch !== null) return null;

  const q = fold(query.trim());
  const found = q === '' ? list : list.filter((x) => q.split(/\s+/).every((word) => searchText(g, x.fixture).includes(word)));
  const shown = found.slice(0, MAX_ROWS);
  const close = (): void => { setOpen(false); setQuery(''); };
  // The ones with a reason to be there, then the rest by competition.
  const worth = shown.filter((x) => watchReasonText(x.angle) !== '');
  const groups = new Map<string, typeof shown>();
  for (const x of shown) {
    if (watchReasonText(x.angle) !== '') continue;
    const name = g.world!.competitions[x.fixture.competitionId]?.name ?? 'Other';
    groups.set(name, [...(groups.get(name) ?? []), x]);
  }

  return (
    <div className="watch-live-menu">
      <button ref={trigger} className={`sm watch-live-trigger${open ? ' on' : ''}`} onClick={() => (open ? close() : setOpen(true))}
        title="Today's matches of other clubs, live from the stands">
        <Icon name="play" size={12} /> {label} <span className="watch-live-count">{count}</span> <Icon name="chevronDown" size={12} />
      </button>
      {open && at !== null && createPortal(
        <div ref={pop} className="watch-live-pop" style={{ top: at.top, left: at.left, width: at.width, maxHeight: at.maxHeight }}
          role="dialog" aria-label="Watch a match live">
          <div className="watch-live-head">
            <b>On today</b>
            <span className="faint">{count} match{count === 1 ? '' : 'es'} · watch from the stands</span>
          </div>
          <label className="watch-live-search">
            <Icon name="search" size={14} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a club or competition" spellCheck={false} />
            {query !== '' && <button className="icon-btn" title="Clear" onClick={() => setQuery('')}><Icon name="close" size={13} /></button>}
          </label>
          <div className="watch-live-list">
            {found.length === 0 && <p className="watch-live-none">No match today for "{query.trim()}".</p>}
            {worth.length > 0 && (
              <>
                <span className="watch-live-group gold">Worth a look</span>
                {worth.map((x) => <WatchRow key={x.fixture.id} fixture={x.fixture} reason={watchReasonText(x.angle)} onPick={close} />)}
              </>
            )}
            {[...groups].map(([name, rows]) => (
              <div key={name}>
                <span className="watch-live-group">{name}</span>
                {rows.map((x) => <WatchRow key={x.fixture.id} fixture={x.fixture} onPick={close} />)}
              </div>
            ))}
            {found.length > shown.length && (
              <p className="watch-live-more faint">{found.length - shown.length} more — search to narrow it down.</p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** A match in the list: both clubs in full, and — when there is one — why he might go. */
function WatchRow({ fixture, reason, onPick }: { fixture: Fixture; reason?: string; onPick: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const home = world.clubs[fixture.home];
  const away = world.clubs[fixture.away];
  const comp = world.competitions[fixture.competitionId]?.name ?? '';
  return (
    <button className="watch-live-row" onClick={() => { onPick(); g.watchMatch(fixture.id); }}>
      <span className="watch-live-side home"><span>{home.name}</span><ClubCrest club={home} size={22} /></span>
      <span className="watch-live-v">v</span>
      <span className="watch-live-side away"><ClubCrest club={away} size={22} /><span>{away.name}</span></span>
      <span className="watch-live-go"><Icon name="play" size={12} /></span>
      {reason !== undefined && <span className="watch-live-why"><Icon name="star" size={11} /> {reason} · <span className="faint">{comp}</span></span>}
    </button>
  );
}

/**
 * In the bar under the menus, on every screen: today's other matches to watch,
 * and — out of work, on a day with none — the next day there are, a holiday away.
 * Nothing in a match, or on a day of his own match.
 */
export function WatchBar(): JSX.Element | null {
  const g = useGame();
  const world = g.world;
  if (world === null || g.matchday !== null || g.postMatch !== null) return null;
  if (g.ownFixtureToday() !== null || g.nationalMatchToday() !== null) return null;
  if (g.watchList().length > 0) return <WatchLiveMenu label="Matches today" />;
  // In work, the club's own calendar moves him on; out of work, nothing would.
  if (!g.unemployed) return null;
  const day = g.nextWatchDay();
  if (day === null || day <= world.day) return null;
  return (
    <button className="sm watch-live-trigger" disabled={g.processing} onClick={() => g.openHoliday(day)}
      title="Out of work: go on holiday until the next day other clubs play, and watch from the stands">
      <Icon name="calendar" size={12} /> Next matches · {g.dateLabelForDay(day)}
    </button>
  );
}
