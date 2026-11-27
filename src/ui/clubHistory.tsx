import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import { spellsOf, spellYears, type ClubSpell } from '../engine/world/clubHistory.ts';
import type { World } from '../engine/world/world.ts';
import { ClubLink, Flag } from './components.tsx';
import { Icon } from './icons.tsx';

/** Spells the profile card shows where the window gives it no measure; the rest are a click away. */
const SHOWN = 4;

interface SpellRow extends ClubSpell {
  /** Where he is now — the spell still running. */
  current: boolean;
  /** A club outside the game world, by name (a real career). */
  name?: string;
}

/** Words half the clubs in a country carry: no sign of which club it is. */
const GENERIC_WORDS = new Set([
  'club', 'clube', 'volley', 'volleys', 'volei', 'voley', 'voleibol', 'volleyball', 'pallavolo', 'sport', 'sports',
  'klub', 'team', 'associacao', 'academia', 'grupo', 'desportivo', 'recreativo', 'cultural', 'futbol', 'football',
]);

/** A world's clubs by name, to put a real career's clubs to the ones in the game. */
const CLUBS_BY_NAME = new WeakMap<World, Map<string, number>>();
function clubByName(world: World, name: string, nation = -1): number {
  let map = CLUBS_BY_NAME.get(world);
  if (map === undefined) {
    map = new Map();
    for (const c of world.clubs) map.set(c.name.toLowerCase(), c.id);
    CLUBS_BY_NAME.set(world, map);
  }
  const key = `${nation}|${name.toLowerCase()}`;
  const exact = map.get(name.toLowerCase()) ?? map.get(key);
  if (exact !== undefined) return exact;
  // "Sporting" for "Sporting CP", "Castêlo da Maia" for "Castelo Maia GC": the one club whose name shares its main word.
  const words = (n: string): string[] => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
  const want = words(name);
  if (want.length === 0) return -1;
  // At home first, the most words in common; a tie is no match.
  const score = (c: { name: string }): number => words(c.name).filter((w) => want.includes(w)).length;
  const pickFrom = (pool: typeof world.clubs): number => {
    let top = 0;
    let hits: typeof world.clubs = [];
    for (const c of pool) {
      if (c.under21Of !== undefined) continue;
      const n = score(c);
      if (n > top) { top = n; hits = [c]; } else if (n === top && n > 0) hits.push(c);
    }
    if (hits.length === 1) return hits[0].id;
    // "Sporting" between Sporting CP and its B side: the club in the higher division.
    const high = Math.min(...hits.map((c) => c.tier));
    const atTop = hits.filter((c) => c.tier === high);
    return atTop.length === 1 ? atTop[0].id : -1;
  };
  const home = nation >= 0 ? pickFrom(world.clubs.filter((c) => c.nation === nation)) : -1;
  const found = home >= 0 ? home : pickFrom(world.clubs);
  map.set(key, found);
  return found;
}

/** A real player's seasons before the save, as spells: one per run of seasons at a club, oldest last. */
function realSpells(world: World, p: number): SpellRow[] | null {
  const seasons = world.realCareers?.[world.players.id[p]];
  if (seasons === undefined || seasons.length === 0) return null;
  const sorted = [...seasons].sort((a, b) => b[0] - a[0]);
  const out: SpellRow[] = [];
  for (const [year, name, apps, points] of sorted) {
    const from = year - world.startYear;
    const last = out[out.length - 1];
    // Matches and points where the source counts them (zerozero does, for Portugal); a dash where not.
    const a = apps ?? -1;
    const pts = points ?? -1;
    const club = clubByName(world, name, world.players.nation[p]);
    // The same club under a sponsor's new name ("Asseco Resovia", "Asseco Resovia Rzeszów") is one spell.
    const same = last !== undefined && (last.name === name || (club >= 0 && last.club === club));
    if (same && (last.from === from + 1 || last.from === from)) {
      last.from = from;
      if (a >= 0) { last.apps = Math.max(0, last.apps) + a; last.points = Math.max(0, last.points) + pts; }
      continue;
    }
    out.push({ club, name, from, to: from, apps: a, points: pts, current: false });
  }
  return out;
}

/** A player's spells, newest first — his club now on top, even before he has played for it. */
function spellRows(world: World, p: number): SpellRow[] {
  const store = world.players;
  const now = store.isActive(p) ? store.clubId[p] : -1;
  const all: SpellRow[] = spellsOf(world, p).map((s) => ({ ...s, current: false })).reverse();
  // A real player's own career stands in for the made-up years before the save.
  const real = realSpells(world, p);
  // The spells of the save itself come first, his club now among them: a real season before it is never "now".
  const rows = real === null ? all : all.filter((s) => s.from >= 0);
  if (now >= 0) {
    if (rows[0]?.club === now) rows[0].current = true;
    else rows.unshift({ club: now, from: world.season, to: world.season, apps: 0, points: 0, current: true });
  }
  return real === null ? rows : [...rows, ...real];
}

function yearsLabel(world: World, s: SpellRow): string {
  const [from, to] = spellYears(world, s);
  return s.current ? `${from}–now` : `${from}–${to}`;
}

function SpellLine({ world, s, nation }: { world: World; s: SpellRow; nation: number }): JSX.Element {
  const club = world.clubs[s.club];
  const before = s.apps < 0;
  return (
    <div className={`ch-row${s.current ? ' current' : ''}`}>
      <span className="ch-years">{yearsLabel(world, s)}</span>
      <span className="ch-club">
        {club !== undefined && club.nation !== nation && <Flag nation={club.nation} />}
        {s.club >= 0 ? <ClubLink id={s.club} /> : <span translate="no">{s.name}</span>}
        {s.loan === true && <span className="ch-loan">Loan</span>}
      </span>
      <span className="ch-num" title={before ? 'Before the save began' : 'Matches'}>{before ? '—' : s.apps}</span>
      <span className="ch-num" title={before ? 'Before the save began' : 'Points'}>{before ? '—' : s.points}</span>
    </div>
  );
}

function SpellHead(): JSX.Element {
  return (
    <div className="ch-row ch-head">
      <span className="ch-years">Years</span>
      <span className="ch-club">Club</span>
      <span className="ch-num">M</span>
      <span className="ch-num">Pts</span>
    </div>
  );
}

/** Where he has played: his latest clubs, the whole list a click away. */
export function ClubHistoryCard({ world, p }: { world: World; p: number }): JSX.Element {
  const [open, setOpen] = useState(false);
  // As many spells as the card has room for — never a list to scroll.
  const [shown, setShown] = useState(SHOWN);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el === null) return;
    const fit = (): void => {
      const head = el.querySelector('.ch-head')?.getBoundingClientRect().height ?? 26;
      const row = el.querySelector('.ch-row:not(.ch-head)')?.getBoundingClientRect().height || 34;
      const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      // Not laid out to the window (a narrow one stacks and scrolls): the usual few.
      const n = getComputedStyle(el).overflowY === 'visible' ? SHOWN : Math.floor((el.clientHeight - head - pad + 1) / row);
      setShown(Math.max(1, n));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rows = spellRows(world, p);
  const store = world.players;
  const nation = store.nation[p];
  const clubs = new Set(rows.map((r) => (r.club >= 0 ? String(r.club) : r.name ?? ''))).size;
  return (
    <section className="card ch-card">
      <header className="card-head">
        <Icon name="club" size={15} />
        <h3 className="card-title">Clubs</h3>
        {rows.length > shown && (
          <div className="card-actions">
            <button className="link" onClick={() => setOpen(true)}>View all ({rows.length}) <Icon name="arrowRight" size={12} /></button>
          </div>
        )}
      </header>
      {rows.length === 0
        ? <p className="faint ch-empty">No club yet.</p>
        : (
          <div className="ch-list" ref={listRef}>
            <SpellHead />
            {rows.slice(0, shown).map((s) => <SpellLine key={`${s.club}:${s.name ?? ''}:${s.from}`} world={world} s={s} nation={nation} />)}
          </div>
        )}
      {open && (
        <div className="hol-overlay" onClick={() => setOpen(false)}>
          <div className="hol-card ch-dialog" role="dialog" aria-label="Club history" onClick={(e) => e.stopPropagation()}>
            <header className="hol-top">
              <span className="hol-crumbs">{store.fullName(p)} <Icon name="chevronRight" size={12} /> <b>Club history</b></span>
              <button className="icon-btn" onClick={() => setOpen(false)} title="Close"><Icon name="close" size={16} /></button>
            </header>
            <h2 className="hol-title">Club History</h2>
            <p className="hol-sub">
              {clubs} club{clubs === 1 ? '' : 's'} · {rows.length} spell{rows.length === 1 ? '' : 's'}.
              {' '}Matches and points count from the {world.startYear}/{String((world.startYear + 1) % 100).padStart(2, '0')} season on
              {realSpells(world, p) !== null ? ', and before it where the records have them.' : '.'}
            </p>
            <div className="ch-list ch-all">
              <SpellHead />
              <div className="ch-scroll">
                {rows.map((s) => <SpellLine key={`${s.club}:${s.name ?? ''}:${s.from}`} world={world} s={s} nation={nation} />)}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
