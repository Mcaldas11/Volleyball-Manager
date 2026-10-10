import { useState, type JSX } from 'react';
import { spellsOf, spellYears, type ClubSpell } from '../engine/world/clubHistory.ts';
import type { World } from '../engine/world/world.ts';
import { ClubLink, Flag } from './components.tsx';
import { Icon } from './icons.tsx';

/** Spells the profile card shows; the rest are a click away. */
const SHOWN = 4;

interface SpellRow extends ClubSpell {
  /** Where he is now — the spell still running. */
  current: boolean;
}

/** A player's spells, newest first — his club now on top, even before he has played for it. */
function spellRows(world: World, p: number): SpellRow[] {
  const store = world.players;
  const now = store.isActive(p) ? store.clubId[p] : -1;
  const rows: SpellRow[] = spellsOf(world, p).map((s) => ({ ...s, current: false })).reverse();
  if (now >= 0) {
    if (rows[0]?.club === now) rows[0].current = true;
    else rows.unshift({ club: now, from: world.season, to: world.season, apps: 0, points: 0, current: true });
  }
  return rows;
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
        <ClubLink id={s.club} />
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
  const rows = spellRows(world, p);
  const store = world.players;
  const nation = store.nation[p];
  const clubs = new Set(rows.map((r) => r.club)).size;
  return (
    <section className="card ch-card">
      <header className="card-head">
        <Icon name="club" size={15} />
        <h3 className="card-title">Clubs</h3>
        {rows.length > SHOWN && (
          <div className="card-actions">
            <button className="link" onClick={() => setOpen(true)}>View all ({rows.length}) <Icon name="arrowRight" size={12} /></button>
          </div>
        )}
      </header>
      {rows.length === 0
        ? <p className="faint ch-empty">No club yet.</p>
        : (
          <div className="ch-list">
            <SpellHead />
            {rows.slice(0, SHOWN).map((s) => <SpellLine key={`${s.club}:${s.from}`} world={world} s={s} nation={nation} />)}
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
              {' '}Matches and points count from the {world.startYear}/{String((world.startYear + 1) % 100).padStart(2, '0')} season on.
            </p>
            <div className="ch-list ch-all">
              <SpellHead />
              <div className="ch-scroll">
                {rows.map((s) => <SpellLine key={`${s.club}:${s.from}`} world={world} s={s} nation={nation} />)}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
