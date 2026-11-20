/**
 * Pre-season tournaments: the ones the manager's club — or national team — is
 * in, with their groups, bracket and results; the invitations waiting on an
 * answer; hosting one of his own; and the friendly trophy cabinet, kept apart
 * from the real honours.
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import {
  clubFreeFor, cupCandidates, cupFixtures, cupStageName, friendlyTrophies, groupTable, hostDates, MAX_CUPS, openInvites,
  QUARTER_FINAL, userCups, type CupInvite, type CupSize, type PreseasonCup,
} from '../engine/season/preseasonCups.ts';
import { friendlyCupDays } from '../engine/world/nationalExtras.ts';
import { nationName, poolTable, rankingFor, userNation, type Tournament } from '../engine/world/internationals.ts';
import { sideAge } from '../engine/world/sides.ts';
import type { LeagueTableRow } from '../engine/model/club.ts';
import { ClubCrest, Flag, Segmented } from './components.tsx';
import { Dropdown } from './dropdown.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

type Game = ReturnType<typeof useGame>;
type Tab = 'cups' | 'invites' | 'host' | 'trophies';

/** One side, drawn the same whether it is a club or a nation. */
interface Side { id: number; name: string; mine: boolean }
interface MatchLine { key: string; stage: string; day: number; home: Side; away: Side; hs: number; as: number; played: boolean; knockout: boolean }
interface CupView {
  key: string;
  name: string;
  status: string;
  startDay: number;
  endDay: number;
  size: CupSize;
  prize: number;
  groups: Array<{ name: string; rows: Array<{ side: Side; row: LeagueTableRow }> }>;
  matches: MatchLine[];
  /** Still forming: who is in, who is asked. */
  teams: Side[];
  pending: Side[];
  winner: Side | null;
  /** The user's own, to call off before it starts. */
  cancellable?: number;
}

const STATUS: Record<string, string> = {
  forming: 'Invitations out', groups: 'Group stage', knockout: 'Knockout', done: 'Finished', cancelled: 'Called off',
  planned: 'Arranged', called: 'Squads named', pools: 'Group stage',
};

function clubView(g: Game, cup: PreseasonCup): CupView {
  const world = g.world!;
  const side = (id: number): Side => ({ id, name: world.clubs[id]?.name ?? '—', mine: id === world.userClubId });
  const fixtures = cupFixtures(world, cup);
  return {
    key: `c${cup.id}`,
    name: cup.name,
    status: STATUS[cup.stage] ?? cup.stage,
    startDay: cup.startDay,
    endDay: cup.startDay + (cup.size === 4 ? 4 : 5),
    size: cup.size,
    prize: cup.prize,
    groups: cup.groups.map((_, i) => ({
      name: cup.groups.length === 1 ? 'Round robin' : `Group ${String.fromCharCode(65 + i)}`,
      rows: groupTable(world, cup, i).map((row) => ({ side: side(row.clubId), row })),
    })),
    matches: fixtures.map((f) => ({
      key: `f${f.id}`, stage: cupStageName(cup, f), day: f.day, home: side(f.home), away: side(f.away),
      hs: f.homeSets, as: f.awaySets, played: f.played, knockout: f.round >= QUARTER_FINAL,
    })),
    teams: cup.teams.map(side),
    pending: cup.pending.map((p) => side(p.clubId)),
    winner: cup.stage === 'done' && cup.placings.length > 0 ? side(cup.placings[0]) : null,
    cancellable: cup.host === world.userClubId && cup.stage === 'forming' ? cup.id : undefined,
  };
}

function nationView(g: Game, t: Tournament): CupView {
  const world = g.world!;
  const mine = userNation(world);
  const side = (n: number): Side => ({ id: n, name: nationName(n), mine: n === mine });
  return {
    key: `n${t.id}`,
    name: t.name,
    status: STATUS[t.status] ?? t.status,
    startDay: t.startDay,
    endDay: t.knockoutDays[t.knockoutDays.length - 1],
    size: t.cup?.size ?? 4,
    prize: 0,
    groups: t.pools.map((p) => ({ name: p.name, rows: poolTable(t, p).map((row) => ({ side: side(row.clubId), row })) })),
    matches: t.matches.map((m) => ({
      key: `m${m.id}`, stage: m.bronze ? '3rd place match' : m.stage, day: m.day, home: side(m.home), away: side(m.away),
      hs: m.homeSets, as: m.awaySets, played: m.played, knockout: m.round >= 0,
    })),
    teams: t.teams.map(side),
    pending: [],
    winner: t.status === 'done' && t.placings.length > 0 ? side(t.placings[0]) : null,
  };
}

export function CupsDialog(): JSX.Element | null {
  const g = useGame();
  if (g.world === null || !g.cupsDialog) return null;
  return <CupsWindow />;
}

function CupsWindow(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const national = userNation(world) >= 0 && (g.club === null || g.nationalView());
  const invites = openInvites(world).filter((i) => (i.nation !== undefined) === national);
  const [tab, setTab] = useState<Tab>(invites.length > 0 ? 'invites' : 'cups');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') g.closeCupsDialog();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const views: CupView[] = national
    ? (world.internationals?.tournaments ?? [])
      .filter((t) => t.cup !== undefined && t.teams.includes(userNation(world)) && t.season >= world.season - 1)
      .sort((a, b) => b.startDay - a.startDay)
      .map((t) => nationView(g, t))
    : userCups(world).sort((a, b) => b.startDay - a.startDay).map((c) => clubView(g, c));

  return (
    <div className="hol-overlay" onClick={() => g.closeCupsDialog()}>
      <div className="hol-card fr-card cupw-card" role="dialog" aria-label="Pre-season tournaments" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs">Calendar <Icon name="chevronRight" size={12} /> <b>Tournaments</b></span>
          <button className="icon-btn" onClick={() => g.closeCupsDialog()} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <h2 className="hol-title">{national ? 'Friendly Tournaments' : 'Pre-season Tournaments'}</h2>
        <p className="hol-sub">
          Four or eight {national ? 'national teams' : 'clubs'} at one venue: groups, then the semi-finals, the final and a match for third.
          {' '}Every match is a friendly, and the trophy is a friendly one.
        </p>
        <div className="cupw-tabs">
          <Segmented
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              ['cups', `Tournaments${views.length > 0 ? ` (${views.length})` : ''}`],
              ['invites', `Invitations${invites.length > 0 ? ` (${invites.length})` : ''}`],
              ['host', 'Host one'],
              ['trophies', 'Trophy cabinet'],
            ] as const}
          />
        </div>
        <div className="cupw-body">
          {tab === 'cups' && <CupsTab views={views} onHost={() => setTab('host')} />}
          {tab === 'invites' && <InvitesTab invites={invites} />}
          {tab === 'host' && (national ? <HostNation onDone={() => setTab('cups')} /> : <HostClub onDone={() => setTab('cups')} />)}
          {tab === 'trophies' && <TrophiesTab national={national} />}
        </div>
        <footer className="hol-foot fr-foot">
          <span className="faint cupw-note">Friendly trophies are kept in their own cabinet — they are not honours or titles.</span>
          <span className="flex-spacer" />
          <button onClick={() => g.closeCupsDialog()}>Close</button>
        </footer>
      </div>
    </div>
  );
}

function SideName({ s }: { s: Side }): JSX.Element {
  return <span className={s.mine ? 'cupw-mine' : ''}>{s.name}</span>;
}

function CupsTab({ views, onHost }: { views: CupView[]; onHost: () => void }): JSX.Element {
  const g = useGame();
  const [picked, setPicked] = useState<string | null>(views[0]?.key ?? null);
  const view = views.find((v) => v.key === picked) ?? views[0];
  if (view === undefined) {
    return (
      <div className="cupw-empty">
        <Icon name="trophy" size={28} />
        <p>No tournaments this pre-season yet. Host one of your own, or wait for an invitation — they come to the inbox.</p>
        <button className="primary" onClick={onHost}>Host a tournament</button>
      </div>
    );
  }
  const ko = view.matches.filter((m) => m.knockout);
  const rounds = [...new Set(ko.map((m) => m.stage))];
  const groupMatches = view.matches.filter((m) => !m.knockout).sort((a, b) => a.day - b.day);
  return (
    <div className="cupw-split">
      <nav className="cupw-list">
        {views.map((v) => (
          <button key={v.key} className={`cupw-item${v.key === view.key ? ' active' : ''}`} onClick={() => setPicked(v.key)}>
            <strong>{v.name}</strong>
            <span className="faint">{g.dateLabelForDay(v.startDay)} · {v.status}</span>
          </button>
        ))}
      </nav>
      <section className="cupw-detail">
        <div className="cupw-head">
          <div>
            <h3>{view.name} <span className="cupw-badge">Friendly</span></h3>
            <span className="faint">
              {view.size} teams · {g.dateLabelForDay(view.startDay)} – {g.dateLabelForDay(view.endDay)} · {view.status}
              {view.prize > 0 && <> · Prize {Math.round(view.prize / 1000)}k</>}
            </span>
          </div>
          {view.winner !== null && (
            <span className="cupw-winner"><Icon name="trophy" size={15} /> <SideName s={view.winner} /></span>
          )}
          {view.cancellable !== undefined && (
            <button className="sm danger" onClick={() => g.cancelTournament(view.cancellable!)}>Call it off</button>
          )}
        </div>

        {view.groups.length === 0 ? (
          <div className="cupw-forming">
            <h4>The field — {view.teams.length} of {view.size}</h4>
            {view.teams.map((s) => <div key={`t${s.id}`} className="cupw-row"><Icon name="check" size={13} /> <SideName s={s} /></div>)}
            {view.pending.map((s) => <div key={`p${s.id}`} className="cupw-row faint"><Icon name="clock" size={13} /> {s.name} — asked</div>)}
          </div>
        ) : (
          <>
            <div className="cupw-groups">
              {view.groups.map((gr) => (
                <table key={gr.name} className="cupw-table">
                  <thead><tr><th>{gr.name}</th><th>P</th><th>W</th><th>L</th><th>Sets</th><th>Pts</th></tr></thead>
                  <tbody>
                    {gr.rows.map(({ side, row }, i) => (
                      <tr key={side.id} className={side.mine ? 'mine' : ''}>
                        <td><span className="cupw-pos">{i + 1}</span> {side.name}</td>
                        <td>{row.played}</td><td>{row.won}</td><td>{row.lost}</td>
                        <td>{row.setsFor}-{row.setsAgainst}</td><td><b>{row.points}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
            <h4 className="cupw-h">Knockout</h4>
            {rounds.length === 0
              ? <p className="faint cupw-p">{view.size === 4 ? '1st v 4th and 2nd v 3rd once the round robin is over.' : 'A1 v B4, B2 v A3, B1 v A4 and A2 v B3 once the groups are over.'}</p>
              : (
                <div className="cupw-bracket">
                  {rounds.map((r) => (
                    <div key={r} className="cupw-round">
                      <span className="cupw-round-name">{r}</span>
                      {ko.filter((m) => m.stage === r).map((m) => <MatchCard key={m.key} m={m} />)}
                    </div>
                  ))}
                </div>
              )}
            <h4 className="cupw-h">Results</h4>
            <div className="cupw-results">
              {groupMatches.map((m) => (
                <div key={m.key} className="cupw-result">
                  <span className="faint">{g.dateLabelForDay(m.day)}</span>
                  <span className="cupw-res-teams"><SideName s={m.home} /> <b>{m.played ? `${m.hs}-${m.as}` : 'v'}</b> <SideName s={m.away} /></span>
                  <span className="faint">{m.stage}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function MatchCard({ m }: { m: MatchLine }): JSX.Element {
  const g = useGame();
  const hw = m.played && m.hs > m.as;
  const aw = m.played && m.as > m.hs;
  return (
    <div className="cupw-match">
      <span className="faint">{g.dateLabelForDay(m.day)}</span>
      <div className={hw ? 'won' : ''}><SideName s={m.home} /><b>{m.played ? m.hs : ''}</b></div>
      <div className={aw ? 'won' : ''}><SideName s={m.away} /><b>{m.played ? m.as : ''}</b></div>
    </div>
  );
}

function InvitesTab({ invites }: { invites: CupInvite[] }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  if (invites.length === 0) {
    return <div className="cupw-empty"><Icon name="inbox" size={28} /><p>No invitations waiting. Clubs and federations send them to the inbox in the weeks before the pre-season.</p></div>;
  }
  return (
    <div className="cupw-invites">
      {invites.map((inv) => {
        const cup = inv.cupId !== undefined ? world.preseasonCups?.cups.find((c) => c.id === inv.cupId) : undefined;
        const name = cup?.name ?? inv.nation?.name ?? 'Tournament';
        const start = cup?.startDay ?? inv.nation?.startDay ?? world.day;
        const size = cup?.size ?? inv.nation?.size ?? 4;
        const host = cup !== undefined ? world.clubs[cup.host] : undefined;
        const others = cup !== undefined
          ? cup.teams.map((c) => world.clubs[c]?.name ?? '—')
          : (inv.nation?.teams ?? []).map(nationName);
        return (
          <div key={inv.id} className="cupw-invite">
            {host !== undefined ? <ClubCrest club={host} size={36} /> : inv.nation !== undefined ? <Flag nation={inv.nation.host} /> : null}
            <div className="cupw-invite-main">
              <strong>{name}</strong>
              <span className="faint">{size} teams · from {g.dateLabelForDay(start)} · answer by {g.dateLabelForDay(inv.expiresOn)}</span>
              <span className="faint">With {others.join(', ')}{cup !== undefined ? ` · prize ${Math.round(cup.prize / 1000)}k` : ''}</span>
            </div>
            <button onClick={() => g.answerCupInvite(inv.id, false)}>Decline</button>
            <button className="primary" onClick={() => g.answerCupInvite(inv.id, true)}>Accept</button>
          </div>
        );
      })}
    </div>
  );
}

function HostClub({ onDone }: { onDone: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club;
  const [size, setSize] = useState<CupSize>(4);
  const dates = club === null ? [] : hostDates(world, size);
  const [day, setDay] = useState<number | null>(dates[0] ?? null);
  const start = day !== null && dates.includes(day) ? day : dates[0] ?? null;
  const candidates = useMemo(
    () => (club === null || start === null ? [] : cupCandidates(world, club.id, start, size).slice(0, 40)),
    [world, club, start, size],
  );
  const [picked, setPicked] = useState<number[]>([]);
  // A fresh pick whenever the size or the dates change: the nearest in standing, from the country first.
  useEffect(() => { setPicked(candidates.slice(0, size - 1)); }, [start, size]);
  const valid = picked.filter((c) => club !== null && start !== null && clubFreeFor(world, c, start, size));
  if (club === null) return <div className="cupw-empty"><p>You need a club to host a tournament.</p></div>;
  if (dates.length === 0) {
    return <div className="cupw-empty"><Icon name="calendar" size={28} /><p>There are no free dates left in the pre-season for a tournament of {size} — {size === 8 ? 'try four, or ' : ''}wait for next summer.</p>
      {size === 8 && <button onClick={() => setSize(4)}>Four teams</button>}</div>;
  }
  const toggle = (id: number): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < size - 1 ? [...p, id] : p));
  return (
    <div className="cupw-host">
      <div className="fr-controls">
        <div className="fr-field">
          <span>Size</span>
          <Segmented size="sm" options={[[4, '4 teams'], [8, '8 teams']] as const} value={size} onChange={setSize} />
        </div>
        <label className="fr-field">
          <span>First day</span>
          <Dropdown value={start} onChange={setDay} searchable={false}
            options={dates.map((d) => ({ value: d, label: `${g.longDateLabel(d)} – ${g.dateLabelForDay(d + (size === 4 ? 4 : 5))}`, icon: <Icon name="calendar" size={14} /> }))} />
        </label>
        <div className="fr-field">
          <span>Invited</span>
          <b className="cupw-count">{valid.length} / {size - 1}</b>
        </div>
      </div>
      <p className="faint cupw-p">
        At {club.arenaName}. {size === 4 ? 'A round robin, then 1st v 4th and 2nd v 3rd' : 'Two groups of four, then the quarter-finals and semi-finals'}, the final and the match for third.
        {' '}A club that says no is replaced by another. Up to {MAX_CUPS} tournaments a pre-season.
      </p>
      <div className="fr-list">
        {candidates.map((id) => {
          const c = world.clubs[id];
          const on = picked.includes(id);
          return (
            <button key={id} className={`fr-club${on ? ' active' : ''}`} onClick={() => toggle(id)}>
              <span className={`cupw-tick${on ? ' on' : ''}`}>{on && <Icon name="check" size={12} />}</span>
              <ClubCrest club={c} size={26} />
              <span className="fr-club-main">
                <strong>{c.name}</strong>
                <span className="faint">{world.competitions[c.leagueId]?.name ?? `Tier ${c.tier}`}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="cupw-host-foot">
        <button className="primary" disabled={start === null || valid.length !== size - 1}
          onClick={() => { if (start !== null && g.hostTournament(size, start, valid)) onDone(); }}>
          <Icon name="trophy" size={14} /> Send invitations
        </button>
      </div>
    </div>
  );
}

function HostNation({ onDone }: { onDone: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const mine = userNation(world);
  const [size, setSize] = useState<CupSize>(4);
  const dates = useMemo(() => friendlyCupDays(world, size, [mine]), [world, size, mine, world.day]);
  const [day, setDay] = useState<number | null>(dates[0] ?? null);
  const start = day !== null && dates.includes(day) ? day : dates[0] ?? null;
  const candidates = useMemo(() => {
    if (start === null) return [];
    const ranked = rankingFor(world, sideAge(mine)).filter((n) => n !== mine);
    const at = Math.max(0, rankingFor(world, sideAge(mine)).indexOf(mine) - 8);
    return [...ranked.slice(at), ...ranked.slice(0, at)].filter((n) => friendlyCupDays(world, size, [n]).includes(start)).slice(0, 30);
  }, [world, start, size, mine]);
  const [picked, setPicked] = useState<number[]>([]);
  useEffect(() => { setPicked(candidates.slice(0, size - 1)); }, [start, size]);
  if (dates.length === 0) {
    return <div className="cupw-empty"><Icon name="calendar" size={28} /><p>No dates free in the national team's months for the next couple of months.</p></div>;
  }
  const toggle = (n: number): void => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length < size - 1 ? [...p, n] : p));
  return (
    <div className="cupw-host">
      <div className="fr-controls">
        <div className="fr-field">
          <span>Size</span>
          <Segmented size="sm" options={[[4, '4 nations'], [8, '8 nations']] as const} value={size} onChange={setSize} />
        </div>
        <label className="fr-field">
          <span>First day</span>
          <Dropdown value={start} onChange={setDay} searchable={false}
            options={dates.map((d) => ({ value: d, label: g.longDateLabel(d), icon: <Icon name="calendar" size={14} /> }))} />
        </label>
        <div className="fr-field">
          <span>Invited</span>
          <b className="cupw-count">{picked.length} / {size - 1}</b>
        </div>
      </div>
      <p className="faint cupw-p">At home. Friendlies all — caps, never the ranking. The squad is called three days before.</p>
      <div className="fr-list">
        {candidates.map((n) => {
          const on = picked.includes(n);
          return (
            <button key={n} className={`fr-club${on ? ' active' : ''}`} onClick={() => toggle(n)}>
              <span className={`cupw-tick${on ? ' on' : ''}`}>{on && <Icon name="check" size={12} />}</span>
              <Flag nation={n} />
              <span className="fr-club-main"><strong>{nationName(n)}</strong></span>
            </button>
          );
        })}
      </div>
      <div className="cupw-host-foot">
        <button className="primary" disabled={start === null || picked.length !== size - 1}
          onClick={() => { if (start !== null && g.hostNationalTournament(size, start, picked)) onDone(); }}>
          <Icon name="trophy" size={14} /> Arrange the tournament
        </button>
      </div>
    </div>
  );
}

function TrophiesTab({ national }: { national: boolean }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const trophies = national ? friendlyTrophies(world, { nation: userNation(world) }) : friendlyTrophies(world, { clubId: world.userClubId });
  if (trophies.length === 0) {
    return <div className="cupw-empty"><Icon name="trophy" size={28} /><p>No friendly trophies yet. Win a pre-season tournament and it goes here.</p></div>;
  }
  return (
    <div className="cupw-cabinet">
      {trophies.map((t, i) => (
        <div key={i} className="cupw-trophy">
          <Icon name="trophy" size={30} />
          <strong>{t.name}</strong>
          <span className="faint">{t.year}{t.prize > 0 ? ` · ${Math.round(t.prize / 1000)}k` : ''}</span>
          <span className="cupw-badge">Friendly</span>
        </div>
      ))}
    </div>
  );
}
