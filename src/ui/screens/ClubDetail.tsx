import { useState, type JSX, type ReactNode } from 'react';
import { compareTableRows, type Club } from '../../engine/model/club.ts';
import { POSITIONS, type Position } from '../../engine/model/positions.ts';
import { StaffRole } from '../../engine/model/staff.ts';
import { cupProgress, isCupCompetition, stageLabel } from '../../engine/season/cups.ts';
import { coachSpells, headCoachOf, spellTrophies, vacancyAt } from '../../engine/world/career.ts';
import { ordinal } from '../../engine/world/inbox.ts';
import { wageBill } from '../../engine/world/loans.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import {
  clubTrophies, contractEndSeason, DAYS_PER_SEASON, type Fixture, type World,
} from '../../engine/world/world.ts';
import {
  abilityClass, Bar, Card, ClubCrest, clubThemeStyle, Empty, Flag, FormGuide, initials, KV, managerPhotoUrl, money,
  PersonFace, PlayerFace, Pos, Segmented, StarMeter,
} from '../components.tsx';
import { HonourList, honourOf, type Honour } from '../honours.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { useGame } from '../state.ts';
import { VacancyAction } from './Career.tsx';
import { shortCompName } from './Calendar.tsx';
import { SquadScreen } from './Squad.tsx';

/**
 * Any club's page, reachable by clicking its name anywhere it appears — the
 * way FM's club overview lays it out: a header with the facts that matter,
 * then a wall of small cards, each one thing at a glance, with the full squad
 * and the club's history a tab away.
 */
export function ClubDetail(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const club = g.selectedClub !== null ? world.clubs[g.selectedClub] : undefined;
  if (club === undefined) return null;
  return <ClubPage key={club.id} club={club} />;
}

type Tab = 'overview' | 'squad' | 'history';

/** How far a club's name carries, in FM's words. */
export function reputationWord(rep: number): string {
  if (rep >= 8500) return 'Worldwide';
  if (rep >= 6500) return 'Continental';
  if (rep >= 4000) return 'National';
  if (rep >= 2000) return 'Regional';
  return 'Local';
}

/** A facility's 1-20 rating, in words. */
function facilityWord(v: number): { label: string; cls: string } {
  if (v >= 18) return { label: 'Superb', cls: 'good' };
  if (v >= 15) return { label: 'Excellent', cls: 'good' };
  if (v >= 12) return { label: 'Good', cls: '' };
  if (v >= 9) return { label: 'Adequate', cls: '' };
  if (v >= 6) return { label: 'Basic', cls: 'warn' };
  return { label: 'Poor', cls: 'bad' };
}

/** The club's matches this season, in date order — league, cups and friendlies. */
function seasonFixtures(world: World, club: Club): Fixture[] {
  const start = world.season * DAYS_PER_SEASON;
  const ids = new Set<number>();
  for (const comp of world.competitions) {
    const mine = comp.id === club.leagueId || comp.kind === 'friendly' ||
      (isCupCompetition(comp) && comp.cup?.season === world.season && comp.cup.entrants.includes(club.id));
    if (mine) for (const id of comp.fixtureIds) ids.add(id);
  }
  return [...ids]
    .map((id) => world.fixtures[id])
    .filter((f) => f !== undefined && f.day >= start && f.day < start + DAYS_PER_SEASON && (f.home === club.id || f.away === club.id))
    .sort((a, b) => a.day - b.day);
}

function ClubPage({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [tab, setTab] = useState<Tab>('overview');
  const comp = world.competitions[club.leagueId];
  const table = comp !== undefined ? [...comp.table].sort(compareTableRows) : [];
  const pos = table.findIndex((r) => r.clubId === club.id);
  const isUserClub = club.id === world.userClubId;
  const honours = clubTrophies(world, club.id)
    .map((t) => honourOf(world, t.competitionId, t.year))
    .filter((h): h is Honour => h !== null);

  return (
    <div className="club-profile club-page">
      <div className="club-hero club-hero-ov themed" style={clubThemeStyle(club)}>
        <ClubCrest club={club} size={68} />
        <div className="club-hero-text">
          <h2 className="club-hero-name">{club.name}</h2>
          <span className="club-hero-kicker">
            <Flag nation={club.nation} /> {NATIONS[club.nation]?.name ?? '—'}
            {isUserClub && <span className="your-club-tag">Your club</span>}
          </span>
        </div>
        <HeroFact label="Current league">
          {comp !== undefined ? <>{comp.name}{pos >= 0 && <span className="dim"> ({ordinal(pos + 1)})</span>}</> : '—'}
        </HeroFact>
        <HeroFact label="Head coach"><CoachName club={club} /></HeroFact>
        <HeroFact label="Club reputation">
          <StarMeter value={club.reputation} max={10000} size={13} /> {reputationWord(club.reputation)}
        </HeroFact>
        <div className="club-hero-side">
          <button onClick={() => g.selectClub(null)}><Icon name="close" size={14} /> Close</button>
          <Segmented
            size="sm"
            options={[['overview', 'Overview'], ['squad', 'Squad'], ['history', 'History']] as const}
            value={tab}
            onChange={setTab}
          />
        </div>
      </div>

      {tab === 'overview' && (
        <Overview club={club} honours={honours} onSquad={() => setTab('squad')} onHistory={() => setTab('history')} />
      )}
      {tab === 'squad' && <SquadTab club={club} />}
      {tab === 'history' && <HistoryTab club={club} honours={honours} />}
    </div>
  );
}

function HeroFact({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="club-hero-fact">
      <span className="club-hero-fact-label">{label}</span>
      <span className="club-hero-fact-value">{children}</span>
    </div>
  );
}

/** The club's head coach, a link to his profile — or the user, or nobody. */
function CoachName({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  if (club.id === world.userClubId) {
    return <span className="player-link" onClick={() => g.go('career')}>{world.manager.firstName} {world.manager.lastName}</span>;
  }
  const coach = headCoachOf(world, club);
  if (coach === undefined) return <span className="dim">Vacant</span>;
  return <span className="player-link" onClick={() => g.selectCoach(coach.id)}>{coach.firstName} {coach.lastName}</span>;
}

// ---- Overview ------------------------------------------------------------------

function Overview({ club, honours, onSquad, onHistory }: {
  club: Club; honours: Honour[]; onSquad: () => void; onHistory: () => void;
}): JSX.Element {
  return (
    <div className="club-ov">
      <AboutCard club={club} />
      <SquadCard club={club} onSquad={onSquad} />
      <StaffCard club={club} />
      <SeasonCard club={club} />
      <NewsCard club={club} />
      <HistoryCard honours={honours} onHistory={onHistory} />
      <FixturesCard club={club} />
      <CompetitionsCard club={club} />
      <FacilitiesCard club={club} />
      <FinancesCard club={club} />
    </div>
  );
}

function OvCard({ title, icon, children, actions }: {
  title: string; icon: IconName; children: ReactNode; actions?: ReactNode;
}): JSX.Element {
  return <Card title={title} icon={icon} className="ov-card" actions={actions}>{children}</Card>;
}

function AboutCard({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const comp = world.competitions[club.leagueId];
  return (
    <OvCard title="About Club" icon="club">
      <KV k="Nation"><Flag nation={club.nation} /> {NATIONS[club.nation]?.name ?? '—'}</KV>
      <KV k="Division">{comp !== undefined ? `Tier ${comp.tier}` : '—'}</KV>
      <KV k="Status">{club.tier <= 1 ? 'Professional' : club.tier === 2 ? 'Semi-professional' : 'Amateur'}</KV>
      <KV k="Reputation">{reputationWord(club.reputation)}</KV>
      <KV k="Arena"><span className="ov-ellipsis" title={club.arenaName}>{club.arenaName}</span></KV>
      <KV k="Capacity">{club.arenaCapacity.toLocaleString()}</KV>
    </OvCard>
  );
}

function SquadCard({ club, onSquad }: { club: Club; onSquad: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const n = club.players.length;
  const age = n > 0 ? club.players.reduce((s, p) => s + store.ageOn(p, world.year, 181), 0) / n : 0;
  const avg = n > 0 ? Math.round(club.players.reduce((s, p) => s + store.currentAbility[p], 0) / n) : 0;
  const key = [...club.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 3);
  return (
    <OvCard title="Senior Squad" icon="squad" actions={<button className="ghost sm" onClick={onSquad}>View all</button>}>
      <div className="ov-headline">
        <span><b>{n}</b> players</span>
        <span className="dim">Average age {age.toFixed(1)}</span>
      </div>
      <div className="ov-sub">Average ability <StarMeter value={avg} size={11} /> <span className={abilityClass(avg)}>{avg}</span></div>
      <span className="ov-label">Key players</span>
      {key.map((p) => (
        <div key={p} className="ov-person" onClick={() => g.select(p)}>
          <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={30} />
          <span className="ov-person-main">
            <strong className="player-link">{store.fullName(p)}</strong>
            <span className="ov-person-sub"><Pos pos={store.position[p] as Position} /> <StarMeter value={store.currentAbility[p]} size={10} /></span>
          </span>
        </div>
      ))}
      {key.length === 0 && <Empty>No players registered.</Empty>}
    </OvCard>
  );
}

const COACHING = new Set([StaffRole.AssistantCoach, StaffRole.StrengthCoach, StaffRole.YouthCoach,
  StaffRole.PerformanceAnalyst, StaffRole.SportsPsychologist]);
const RECRUITMENT = new Set([StaffRole.Scout, StaffRole.HeadScout, StaffRole.RecruitmentAnalyst]);
const MEDICAL = new Set([StaffRole.Doctor, StaffRole.Physiotherapist]);

function StaffCard({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const roles = club.staff.map((id) => world.staff[id]?.role).filter((r): r is StaffRole => r !== undefined);
  const count = (set: Set<StaffRole>): number => roles.filter((r) => set.has(r)).length;
  const isUser = club.id === world.userClubId;
  const coach = headCoachOf(world, club);
  const vacancy = vacancyAt(world, club.id);
  return (
    <OvCard title="Club Staff" icon="staff">
      {isUser ? (
        <div className="ov-person" onClick={() => g.go('career')}>
          <PersonFace photoUrl={managerPhotoUrl(world.manager)} name={`${world.manager.firstName} ${world.manager.lastName}`} size={36} />
          <span className="ov-person-main">
            <strong className="player-link">{world.manager.firstName} {world.manager.lastName}</strong>
            <span className="ov-person-sub">Head Coach · you</span>
          </span>
        </div>
      ) : coach !== undefined ? (
        <div className="ov-person" onClick={() => g.selectCoach(coach.id)}>
          <span className="coach-initials">{initials(`${coach.firstName} ${coach.lastName}`)}</span>
          <span className="ov-person-main">
            <strong className="player-link">{coach.firstName} {coach.lastName}</strong>
            <span className="ov-person-sub"><Flag nation={coach.nation} /> Head Coach</span>
          </span>
        </div>
      ) : (
        <div className="ov-person vacant">
          <span className="coach-initials">?</span>
          <span className="ov-person-main">
            <strong>Vacant</strong>
            <span className="ov-person-sub">{vacancy !== undefined ? 'Looking for a head coach' : 'No head coach'}</span>
          </span>
          {vacancy !== undefined && <VacancyAction club={club} />}
        </div>
      )}
      <div className="ov-dept"><Icon name="training" size={15} /> Coaching team <b>{count(COACHING)}</b></div>
      <div className="ov-dept"><Icon name="scouting" size={15} /> Recruitment team <b>{count(RECRUITMENT)}</b></div>
      <div className="ov-dept"><Icon name="medical" size={15} /> Medical team <b>{count(MEDICAL)}</b></div>
    </OvCard>
  );
}

function SeasonCard({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const comp = world.competitions[club.leagueId];
  const table = comp !== undefined ? [...comp.table].sort(compareTableRows) : [];
  const pos = table.findIndex((r) => r.clubId === club.id);
  const row = pos >= 0 ? table[pos] : undefined;
  const form = seasonFixtures(world, club)
    .filter((f) => f.played && world.competitions[f.competitionId]?.kind !== 'friendly')
    .slice(-5)
    .map((f): 'W' | 'L' => ((f.home === club.id) === (f.homeSets > f.awaySets) ? 'W' : 'L'));
  return (
    <OvCard title="This Season" icon="stats">
      <div className="ov-headline">
        <span><b>{row !== undefined ? ordinal(pos + 1) : '—'}</b>{row !== undefined && <span className="dim"> of {table.length}</span>}</span>
        {comp !== undefined && <span className="club-link dim" onClick={() => g.openCompetition(comp.id)}>{comp.name}</span>}
      </div>
      <KV k="Points">{row?.points ?? 0}</KV>
      <KV k="Record">{row !== undefined ? `${row.won}W ${row.lost}L` : '—'}</KV>
      <KV k="Board target">{ordinal(club.boardExpectation)} or better</KV>
      <KV k="Form">{form.length > 0 ? <FormGuide results={form} /> : <span className="dim">No matches yet</span>}</KV>
    </OvCard>
  );
}

function NewsCard({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const items = world.news.filter((n) => n.clubId === club.id || n.otherClubId === club.id).slice(-3).reverse();
  return (
    <OvCard title="Latest News" icon="news">
      {items.length === 0 && <Empty>No recent news.</Empty>}
      {items.map((n) => (
        <div key={n.id} className="ov-news" onClick={() => g.go('news')}>
          <span className="ov-news-date">{g.dateLabelForDay(n.day)}</span>
          <strong>{n.headline}</strong>
        </div>
      ))}
    </OvCard>
  );
}

function HistoryCard({ honours, onHistory }: { honours: Honour[]; onHistory: () => void }): JSX.Element {
  const last = honours.reduce<Honour | null>((best, h) => (best === null || h.year > best.year ? h : best), null);
  return (
    <OvCard title="Club History" icon="trophy" actions={<button className="ghost sm" onClick={onHistory}>View all</button>}>
      <HonourList honours={honours} limit={3} />
      {honours.length > 0 && (
        <div className="ov-foot">
          <span><b className="gold-text">{honours.length}</b> major honours</span>
          {last !== null && <span className="dim">Last: {last.year}</span>}
        </div>
      )}
    </OvCard>
  );
}

function FixturesCard({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const all = seasonFixtures(world, club);
  const played = all.filter((f) => f.played).slice(-2);
  const next = all.filter((f) => !f.played).slice(0, 5 - played.length);
  const rows = [...played, ...next];
  // "30/8", the way FM's schedule reads.
  const short = (day: number): string => {
    const d = g.calendarDate(day);
    return d === null ? '' : `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  };
  return (
    <OvCard title="Fixture Schedule" icon="calendar">
      {rows.length === 0 && <Empty>No fixtures this season.</Empty>}
      {rows.map((f) => {
        const home = f.home === club.id;
        const opp = world.clubs[home ? f.away : f.home];
        const comp = world.competitions[f.competitionId];
        const us = home ? f.homeSets : f.awaySets;
        const them = home ? f.awaySets : f.homeSets;
        return (
          <div key={f.id} className="ov-fixture">
            <span className="ov-fixture-date" title={g.dateLabelForDay(f.day)}>{short(f.day)}</span>
            {opp !== undefined && <ClubCrest club={opp} size={16} />}
            <span className="ov-fixture-opp club-link" onClick={() => opp !== undefined && g.selectClub(opp.id)}>
              {opp?.name ?? '—'}
            </span>
            <span className="ov-fixture-tag" title={`${comp?.name ?? ''} · ${stageLabel(world, f)}`}>
              {shortCompName(comp)} {f.neutralVenue ? 'N' : home ? 'H' : 'A'}
            </span>
            {f.played
              ? <span className={`ov-result ${us > them ? 'win' : 'loss'}`}>{us}-{them}</span>
              : <span className="ov-result dim">—</span>}
          </div>
        );
      })}
    </OvCard>
  );
}

function CompetitionsCard({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const league = world.competitions[club.leagueId];
  const table = league !== undefined ? [...league.table].sort(compareTableRows) : [];
  const pos = table.findIndex((r) => r.clubId === club.id);
  const cups = world.competitions.filter((c) => isCupCompetition(c) && c.cup?.season === world.season && c.cup.entrants.includes(club.id));
  return (
    <OvCard title="Competitions" icon="trophy">
      {league !== undefined && (
        <div className="ov-comp" onClick={() => g.openCompetition(league.id)}>
          <span className="ov-comp-name">{league.name}</span>
          <span className="ov-comp-stage">{pos >= 0 ? ordinal(pos + 1) : '—'}</span>
          <span className="ov-comp-dot alive" />
        </div>
      )}
      {cups.map((c) => {
        const p = cupProgress(c, club.id);
        const state = p?.champion === true ? 'won' : p?.alive === true ? 'alive' : 'out';
        return (
          <div key={c.id} className="ov-comp" onClick={() => g.openCompetition(c.id)}>
            <span className="ov-comp-name">{c.name}</span>
            <span className="ov-comp-stage">{p?.stage ?? '—'}</span>
            {state === 'won' ? <Icon name="trophy" size={13} /> : <span className={`ov-comp-dot ${state}`} />}
          </div>
        );
      })}
      {league === undefined && cups.length === 0 && <Empty>Not in a competition this season.</Empty>}
    </OvCard>
  );
}

function FacilitiesCard({ club }: { club: Club }): JSX.Element {
  const line = (label: string, v: number): JSX.Element => {
    const w = facilityWord(v);
    return <KV k={label}><span className={w.cls}>{w.label}</span></KV>;
  };
  return (
    <OvCard title="Facilities" icon="club">
      {line('Training', club.trainingFacilities)}
      {line('Youth', club.youthFacilities)}
      {line('Youth recruitment', club.youthRecruitment)}
      {line('Medical', club.medicalFacilities)}
      <KV k="Arena">{club.arenaCapacity.toLocaleString()} seats</KV>
    </OvCard>
  );
}

function FinancesCard({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const f = club.finances;
  const bill = wageBill(world, club);
  const used = f.wageBudget > 0 ? Math.round((bill / f.wageBudget) * 100) : 0;
  return (
    <OvCard title="Finances" icon="finances">
      <KV k="Balance"><span className={f.balance < 0 ? 'bad' : undefined}>{money(f.balance)}</span></KV>
      <KV k="Transfer budget">{money(f.transferBudget)}</KV>
      <KV k="Wage budget">{money(f.wageBudget)}</KV>
      <KV k="Wage bill">{money(bill)}</KV>
      <div className="ov-meter">
        <Bar value={Math.min(100, used)} wide />
        <span className={used > 100 ? 'bad' : 'dim'}>{used}% of the wage budget</span>
      </div>
    </OvCard>
  );
}

// ---- Squad -------------------------------------------------------------------------

/** The squad: for the user's own club, the full squad screen — the one place it lives — and a plain list for anyone else's. */
function SquadTab({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  if (club.id === world.userClubId) return <div className="club-squad-own"><SquadScreen /></div>;
  const store = world.players;
  const order = (p: number): number => POSITIONS.indexOf(store.position[p] as Position);
  const players = [...club.players].sort((a, b) => order(a) - order(b) || store.currentAbility[b] - store.currentAbility[a]);
  return (
    <Card title={`Squad · ${players.length} players`} icon="squad" flush className="club-squad">
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>Pos</th>
              <th>Nat</th>
              <th className="num">Age</th>
              <th>Ability</th>
              <th className="num">Value</th>
              <th className="num">Contract</th>
            </tr>
          </thead>
          <tbody>
            {players.map((i) => (
              <tr key={i} className="clickable" onClick={() => g.select(i)}>
                <td className="face-cell"><PlayerFace playerId={store.id[i]} name={store.fullName(i)} size={28} /></td>
                <td className="strong">{store.fullName(i)}</td>
                <td><Pos pos={store.position[i] as Position} /></td>
                <td><Flag nation={store.nation[i]} /></td>
                <td className="num dim">{store.ageOn(i, world.year, 181)}</td>
                <td>
                  <span className="ability-cell">
                    <StarMeter value={store.currentAbility[i]} size={11} />
                    <span className={abilityClass(store.currentAbility[i])}>{store.currentAbility[i]}</span>
                  </span>
                </td>
                <td className="num dim">{money(store.value[i])}</td>
                <td className="num dim">{world.startYear + contractEndSeason(store.contractUntil[i]) + 1}</td>
              </tr>
            ))}
            {players.length === 0 && <tr><td colSpan={8}><Empty>No players registered.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- History -----------------------------------------------------------------------

interface BenchSpell {
  name: string;
  staffId: number | null;
  from: number;
  to: number;
  won: number;
  lost: number;
  trophies: number;
  exit: string;
}

/** Everyone who has coached the club on record: its head coaches' spells, and the user's. */
function benchHistory(world: World, club: Club): BenchSpell[] {
  const out: BenchSpell[] = [];
  for (const s of world.staff) {
    if (s.role !== StaffRole.HeadCoach) continue;
    for (const spell of coachSpells(world, s)) {
      if (spell.clubId !== club.id) continue;
      out.push({
        name: `${s.firstName} ${s.lastName}`, staffId: s.id, from: spell.from, to: spell.to, won: spell.won,
        lost: spell.lost, trophies: spellTrophies(world, spell).length,
        exit: spell.to < 0 ? 'Current' : spell.exit === 'sacked' ? 'Sacked' : spell.exit === 'replaced' ? 'Replaced' : 'Left',
      });
    }
  }
  const m = world.manager;
  for (const j of world.career.jobs) {
    if (j.clubId !== club.id) continue;
    out.push({
      name: `${m.firstName} ${m.lastName} (you)`, staffId: null, from: j.startDay, to: j.endDay, won: j.won, lost: j.lost,
      trophies: j.trophies.length,
      exit: j.exit === null ? 'Current' : j.exit === 'sacked' ? 'Sacked' : j.exit === 'expired' ? 'Contract expired' : 'Left',
    });
  }
  return out.sort((a, b) => b.from - a.from);
}

function HistoryTab({ club, honours }: { club: Club; honours: Honour[] }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const bench = benchHistory(world, club);
  const leagues = honours.filter((h) => h.kind === 'league').length;
  const abroad = honours.filter((h) => h.kind === 'continental' || h.kind === 'clubworld').length;
  return (
    <div className="club-history">
      <Card title={`Honours · ${honours.length}`} icon="trophy">
        <div className="ov-headline history-totals">
          <span><b className="gold-text">{honours.length}</b> major honours</span>
          <span className="dim">{leagues} league · {abroad} continental & world</span>
        </div>
        <HonourList honours={honours} />
      </Card>
      <Card title="Head Coaches" icon="user" flush>
        {bench.length === 0 ? <Empty>No head coach on record.</Empty> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Coach</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">W</th>
                  <th className="num">L</th>
                  <th className="num">Trophies</th>
                  <th>Left</th>
                </tr>
              </thead>
              <tbody>
                {bench.map((b, i) => (
                  <tr
                    key={i}
                    className="clickable"
                    onClick={() => (b.staffId !== null ? g.selectCoach(b.staffId) : g.go('career'))}
                  >
                    <td className="strong">{b.name}</td>
                    <td className="dim">{g.dateLabelForDay(b.from)}</td>
                    <td className="dim">{b.to < 0 ? 'Present' : g.dateLabelForDay(b.to)}</td>
                    <td className="num">{b.won}</td>
                    <td className="num">{b.lost}</td>
                    <td className={`num${b.trophies > 0 ? ' gold-text' : ' dim'}`}>{b.trophies}</td>
                    <td className={b.exit === 'Sacked' ? 'bad' : b.exit === 'Current' ? 'good' : 'dim'}>{b.exit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
