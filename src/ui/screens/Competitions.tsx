import { useState, type JSX } from 'react';
import { compareTableRows } from '../../engine/model/club.ts';
import { cupGroupTable, cupProgress, isCupCompetition, stageLabel } from '../../engine/season/cups.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import type { Competition, Fixture } from '../../engine/world/world.ts';
import { ClubCrest, ClubLink, Empty, FormGuide, money } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { BracketView } from './Match.tsx';

const REGION: Readonly<Record<string, string>> = {
  CEV: 'Europe',
  CSV: 'South America',
  NORCECA: 'North & Central America',
  AVC: 'Asia',
  CAVB: 'Africa',
};

/** "National cup", "Europe", "World"… — the kicker over a competition's name. */
export function competitionKind(comp: Competition): string {
  switch (comp.kind) {
    case 'league': return 'League';
    case 'cup': return 'National cup';
    case 'supercup': return 'Super cup';
    case 'continental': return REGION[comp.organizer ?? ''] ?? 'Continental';
    case 'clubworld': return 'World';
    default: return 'International';
  }
}

/** Display order of a club's competitions: league, then cups, then abroad. */
const KIND_ORDER = ['league', 'supercup', 'cup', 'continental', 'clubworld'];

/**
 * Every competition the club is in this season, one card each — where it
 * stands, what is next — and the big ones it is only following.
 */
export function CompetitionsScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const confederation = NATIONS[club.nation].confederation;

  const mine = world.competitions
    .filter((c) => isCupCompetition(c) && c.cup?.season === world.season && c.cup.entrants.includes(club.id))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  // The headline competitions you can only watch this year.
  const following = world.competitions.filter((c) =>
    (c.key === `cont:${confederation}:1` || c.kind === 'clubworld') && !mine.includes(c));

  return (
    <div className="comps">
      <div className="comps-grid">
        <LeagueCard />
        {mine.map((c) => <CupCard key={c.id} comp={c} />)}
        {following.map((c) => <SpectatorCard key={c.id} comp={c} />)}
      </div>
      <BrowseBar />
    </div>
  );
}

function LeagueCard(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const comp = world.competitions[club.leagueId];
  const table = comp !== undefined ? [...comp.table].sort(compareTableRows) : [];
  const pos = table.findIndex((r) => r.clubId === club.id);
  const rows = pos < 5 ? table.slice(0, 5) : [...table.slice(0, 4), table[pos]];
  const played = (comp?.fixtureIds ?? [])
    .map((id) => world.fixtures[id])
    .filter((f) => f.played && (f.home === club.id || f.away === club.id))
    .sort((a, b) => a.day - b.day)
    .slice(-5);
  const form = played.map((f): 'W' | 'L' => ((f.home === club.id) === (f.homeSets > f.awaySets) ? 'W' : 'L'));

  return (
    <section className="comp-card">
      <header className="comp-card-head">
        <span className="comp-card-icon"><Icon name="trophy" size={18} /></span>
        <span className="comp-card-titles">
          <span className="comp-card-kind">League</span>
          <strong>{comp?.name ?? 'League'}</strong>
        </span>
        {pos >= 0 && <span className="comp-card-status">{ordinal(pos + 1)} of {table.length}</span>}
      </header>
      {form.length > 0 && <div className="comp-form"><span>Form</span><FormGuide results={form} /></div>}
      <div className="comp-mini">
        {rows.map((r) => (
          <div key={r.clubId} className={`comp-mini-row${r.clubId === club.id ? ' me' : ''}`}>
            <span className="comp-mini-pos">{table.indexOf(r) + 1}</span>
            <ClubLink id={r.clubId} />
            <b>{r.points}</b>
          </div>
        ))}
      </div>
      <button className="comp-card-link" onClick={() => g.go('table')}>Full table <Icon name="chevronRight" size={13} /></button>
    </section>
  );
}

function CupCard({ comp }: { comp: Competition }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const me = world.userClubId;
  const progress = cupProgress(comp, me);
  const cup = comp.cup!;
  const group = cup.bracket === null ? cup.groups.find((grp) => grp.clubIds.includes(me)) : undefined;
  const mine = comp.fixtureIds
    .map((id) => world.fixtures[id])
    .filter((f) => f.home === me || f.away === me)
    .sort((a, b) => a.day - b.day);
  const next = mine.find((f) => !f.played);
  const last = [...mine].reverse().find((f) => f.played);

  const status = progress === null ? '' : progress.champion
    ? 'Winners'
    : progress.alive || progress.stage === 'Runners-up' ? progress.stage : `Out · ${progress.stage}`;

  return (
    <section className={`comp-card${progress?.champion === true ? ' champion' : ''}`}>
      <header className="comp-card-head">
        <span className="comp-card-icon"><Icon name={comp.kind === 'clubworld' ? 'world' : 'trophy'} size={18} /></span>
        <span className="comp-card-titles">
          <span className="comp-card-kind">{competitionKind(comp)}</span>
          <strong>{comp.name}</strong>
        </span>
        <span className={`comp-card-status${progress !== null && !progress.alive && !progress.champion ? ' out' : ''}`}>{status}</span>
      </header>

      {group !== undefined && <GroupTable compId={comp.id} groupName={group.name} compact />}
      {group === undefined && next !== undefined && <TieLine fixture={next} label="Next" />}
      {group === undefined && last !== undefined && <TieLine fixture={last} label="Last" />}
      {mine.length === 0 && <p className="comp-note">A bye through the first round.</p>}

      <button className="comp-card-link" onClick={() => g.openCompetition(comp.id)}>
        View competition <Icon name="chevronRight" size={13} />
      </button>
    </section>
  );
}

function SpectatorCard({ comp }: { comp: Competition }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const holder = comp.champion >= 0 ? world.clubs[comp.champion] : undefined;
  const bracket = comp.cup?.bracket;
  const stage = comp.cup === undefined
    ? 'Not played this season'
    : bracket?.resolved === true ? 'Finished' : bracket !== null && bracket !== undefined ? 'Knockout stage' : 'Group stage';
  return (
    <section className="comp-card spectator">
      <header className="comp-card-head">
        <span className="comp-card-icon"><Icon name={comp.kind === 'clubworld' ? 'world' : 'trophy'} size={18} /></span>
        <span className="comp-card-titles">
          <span className="comp-card-kind">{competitionKind(comp)}</span>
          <strong>{comp.name}</strong>
        </span>
        <span className="comp-card-status">Spectator</span>
      </header>
      <p className="comp-note">Following along. Your team isn&apos;t in this competition.</p>
      <div className="comp-facts">
        <span>{stage}</span>
        {holder !== undefined && <span>Holders: <ClubLink id={holder.id} /></span>}
        <span>{comp.participants.length} clubs · {money(comp.prizePool)} to the winners</span>
      </div>
      <button className="comp-card-link" onClick={() => g.openCompetition(comp.id)}>
        View competition <Icon name="chevronRight" size={13} />
      </button>
    </section>
  );
}

/** A tie in a card: the two clubs, the score or the date. */
function TieLine({ fixture: f, label }: { fixture: Fixture; label: string }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const me = world.userClubId;
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  const won = f.played && (f.home === me) === (f.homeSets > f.awaySets);
  return (
    <div className="comp-tie">
      <span className="comp-tie-label">{label} · {stageLabel(world, f)}</span>
      <div className="comp-tie-row">
        {home !== undefined && <ClubCrest club={home} size={22} />}
        <span className={f.home === me ? 'me' : ''}>{home?.name ?? '—'}</span>
        <b className={f.played ? (won ? 'win' : 'loss') : ''}>{f.played ? `${f.homeSets}–${f.awaySets}` : 'vs'}</b>
        <span className={f.away === me ? 'me' : ''}>{away?.name ?? '—'}</span>
        {away !== undefined && <ClubCrest club={away} size={22} />}
      </div>
      <span className="comp-tie-date">
        {g.longDateLabel(f.day)}{f.neutralVenue ? ' · neutral venue' : ''}
      </span>
    </div>
  );
}

/** Jump to any competition in the world: the continental ones, or any nation's cup. */
function BrowseBar(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const cups = world.competitions.filter(isCupCompetition);
  const worldwide = cups.filter((c) => c.kind === 'continental' || c.kind === 'clubworld');
  const national = cups.filter((c) => c.kind === 'cup' || c.kind === 'supercup').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="comps-browse">
      <span className="faint">Follow another competition</span>
      <select value="" onChange={(e) => { if (e.target.value !== '') g.openCompetition(Number(e.target.value)); }}>
        <option value="">Choose a competition…</option>
        <optgroup label="Continental & world">
          {worldwide.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
        <optgroup label="National cups">
          {national.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      </select>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

// ---- One competition ---------------------------------------------------------------

type DetailTab = 'groups' | 'knockout' | 'results';

/** A competition's own page: its groups, its bracket and every result. */
export function CompetitionDetail(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const comp = g.selectedCompetition !== null ? world.competitions[g.selectedCompetition] : undefined;
  const cup = comp?.cup;
  const [tab, setTab] = useState<DetailTab>(() =>
    cup?.bracket !== null && cup?.bracket !== undefined ? 'knockout' : cup !== undefined && cup.groups.length > 0 ? 'groups' : 'results');
  if (comp === undefined) return null;

  const holder = comp.champion >= 0 ? world.clubs[comp.champion] : undefined;
  const tabs: Array<[DetailTab, string]> = [];
  if (cup !== undefined && cup.groups.length > 0) tabs.push(['groups', 'Groups']);
  if (cup !== undefined) tabs.push(['knockout', 'Knockout']);
  tabs.push(['results', 'Fixtures & results']);
  const active = tabs.some(([t]) => t === tab) ? tab : tabs[0][0];

  return (
    <div className="comp-page">
      <div className="comp-page-head">
        <span className="comp-card-icon lg"><Icon name={comp.kind === 'clubworld' ? 'world' : 'trophy'} size={24} /></span>
        <div className="comp-page-titles">
          <span className="comp-card-kind">{competitionKind(comp)} · {comp.organizer ?? ''}</span>
          <h2>{comp.name}</h2>
          <span className="faint">
            {comp.participants.length} clubs · {money(comp.prizePool)} to the winners
            {holder !== undefined && <> · {cup?.bracket?.resolved === true ? 'Winners' : 'Holders'}: <ClubLink id={holder.id} /></>}
          </span>
        </div>
        <div className="comp-page-tabs" role="tablist">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" className={`hdr-tab${active === t ? ' active' : ''}`} onClick={() => setTab(t)}>{label}</button>
          ))}
        </div>
        <button className="icon-btn" title="Close" onClick={() => g.back()}><Icon name="close" size={18} /></button>
      </div>

      {cup === undefined && <Empty>This competition is not being played this season — it starts with the next one.</Empty>}

      {cup !== undefined && active === 'groups' && (
        <div className="comp-groups">
          {cup.groups.map((grp) => <GroupTable key={grp.name} compId={comp.id} groupName={grp.name} />)}
        </div>
      )}

      {cup !== undefined && active === 'knockout' && (
        <section className="card comp-bracket">
          <div className="card-body">
            {cup.bracket !== null
              ? <BracketView group={cup.bracket} world={world} />
              : <Empty>The knockout is drawn once the group stage is over.</Empty>}
          </div>
        </section>
      )}

      {active === 'results' && <ResultsList comp={comp} />}
    </div>
  );
}

/** One group's table; the places that go through are marked. */
function GroupTable({ compId, groupName, compact = false }: { compId: number; groupName: string; compact?: boolean }): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const comp = world.competitions[compId];
  const group = comp?.cup?.groups.find((x) => x.name === groupName);
  if (comp === undefined || group === undefined) return null;
  const rows = cupGroupTable(world, group);
  const through = comp.cup?.advancePerGroup ?? 2;
  return (
    <div className={`comp-group${compact ? ' compact' : ''}`}>
      <div className="comp-group-name">Group {group.name}</div>
      <table className="comp-group-table">
        <thead>
          <tr>
            <th className="num">#</th><th>Club</th><th className="num">P</th>
            {!compact && <><th className="num">W</th><th className="num">L</th><th className="num">Sets</th></>}
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.clubId} className={`${i < through ? 'through' : ''}${r.clubId === world.userClubId ? ' me' : ''}`}>
              <td className="num">{i + 1}</td>
              <td><ClubLink id={r.clubId} /></td>
              <td className="num dim">{r.played}</td>
              {!compact && (
                <>
                  <td className="num">{r.won}</td>
                  <td className="num">{r.lost}</td>
                  <td className="num dim">{r.setsFor}:{r.setsAgainst}</td>
                </>
              )}
              <td className="num"><b>{r.points}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsList({ comp }: { comp: Competition }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const me = world.userClubId;
  const fixtures = comp.fixtureIds
    .map((id) => world.fixtures[id])
    .filter((f) => f.day >= world.season * 365 || comp.kind === 'league')
    .sort((a, b) => a.day - b.day || a.id - b.id);
  if (fixtures.length === 0) return <Empty>No matches scheduled.</Empty>;
  return (
    <section className="card comp-results">
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Stage</th><th className="num">Home</th><th className="num">Score</th><th>Away</th></tr>
          </thead>
          <tbody>
            {fixtures.map((f) => (
              <tr key={f.id} className={f.home === me || f.away === me ? 'me' : ''}>
                <td className="dim">{g.weekdayLabelForDay(f.day)} {g.dateLabelForDay(f.day)}</td>
                <td className="faint">{stageLabel(world, f)}{f.neutralVenue ? ' · neutral' : ''}</td>
                <td className="num"><span className={f.played && f.homeSets > f.awaySets ? 'strong' : ''}><ClubLink id={f.home} /></span></td>
                <td className="num"><b>{f.played ? `${f.homeSets}–${f.awaySets}` : 'v'}</b></td>
                <td><span className={f.played && f.awaySets > f.homeSets ? 'strong' : ''}><ClubLink id={f.away} /></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
