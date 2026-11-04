/**
 * Honours, the way FM lists them: a line per competition — how many times it
 * was won, and when — the biggest first.
 */

import { useState, type JSX } from 'react';
import type { CompetitionKind, World } from '../engine/world/world.ts';
import { accoladeTitle, type Accolade } from '../engine/world/accolades.ts';
import { NATIONS } from '../engine/world/nations.ts';
import { ClubCrest, Empty, Flag } from './components.tsx';
import { Icon } from './icons.tsx';

/** One title won. */
export interface Honour {
  competitionId: number;
  name: string;
  kind: CompetitionKind;
  tier: number;
  key?: string;
  /** The year the season it was won in ended. */
  year: number;
  /** Whose it was, where titles from more than one club are shown together. */
  club?: string;
  /** The club or the nation it was won with, for the cabinet. */
  clubId?: number;
  nation?: number;
}

/** A title won, as the world's history records it, made an honour. */
export function honourOf(
  world: World, competitionId: number, year: number, club?: string, whose?: { clubId?: number; nation?: number },
): Honour | null {
  const comp = world.competitions[competitionId];
  if (comp === undefined) return null;
  return { competitionId, name: comp.name, kind: comp.kind, tier: comp.tier, key: comp.key, year, club, ...whose };
}

/** How big a title is: the world first, then a continent's best, a top-flight league, the cups. */
export function prestige(h: Honour): number {
  if (h.kind === 'clubworld') return 6;
  if (h.kind === 'continental') return h.key === 'cont:CEV:2' ? 4 : 5;
  if (h.kind === 'league') return h.tier <= 1 ? 4.5 : 2.5;
  if (h.kind === 'cup') return 3;
  if (h.kind === 'supercup') return 2;
  return 1;
}

/** The titles by competition, each newest first, the biggest competitions first. */
export function groupHonours(honours: readonly Honour[]): Honour[][] {
  const groups = new Map<number, Honour[]>();
  for (const h of honours) {
    const list = groups.get(h.competitionId) ?? [];
    list.push(h);
    groups.set(h.competitionId, list);
  }
  return [...groups.values()]
    .map((list) => [...list].sort((a, b) => b.year - a.year))
    .sort((a, b) => prestige(b[0]) - prestige(a[0]) || b.length - a.length);
}

/** A line per competition won; `limit` keeps the biggest. */
export function HonourList({ honours, limit, empty = 'No major honours yet.' }: {
  honours: readonly Honour[];
  limit?: number;
  empty?: string;
}): JSX.Element {
  if (honours.length === 0) return <Empty>{empty}</Empty>;
  const groups = groupHonours(honours);
  const shown = limit !== undefined ? groups.slice(0, limit) : groups;
  return (
    <div className="hon-list">
      {shown.map((list) => {
        const first = list[0];
        const years = list.map((h) => (h.club !== undefined ? `${h.year} ${h.club}` : String(h.year))).join(' · ');
        return (
          <div key={first.competitionId} className={`hon-row${prestige(first) >= 5 ? ' top' : ''}`}>
            <Icon name="trophy" size={16} />
            <span className="hon-main">
              <strong title={first.name}>{first.name}</strong>
              <span className="hon-years" title={years}>{years}</span>
            </span>
            <b className="hon-count">{list.length}</b>
          </div>
        );
      })}
      {shown.length < groups.length && (
        <span className="hon-more">+{groups.length - shown.length} more competitions won</span>
      )}
    </div>
  );
}

/**
 * Individual awards, the same way: a line per award — the World Player of the
 * Year, a league's Coach of the Year, a place in a Team of the Season — how
 * many times, and when; the world's first, then the awards before the teams.
 */
export function AccoladeList({ accolades, world, empty = 'No individual awards yet.' }: {
  accolades: readonly Accolade[];
  world: World;
  empty?: string;
}): JSX.Element {
  if (accolades.length === 0) return <Empty>{empty}</Empty>;
  const groups = new Map<string, Accolade[]>();
  for (const a of accolades) {
    const title = accoladeTitle(world, a);
    groups.set(title, [...(groups.get(title) ?? []), a]);
  }
  const weight = (a: Accolade): number => (a.scope === 'world' ? 10 : 0) + (a.kind === 'team' ? 0 : 5);
  const rows = [...groups.entries()].sort((x, y) => weight(y[1][0]) - weight(x[1][0]) || y[1].length - x[1].length);
  return (
    <div className="hon-list">
      {rows.map(([title, list]) => {
        const years = [...list].sort((a, b) => b.season - a.season).map((a) => String(world.startYear + a.season + 1)).join(' · ');
        return (
          <div key={title} className={`hon-row${list[0].scope === 'world' && list[0].kind !== 'team' ? ' top' : ''}`}>
            <Icon name={list[0].kind === 'team' ? 'squad' : 'star'} size={16} />
            <span className="hon-main">
              <strong title={title}>{title}</strong>
              <span className="hon-years" title={years}>{years}</span>
            </span>
            <b className="hon-count">{list.length}</b>
          </div>
        );
      })}
    </div>
  );
}

/** Whose a title or an award was: a club or a nation, shown with its crest or flag. */
function teamOf(world: World, h: { clubId?: number; nation?: number }): { key: string; name: string; badge: JSX.Element } | null {
  if (h.nation !== undefined && NATIONS[h.nation] !== undefined) {
    return { key: `n${h.nation}`, name: NATIONS[h.nation].name, badge: <span className="hall-flag"><Flag nation={h.nation} /></span> };
  }
  const club = h.clubId !== undefined ? world.clubs[h.clubId] : undefined;
  return club !== undefined ? { key: `c${club.id}`, name: club.name, badge: <ClubCrest club={club} size={18} /> } : null;
}

/**
 * Every title and award, with who it was won with: a "View all" for a panel
 * too small to hold them, opening the whole cabinet — by competition, each win
 * with its year and its club or national team, and picked out team by team.
 */
export function AllHonoursButton({ owner, honours, accolades, world }: {
  owner: string;
  honours: readonly Honour[];
  accolades: readonly Accolade[];
  world: World;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState<string | null>(null);
  if (honours.length + accolades.length === 0) return null;
  const close = (): void => {
    setOpen(false);
    setOnly(null);
  };
  // The teams it was all won with, those with the most first.
  const teams = new Map<string, { name: string; badge: JSX.Element; count: number }>();
  for (const h of [...honours, ...accolades]) {
    const t = teamOf(world, h);
    if (t === null) continue;
    const known = teams.get(t.key);
    if (known !== undefined) known.count++;
    else teams.set(t.key, { name: t.name, badge: t.badge, count: 1 });
  }
  const picked = (h: { clubId?: number; nation?: number }): boolean => only === null || teamOf(world, h)?.key === only;
  const groups = groupHonours(honours.filter(picked));
  const awards = new Map<string, Accolade[]>();
  for (const a of accolades.filter(picked)) {
    const title = accoladeTitle(world, a);
    awards.set(title, [...(awards.get(title) ?? []), a]);
  }
  const win = (key: string, year: number, h: { clubId?: number; nation?: number }): JSX.Element => {
    const t = teamOf(world, h);
    return (
      <span key={key} className="hall-win">
        <b>{year}</b>
        {t !== null && <>{t.badge}<span>{t.name}</span></>}
      </span>
    );
  };
  return (
    <>
      <button className="sm cp-title-btn" onClick={() => setOpen(true)}>View all</button>
      {open && (
        <div className="hol-overlay" onClick={close}>
          <div className="hol-card hall-card" role="dialog" aria-label="Trophy cabinet" onClick={(e) => e.stopPropagation()}>
            <header className="hol-top">
              <span className="hol-crumbs">{owner} <Icon name="chevronRight" size={12} /> <b>Trophy cabinet</b></span>
              <button className="icon-btn" onClick={close} title="Close"><Icon name="close" size={16} /></button>
            </header>
            <h2 className="hol-title">Trophy Cabinet</h2>
            <p className="hol-sub">{honours.length} {honours.length === 1 ? 'trophy' : 'trophies'} · {accolades.length} individual {accolades.length === 1 ? 'award' : 'awards'}</p>
            {teams.size > 1 && (
              <div className="hall-teams">
                <button className={only === null ? 'active' : ''} onClick={() => setOnly(null)}>All <b>{honours.length + accolades.length}</b></button>
                {[...teams.entries()].sort((a, b) => b[1].count - a[1].count).map(([key, t]) => (
                  <button key={key} className={only === key ? 'active' : ''} onClick={() => setOnly(key)}>{t.badge} {t.name} <b>{t.count}</b></button>
                ))}
              </div>
            )}
            <div className="hall-list">
              {groups.map((list) => (
                <div key={list[0].competitionId} className={`hall-row${prestige(list[0]) >= 5 ? ' top' : ''}`}>
                  <Icon name="trophy" size={18} />
                  <div className="hall-main">
                    <strong>{list[0].name}</strong>
                    <div className="hall-wins">{list.map((h, i) => win(`${i}`, h.year, h))}</div>
                  </div>
                  <b className="hon-count">{list.length}</b>
                </div>
              ))}
              {awards.size > 0 && <h3 className="hall-head">Individual awards</h3>}
              {[...awards.entries()].map(([title, list]) => (
                <div key={title} className="hall-row">
                  <Icon name={list[0].kind === 'team' ? 'squad' : 'star'} size={18} />
                  <div className="hall-main">
                    <strong>{title}</strong>
                    <div className="hall-wins">
                      {[...list].sort((a, b) => b.season - a.season).map((a, i) => win(`${i}`, world.startYear + a.season + 1, a))}
                    </div>
                  </div>
                  <b className="hon-count">{list.length}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
