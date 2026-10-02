import { useState, type JSX } from 'react';
import type { Club } from '../../engine/model/club.ts';
import {
  applicationBlock, boardMood, currentJob, hiringChance, lastJobEnded, type JobExit, type ManagerJob,
} from '../../engine/world/career.ts';
import { ordinal } from '../../engine/world/inbox.ts';
import {
  nationalApplicationBlock, nationalHiringChance, nextTournamentFor, worldRanking,
} from '../../engine/world/internationals.ts';
import { NATIONS, type Confederation } from '../../engine/world/nations.ts';
import {
  Bar, Card, ClubCrest, Empty, Flag, KV, managerPhotoUrl, PersonFace, Segmented, StarMeter, StatTile,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

const EXIT_LABEL: Readonly<Record<JobExit, string>> = {
  resigned: 'Resigned',
  sacked: 'Sacked',
  moved: 'Moved on',
};

const CONTINENTS: ReadonlyArray<readonly [Confederation | 'all', string]> = [
  ['all', 'All continents'],
  ['CEV', 'Europe'],
  ['CSV', 'South America'],
  ['NORCECA', 'North & Central America'],
  ['AVC', 'Asia & Oceania'],
  ['CAVB', 'Africa'],
];

/** How keen a club is likely to be, in the words an agent would use. */
function interestOf(chance: number): { label: string; cls: 'good' | 'warn' | 'bad' } {
  if (chance >= 0.65) return { label: 'Strong', cls: 'good' };
  if (chance >= 0.4) return { label: 'Good', cls: 'good' };
  if (chance >= 0.2) return { label: 'Slim', cls: 'warn' };
  return { label: 'Unlikely', cls: 'bad' };
}

function moodClass(confidence: number): string {
  if (confidence >= 60) return 'good';
  if (confidence >= 45) return '';
  if (confidence >= 35) return 'warn';
  return 'bad';
}

function winRate(job: ManagerJob): string {
  const n = job.won + job.lost;
  return n === 0 ? '—' : `${Math.round((job.won / n) * 100)}%`;
}

// ---- Shared pieces ---------------------------------------------------------------

/** Jobs on the table, each with its answer buttons. */
function OffersList(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const busy = g.processing || g.matchday !== null || g.postMatch !== null;
  const offers = world.career.offers;
  if (offers.length === 0) return <Empty>No club has offered you a job.</Empty>;
  return (
    <div className="job-list">
      {offers.map((o) => {
        const c = world.clubs[o.clubId];
        if (c === undefined) return null;
        return (
          <div className="job-item" key={o.id}>
            <ClubCrest club={c} size={34} />
            <div className="job-item-main">
              <strong className="player-link" onClick={() => g.selectClub(c.id)}>{c.name}</strong>
              <span className="faint">{world.competitions[c.leagueId]?.name ?? `Tier ${c.tier}`} · until {g.dateLabelForDay(o.expiresOn)}</span>
            </div>
            <div className="job-item-actions">
              <button className="primary sm" disabled={busy} onClick={() => g.acceptJobOffer(o.id)}>Accept</button>
              <button className="sm" onClick={() => g.declineJobOffer(o.id)}>Decline</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Applications waiting on an answer. */
function ApplicationsList(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const apps = world.career.applications;
  if (apps.length === 0) return <Empty>No applications waiting on an answer.</Empty>;
  return (
    <div className="job-list">
      {apps.map((a) => {
        const c = world.clubs[a.clubId];
        if (c === undefined) return null;
        return (
          <div className="job-item" key={a.clubId}>
            <ClubCrest club={c} size={30} />
            <div className="job-item-main">
              <strong className="player-link" onClick={() => g.selectClub(c.id)}>{c.name}</strong>
              <span className="faint">Answer by {g.dateLabelForDay(a.answerOn)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What the user can do about one vacancy: apply, or where things stand. */
export function VacancyAction({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const career = world.career;
  if (career.offers.some((o) => o.clubId === club.id)) {
    return <button className="sm" onClick={() => g.go('career')}>Offer received</button>;
  }
  if (career.applications.some((a) => a.clubId === club.id)) return <span className="faint">Applied</span>;
  const problem = applicationBlock(world, club.id);
  if (problem !== null) return <span className="faint" title={problem}>Unavailable</span>;
  return <button className="primary sm" onClick={() => g.applyForJob(club.id)}>Apply</button>;
}

/** Every club the manager has coached, most recent first. */
function HistoryTable({ limit }: { limit?: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const jobs = [...world.career.jobs].reverse().slice(0, limit);
  if (jobs.length === 0) return <Empty>No jobs yet.</Empty>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Club</th>
            <th>From</th>
            <th>To</th>
            <th className="num">W</th>
            <th className="num">L</th>
            <th className="num">Win %</th>
            <th className="num">Trophies</th>
            <th>Left</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const c = world.clubs[j.clubId];
            return (
              <tr key={`${j.clubId}-${j.startDay}`} className="clickable" onClick={() => c !== undefined && g.selectClub(c.id)}>
                <td>
                  <span className="name-cell">
                    {c !== undefined && <ClubCrest club={c} size={22} />}
                    <span className="strong">{c?.name ?? '—'}</span>
                  </span>
                </td>
                <td className="dim">{g.dateLabelForDay(j.startDay)}</td>
                <td className="dim">{j.endDay < 0 ? 'Present' : g.dateLabelForDay(j.endDay)}</td>
                <td className="num">{j.won}</td>
                <td className="num">{j.lost}</td>
                <td className="num dim">{winRate(j)}</td>
                <td className={`num${j.trophies.length > 0 ? ' gold-text' : ' dim'}`}>{j.trophies.length}</td>
                <td>
                  {j.exit === null
                    ? <span className="your-club-tag">Current</span>
                    : <span className={j.exit === 'sacked' ? 'bad' : 'dim'}>{EXIT_LABEL[j.exit]}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Profile ---------------------------------------------------------------------

/**
 * The manager's own page: who he is, what his name is worth, the job he holds
 * (and the door out of it), the offers on the table and every club he has
 * coached.
 */
export function CareerScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const career = world.career;
  const m = world.manager;
  const name = `${m.firstName} ${m.lastName}`;
  const club = g.club;
  const jobs = career.jobs;
  const won = jobs.reduce((s, j) => s + j.won, 0);
  const lost = jobs.reduce((s, j) => s + j.lost, 0);
  const trophies = jobs.flatMap((j) => j.trophies.map((t) => ({ ...t, clubId: j.clubId })));

  return (
    <div className="club-profile">
      <div className="club-hero career-hero">
        <PersonFace photoUrl={managerPhotoUrl(m)} name={name} size={84} />
        <div className="club-hero-text">
          <span className="club-hero-kicker"><Flag nation={m.nation} /> {NATIONS[m.nation]?.name ?? '—'} · Age {world.year - m.birthYear}</span>
          <h2 className="club-hero-name">{name}</h2>
          <span className="club-hero-sub">
            {club !== null
              ? <><span className="your-club-tag">Head coach</span><span>{club.name}</span></>
              : career.nationalTeam === undefined
                ? <><span className="career-out-tag">Out of work</span><span>since {g.dateLabelForDay(lastJobEnded(world))}</span></>
                : null}
            {career.nationalTeam !== undefined && (
              <><span className="your-club-tag">National coach</span><span><Flag nation={career.nationalTeam} /> {NATIONS[career.nationalTeam]?.name}</span></>
            )}
          </span>
        </div>
        <div className="club-hero-rep">
          <span className="profile-rating-label">Reputation</span>
          <StarMeter value={career.reputation} max={10000} size={20} />
          <span className="dim">{career.reputation.toLocaleString()}</span>
        </div>
      </div>

      <div className="tiles">
        <StatTile label="Clubs coached" value={new Set(jobs.map((j) => j.clubId)).size} />
        <StatTile label="Matches" value={won + lost} sub={`${won}W ${lost}L`} />
        <StatTile label="Win rate" value={won + lost === 0 ? '—' : `${Math.round((won / (won + lost)) * 100)}%`} />
        <StatTile label="Trophies" value={trophies.length} tone={trophies.length > 0 ? 'gold' : undefined} />
        <StatTile label="Sackings" value={jobs.filter((j) => j.exit === 'sacked').length} />
      </div>

      <div className="club-grid">
        <Card title="Career History" icon="career" flush>
          <HistoryTable />
        </Card>

        <div className="stack club-side">
          <CurrentJobCard />
          <Card title={`Job Offers (${career.offers.length})`} icon="offer"><OffersList /></Card>
          {career.applications.length > 0 && (
            <Card title="Applications" icon="contract"><ApplicationsList /></Card>
          )}
          <Card title={`Trophies (${trophies.length})`} icon="trophy">
            {trophies.length === 0
              ? <Empty>No trophies yet.</Empty>
              : [...trophies].reverse().map((t, i) => (
                <div className="trophy-line" key={i}>
                  <Icon name="trophy" size={15} />
                  <span className="trophy-line-year">{world.startYear + t.season + 1}</span>
                  <span>{world.competitions[t.competitionId]?.name ?? 'Title'}</span>
                  <span className="faint">· {world.clubs[t.clubId]?.shortName ?? ''}</span>
                </div>
              ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** The job he holds: how the board sees him, and the way out. */
function CurrentJobCard(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club;
  const job = currentJob(world);
  const [confirming, setConfirming] = useState(false);
  const busy = g.processing || g.matchday !== null || g.postMatch !== null;

  const nationalTeam = world.career.nationalTeam;
  if (club === null && nationalTeam !== undefined) {
    return (
      <Card title="Current Job" icon="world">
        <NationalJobBlock nation={nationalTeam} />
        <p className="career-note">No club job alongside it. Clubs looking for a head coach are listed in the Job Centre — apply, or wait for one to call.</p>
        <button className="primary block" onClick={() => g.go('jobs')}><Icon name="search" size={14} /> Job Centre</button>
      </Card>
    );
  }

  if (club === null) {
    return (
      <Card title="Current Job" icon="club">
        <p className="career-note">You are out of work. Clubs looking for a head coach are listed in the Job Centre — apply, or wait for one to call.</p>
        <button className="primary block" onClick={() => g.go('jobs')}><Icon name="search" size={14} /> Open the Job Centre</button>
      </Card>
    );
  }

  const conf = club.boardConfidence;
  return (
    <Card title="Current Job" icon="club">
      <div className="coach-row career-job-head">
        <ClubCrest club={club} size={40} />
        <div className="coach-row-text">
          <strong>{club.name}</strong>
          <span className="faint">{job !== undefined ? `Since ${g.dateLabelForDay(job.startDay)}` : 'Head coach'}</span>
        </div>
      </div>
      <KV k="Board confidence"><span className={moodClass(conf)}>{boardMood(conf)}</span></KV>
      <div className="career-meter"><Bar value={conf} wide /></div>
      <KV k="Board target">Finish {ordinal(club.boardExpectation)} or better</KV>
      {job !== undefined && <KV k="Record">{job.won}W {job.lost}L</KV>}
      {!confirming ? (
        <button className="danger block career-resign" disabled={busy} onClick={() => setConfirming(true)}>
          <Icon name="exit" size={14} /> Resign
        </button>
      ) : (
        <div className="career-confirm">
          <p>Resign as head coach of <b>{club.name}</b>? You leave at once, and the club will not consider you again for a season.</p>
          <div className="career-confirm-actions">
            <button className="danger" disabled={busy} onClick={() => { setConfirming(false); g.resign(); }}>Confirm resignation</button>
            <button className="ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {nationalTeam !== undefined && <NationalJobBlock nation={nationalTeam} />}
    </Card>
  );
}

/** The national team he coaches, and the way out of it. */
function NationalJobBlock({ nation }: { nation: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [confirming, setConfirming] = useState(false);
  const busy = g.processing || g.matchday !== null || g.postMatch !== null;
  const rank = worldRanking(world).indexOf(nation) + 1;
  const since = world.career.nationalJobs?.find((j) => j.nation === nation && j.endDay < 0)?.startDay;
  return (
    <div className="career-national">
      <div className="coach-row career-job-head">
        <Flag nation={nation} />
        <div className="coach-row-text">
          <strong>{NATIONS[nation]?.name} national team</strong>
          <span className="faint">Head coach{since !== undefined ? ` since ${g.dateLabelForDay(since)}` : ''} · #{rank} in the world</span>
        </div>
      </div>
      {!confirming ? (
        <button className="danger block career-resign" disabled={busy} onClick={() => setConfirming(true)}>
          <Icon name="exit" size={14} /> Step down as national coach
        </button>
      ) : (
        <div className="career-confirm">
          <p>Step down as head coach of <b>{NATIONS[nation]?.name}</b>? The federation will look for someone else.</p>
          <div className="career-confirm-actions">
            <button className="danger" disabled={busy} onClick={() => { setConfirming(false); g.resignNationalJob(); }}>Step down</button>
            <button className="ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Job Centre ------------------------------------------------------------------

type Scope = 'suitable' | 'all';

/**
 * Every club in the world looking for a head coach, with how keen each is
 * likely to be on the user — and the offers and applications he has going.
 */
export function JobCentreScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const career = world.career;
  const [scope, setScope] = useState<Scope>('suitable');
  const [conf, setConf] = useState<Confederation | 'all'>('all');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'clubs' | 'national'>('clubs');

  const q = query.trim().toLowerCase();
  const rep = career.reputation;
  const rows = world.vacancies
    .map((v) => ({ v, club: world.clubs[v.clubId] }))
    .filter((r): r is { v: typeof r.v; club: Club } => r.club !== undefined && r.club.id !== world.userClubId)
    .filter(({ club }) => scope === 'all' || (club.reputation <= rep * 1.3 && club.reputation >= rep * 0.3))
    .filter(({ club }) => conf === 'all' || NATIONS[club.nation]?.confederation === conf)
    .filter(({ club }) => q === '' || club.name.toLowerCase().includes(q))
    .sort((a, b) => b.club.reputation - a.club.reputation);

  return (
    <div className="club-profile">
      <div className="comp-bar">
        <div className="comp-bar-title">
          <span className="comp-bar-name">Job Centre</span>
          <span className="faint">
            {world.vacancies.length} club{world.vacancies.length === 1 ? ' is' : 's are'} and {world.internationals?.vacancies.length ?? 0} national
            team{(world.internationals?.vacancies.length ?? 0) === 1 ? ' is' : 's are'} looking for a head coach
          </span>
        </div>
        <div className="jobs-filters">
          <Segmented options={[['clubs', 'Clubs'], ['national', 'National teams']] as const} value={kind} onChange={setKind} />
          {kind === 'clubs' && <Segmented options={[['suitable', 'Suited to you'], ['all', 'All vacancies']] as const} value={scope} onChange={setScope} />}
          <select value={conf} onChange={(e) => setConf(e.target.value as Confederation | 'all')}>
            {CONTINENTS.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
          </select>
          <span className="search-mini">
            <Icon name="search" size={14} />
            <input placeholder="Club name" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
        </div>
      </div>

      <div className="club-grid">
        {kind === 'national' ? <NationalVacancies /> : (
        <Card title={`Vacancies (${rows.length})`} icon="career" flush>
          {rows.length === 0 ? <Empty>No vacancies match — try all vacancies, or another continent.</Empty> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Club</th>
                    <th>League</th>
                    <th>Reputation</th>
                    <th className="num">Target</th>
                    <th>Vacant since</th>
                    <th>Interest</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ v, club }) => {
                    const interest = interestOf(hiringChance(world, club));
                    const league = world.competitions[club.leagueId];
                    return (
                      <tr key={club.id} className="clickable" onClick={() => g.selectClub(club.id)}>
                        <td>
                          <span className="name-cell">
                            <ClubCrest club={club} size={24} />
                            <span className="strong">{club.name}</span>
                          </span>
                        </td>
                        <td className="dim"><Flag nation={club.nation} /> {league?.name ?? `Tier ${club.tier}`}</td>
                        <td><StarMeter value={club.reputation} max={10000} size={11} /></td>
                        <td className="num dim">{ordinal(club.boardExpectation)}</td>
                        <td className="dim">{g.dateLabelForDay(v.since)}</td>
                        <td className={interest.cls}>{interest.label}</td>
                        <td className="num" onClick={(e) => e.stopPropagation()}><VacancyAction club={club} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        )}

        <div className="stack club-side">
          <Card title="Your Standing" icon="user">
            <KV k="Reputation"><StarMeter value={rep} max={10000} size={14} /></KV>
            <KV k="Status">{g.club !== null ? `Head coach of ${g.club.name}` : 'Out of work'}</KV>
            <p className="career-note">
              Clubs answer an application within a week. The bigger the club next to your name, the slimmer your chances —
              success and trophies are what make a name.
            </p>
          </Card>
          <Card title={`Job Offers (${career.offers.length})`} icon="offer"><OffersList /></Card>
          <Card title={`Applications (${career.applications.length})`} icon="contract"><ApplicationsList /></Card>
        </div>
      </div>
    </div>
  );
}

/** The national teams looking for a head coach — an offer, if one comes, arrives in the inbox. */
function NationalVacancies(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const I = world.internationals;
  const ranking = worldRanking(world);
  const rows = [...(I?.vacancies ?? [])].sort((a, b) => ranking.indexOf(a.nation) - ranking.indexOf(b.nation));
  return (
    <Card title={`National teams (${rows.length})`} icon="world" flush>
      {rows.length === 0 ? <Empty>No national team is looking for a coach right now.</Empty> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nation</th><th className="num">World rank</th><th>Next tournament</th><th>Vacant since</th><th>Interest</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const interest = interestOf(nationalHiringChance(world, v.nation));
                const next = nextTournamentFor(world, v.nation);
                const block = nationalApplicationBlock(world, v.nation);
                const applied = I?.applications.find((a) => a.nation === v.nation);
                const offered = I?.offers.some((o) => o.nation === v.nation) ?? false;
                return (
                  <tr key={v.nation}>
                    <td><span className="name-cell"><Flag nation={v.nation} /> <span className="strong">{NATIONS[v.nation]?.name}</span></span></td>
                    <td className="num">{ranking.indexOf(v.nation) + 1}</td>
                    <td className="dim">{next !== undefined ? `${next.name} · ${g.dateLabelForDay(next.startDay)}` : '—'}</td>
                    <td className="dim">{g.dateLabelForDay(v.since)}</td>
                    <td className={interest.cls}>{interest.label}</td>
                    <td className="num">
                      {offered ? <span className="good">Offer in your inbox</span>
                        : applied !== undefined ? <span className="faint">Applied · answer by {g.dateLabelForDay(applied.answerOn)}</span>
                          : <button className="sm primary" disabled={block !== null} title={block ?? undefined} onClick={() => g.applyForNationalJob(v.nation)}>Apply</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---- Out of work --------------------------------------------------------------------

/**
 * The landing page between jobs: how long it has been, the offers and
 * applications in hand, the vacancies that fit, and the career so far.
 */
export function UnemployedHome(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const career = world.career;
  const m = world.manager;
  const since = lastJobEnded(world);
  const days = Math.max(0, world.day - since);
  const rep = career.reputation;
  const lastJob = career.jobs[career.jobs.length - 1];
  const lastClub = lastJob !== undefined ? world.clubs[lastJob.clubId] : undefined;
  const suggested = world.vacancies
    .map((v) => world.clubs[v.clubId])
    .filter((c): c is Club => c !== undefined && applicationBlock(world, c.id) === null)
    .sort((a, b) => Math.abs(a.reputation - rep * 0.95) - Math.abs(b.reputation - rep * 0.95))
    .slice(0, 6);

  return (
    <div className="home">
      <section className="hm-banner">
        <div className="hm-banner-main">
          <div className="hm-kicker">Out of work · <span>{m.firstName} {m.lastName}</span></div>
          <div className="hm-teams">
            <PersonFace photoUrl={managerPhotoUrl(m)} name={`${m.firstName} ${m.lastName}`} size={54} />
            <span className="hm-team-name">Looking for a club</span>
          </div>
          <div className="hm-sub">
            Out of work since {g.dateLabelForDay(since)} · {days === 1 ? '1 day' : `${days} days`}.
            Apply for a vacancy, or keep the calendar running until a club calls.
          </div>
        </div>
        <div className="hm-banner-side">
          <span className="hm-chip">Offers <b>{career.offers.length}</b></span>
          <button className="primary" onClick={() => g.go('jobs')}><Icon name="search" size={14} /> Job Centre</button>
        </div>
      </section>

      <div className="home-row career-home-row">
        <section className="hm-card">
          <header className="hm-card-head"><h3 className="gold">Job offers</h3></header>
          <div className="hm-scroll"><OffersList /></div>
        </section>
        <section className="hm-card">
          <header className="hm-card-head">
            <h3>Vacancies for you</h3>
            <button className="hm-link" onClick={() => g.go('jobs')}>All <Icon name="arrowRight" size={13} /></button>
          </header>
          <div className="hm-scroll">
            {suggested.length === 0 ? <p className="hm-empty">No vacancies at your level right now.</p> : (
              <div className="job-list">
                {suggested.map((c) => {
                  const interest = interestOf(hiringChance(world, c));
                  return (
                    <div className="job-item" key={c.id}>
                      <ClubCrest club={c} size={30} />
                      <div className="job-item-main">
                        <strong className="player-link" onClick={() => g.selectClub(c.id)}>{c.name}</strong>
                        <span className="faint">
                          {world.competitions[c.leagueId]?.name ?? `Tier ${c.tier}`} · <span className={interest.cls}>{interest.label}</span>
                        </span>
                      </div>
                      <div className="job-item-actions"><VacancyAction club={c} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
        <section className="hm-card">
          <header className="hm-card-head"><h3>Applications</h3></header>
          <div className="hm-scroll"><ApplicationsList /></div>
        </section>
      </div>

      <div className="home-row career-home-row-2">
        <section className="hm-card">
          <header className="hm-card-head">
            <h3>Career</h3>
            <button className="hm-link" onClick={() => g.go('career')}>Profile <Icon name="arrowRight" size={13} /></button>
          </header>
          <div className="hm-scroll"><HistoryTable limit={5} /></div>
        </section>
        <section className="hm-card">
          <header className="hm-card-head"><h3>Reputation</h3></header>
          <div className="career-rep">
            <StarMeter value={rep} max={10000} size={22} />
            <b>{rep.toLocaleString()}</b>
          </div>
          <p className="career-note">
            Boards look at your name before they look at your application. Clubs around your level are the likeliest to say yes.
          </p>
          {lastClub !== undefined && (
            <KV k="Last job">
              <span className="name-cell"><ClubCrest club={lastClub} size={18} /> {lastClub.name}</span>
            </KV>
          )}
        </section>
      </div>
    </div>
  );
}
