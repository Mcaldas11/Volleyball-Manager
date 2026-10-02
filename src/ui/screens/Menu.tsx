import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { PlayerFlag } from '../../engine/model/players.ts';
import {
  pickSquad, secondNation, SQUAD_SIZE, worldRanking, type Tournament,
} from '../../engine/world/internationals.ts';
import type { Position } from '../../engine/model/positions.ts';
import type { Competition, ManagerProfile } from '../../engine/world/world.ts';
import { NATIONS, nationsIn, type Confederation } from '../../engine/world/nations.ts';
import {
  abilityClass, Card, ClubCrest, clubThemeStyle, Flag, FlagByCode, KV, money, PlayerFace, Pos, StarMeter,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame, type CareerMode } from '../state.ts';

const MIN_BIRTH_DATE = '1946-01-01';
const MAX_BIRTH_DATE = '2008-07-01';

/** The match ball's own colours (Mikasa V200W blue and gold), not a flat tint. */
function VolleyballIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="32" cy="32" r="27" style={{ stroke: 'var(--accent)' }} />
      <path d="M32 5 C 21 16 21 48 32 59" style={{ stroke: 'var(--gold)' }} />
      <path d="M8 22 C 24 29 40 29 56 22" style={{ stroke: 'var(--gold)' }} />
      <path d="M9 44 C 24 35 40 35 55 44" style={{ stroke: 'var(--gold)' }} />
    </svg>
  );
}

function Wordmark(): JSX.Element {
  return (
    <div className="wordmark">
      <span className="brand-badge brand-badge-lg">VM</span>
      <div className="wordmark-text">
        <span className="wordmark-top">Volleyball</span>
        <span className="wordmark-bottom">Manager</span>
      </div>
    </div>
  );
}

export function MainMenu(): JSX.Element {
  const g = useGame();

  useEffect(() => {
    void g.refreshSaves();
  }, []);

  const mostRecent = g.saves[0];

  return (
    <div className="start">
      <div className="start-panel">
        <Wordmark />
        <p className="start-tagline">Rally-by-rally management sim for professional indoor volleyball.</p>

        <nav className="start-menu">
          {mostRecent !== undefined && (
            <button className="start-item start-continue" onClick={() => { void g.loadGame(mostRecent.id); }}>
              <span className="start-item-icon"><Icon name="play" size={22} /></span>
              <span className="start-item-text">
                <span className="start-item-kicker">Continue career</span>
                <span className="start-item-title">
                  <FlagByCode code={mostRecent.clubNationCode} /> {mostRecent.clubName}
                </span>
                <span className="start-item-meta">
                  {mostRecent.managerName} · {mostRecent.inGameDate} · saved {new Date(mostRecent.updatedAt).toLocaleString()}
                </span>
              </span>
              <Icon name="chevronRight" size={20} className="start-item-chev" />
            </button>
          )}
          <button className="start-item" onClick={() => g.goToMenu('createManager')}>
            <span className="start-item-icon"><Icon name="ball" size={22} /></span>
            <span className="start-item-text">
              <span className="start-item-title">Start New Career</span>
              <span className="start-item-meta">Create a manager and take charge of a club, a national team, or both.</span>
            </span>
            <Icon name="chevronRight" size={20} className="start-item-chev" />
          </button>
          <button className="start-item" onClick={() => g.goToMenu('load')}>
            <span className="start-item-icon"><Icon name="save" size={22} /></span>
            <span className="start-item-text">
              <span className="start-item-title">Load Game</span>
              <span className="start-item-meta">
                {g.saves.length === 0
                  ? 'No saved careers yet.'
                  : `${g.saves.length} saved career${g.saves.length === 1 ? '' : 's'}.`}
              </span>
            </span>
            <Icon name="chevronRight" size={20} className="start-item-chev" />
          </button>
        </nav>

        <p className="start-footer">Free and open source, MIT licensed.</p>
      </div>

      <div className="start-hero">
        <div className="start-hero-court" />
        <VolleyballIcon className="hero-volleyball" />
        {mostRecent !== undefined && mostRecent.clubNationCode !== '' && (
          <span className="hero-flag"><FlagByCode code={mostRecent.clubNationCode} /></span>
        )}
        <div className="start-hero-caption">
          <span>Every set score is simulated</span>
          <strong>serve · pass · set · attack · block · dig</strong>
        </div>
      </div>
    </div>
  );
}

/** The new-career steps for each kind of career. */
const STEPS: Readonly<Record<CareerMode, readonly string[]>> = {
  club: ['Manager', 'World', 'Club'],
  national: ['Manager', 'World', 'National team'],
  both: ['Manager', 'World', 'Club', 'National team'],
};

/** The new-career flow's frame: the step you're on, then that step's content. */
function Wizard({
  step, title, subtitle, children, wide = false,
}: {
  step: number;
  title: string;
  subtitle: string;
  children: ReactNode;
  wide?: boolean;
}): JSX.Element {
  const g = useGame();
  return (
    <div className="wizard-page">
      <div className={`wizard${wide ? ' wizard-wide' : ''}`}>
        <div className="wizard-top">
          <Wordmark />
          {step >= 0 && (
            <ol className="wizard-steps">
              {STEPS[g.careerMode].map((s, i) => (
                <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''}>
                  <span className="wizard-step-num">{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          )}
        </div>
        <h1 className="wizard-title">{title}</h1>
        <p className="wizard-sub">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

export function LoadGameList(): JSX.Element {
  const g = useGame();

  useEffect(() => {
    void g.refreshSaves();
  }, []);

  return (
    <Wizard step={-1} title="Load Game" subtitle="Pick a career to continue.">
      <Card title="Saved Careers" icon="save" flush>
        {g.saves.length === 0 ? (
          <p className="empty" style={{ padding: 16 }}>No saved careers yet.</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: '60vh' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Manager</th>
                  <th>Nation</th>
                  <th>Club</th>
                  <th className="num">In-game date</th>
                  <th className="num">Last saved</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {g.saves.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => { void g.loadGame(s.id); }}>
                    <td className="strong">{s.managerName}</td>
                    <td className="dim"><FlagByCode code={s.nationCode} /> {s.nationCode}</td>
                    <td>{s.clubNationCode !== '' && <FlagByCode code={s.clubNationCode} />} {s.clubName}</td>
                    <td className="num dim">{s.inGameDate}</td>
                    <td className="num dim">{new Date(s.updatedAt).toLocaleString()}</td>
                    <td className="num">
                      <button
                        className="sm danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete the save for ${s.managerName}?`)) {
                            void g.deleteSave(s.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="wizard-actions">
        <button onClick={() => g.goToMenu('main')}><Icon name="back" size={14} /> Back</button>
      </div>
    </Wizard>
  );
}

export function CreateManager(): JSX.Element {
  const g = useGame();
  const existing = g.pendingManager;

  const [firstName, setFirstName] = useState(existing?.firstName ?? '');
  const [lastName, setLastName] = useState(existing?.lastName ?? '');
  const [birthDate, setBirthDate] = useState(() => {
    if (existing === null) return '1985-01-01';
    const d = new Date(Date.UTC(existing.birthYear, 0, 1));
    d.setUTCDate(d.getUTCDate() + existing.birthDay);
    return d.toISOString().slice(0, 10);
  });
  const [gender, setGender] = useState<'male' | 'female'>(existing?.gender ?? 'male');
  const [nation, setNation] = useState(existing?.nation ?? 0);

  const parsedBirth = (): { birthYear: number; birthDay: number } | null => {
    if (birthDate < MIN_BIRTH_DATE || birthDate > MAX_BIRTH_DATE) return null;
    const d = new Date(`${birthDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    const birthYear = d.getUTCFullYear();
    const birthDay = Math.round((d.getTime() - Date.UTC(birthYear, 0, 1)) / 86_400_000);
    return { birthYear, birthDay };
  };

  const birth = parsedBirth();
  const valid = firstName.trim() !== '' && lastName.trim() !== '' && birth !== null;

  const submit = (): void => {
    if (birth === null) return;
    const profile: ManagerProfile = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      birthYear: birth.birthYear,
      birthDay: birth.birthDay,
      gender,
      nation,
    };
    g.setPendingManager(profile);
  };

  return (
    <Wizard
      step={0}
      title="Create your manager"
      subtitle="Every career starts with you — this appears on your profile and in the record books."
    >
      <Card title="Manager Profile" icon="user">
        <div className="form-grid">
          <label className="form-field">
            <span>First name</span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="e.g. Ana" />
          </label>
          <label className="form-field">
            <span>Last name</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="e.g. Silva" />
          </label>
          <label className="form-field">
            <span>Date of birth</span>
            <input
              type="date"
              value={birthDate}
              min={MIN_BIRTH_DATE}
              max={MAX_BIRTH_DATE}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Gender</span>
            <select value={gender} onChange={(e) => setGender(e.target.value as 'male' | 'female')}>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>
          <label className="form-field form-field-wide">
            <span>Nation</span>
            <span className="form-inline">
              <Flag nation={nation} />
              <select value={nation} onChange={(e) => setNation(Number(e.target.value))}>
                {NATIONS.map((n, i) => (
                  <option key={n.code} value={i}>{n.name}</option>
                ))}
              </select>
            </span>
          </label>
        </div>
      </Card>

      <div className="wizard-actions">
        <button onClick={() => g.goToMenu('main')}><Icon name="back" size={14} /> Back</button>
        <button className="primary" onClick={submit} disabled={!valid}>
          Continue <Icon name="forward" size={14} />
        </button>
      </div>
    </Wizard>
  );
}

const CAREER_MODES: ReadonlyArray<{ id: CareerMode; title: string; text: string; icon: 'club' | 'world' | 'trophy' }> = [
  { id: 'club', icon: 'club', title: 'Club', text: 'Head coach, general manager and sporting director of a club.' },
  { id: 'national', icon: 'world', title: 'National team', text: 'Name the squads and coach a nation at the Nations League, the continental championships, the Worlds and the Olympics.' },
  { id: 'both', icon: 'trophy', title: 'Club & national team', text: 'Both at once: the club through the season, the nation in the summer and the spring.' },
];

const WORLD_SCALES: ReadonlyArray<{ id: 'small' | 'standard' | 'large'; title: string; text: string }> = [
  { id: 'small', title: 'Small', text: 'Top divisions only — the fastest to simulate.' },
  { id: 'standard', title: 'Standard', text: 'Full pyramids in the major nations.' },
  { id: 'large', title: 'Large', text: 'Every division worldwide (~117,000 players).' },
];

export function WorldSetup(): JSX.Element {
  const g = useGame();
  const [scale, setScale] = useState<'small' | 'standard' | 'large'>('standard');
  const [seed, setSeed] = useState('20260728');
  const [building, setBuilding] = useState(false);

  const start = (): void => {
    setBuilding(true);
    // Yield a frame so the button state paints before the world is built.
    setTimeout(() => {
      g.newGame(scale, Number(seed) || 1);
      setBuilding(false);
    }, 30);
  };

  return (
    <Wizard step={1} title="Set up the world" subtitle="Choose what you will manage and how large a world to generate.">
      <Card title="Your Career" icon="career">
        <div className="scale-options">
          {CAREER_MODES.map((m) => (
            <button
              key={m.id}
              className={`scale-option${g.careerMode === m.id ? ' active' : ''}`}
              onClick={() => g.setCareerMode(m.id)}
              disabled={building}
            >
              <span className="scale-option-title">
                <Icon name={g.careerMode === m.id ? 'check' : m.icon} size={14} /> {m.title}
              </span>
              <span className="scale-option-text">{m.text}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="World Size" icon="world" style={{ marginTop: 14 }}>
        <div className="scale-options">
          {WORLD_SCALES.map((s) => (
            <button
              key={s.id}
              className={`scale-option${scale === s.id ? ' active' : ''}`}
              onClick={() => setScale(s.id)}
              disabled={building}
            >
              <span className="scale-option-title">
                {scale === s.id && <Icon name="check" size={14} />} {s.title}
              </span>
              <span className="scale-option-text">{s.text}</span>
            </button>
          ))}
        </div>
        <label className="form-field" style={{ marginTop: 16, maxWidth: 240 }}>
          <span>Seed</span>
          <input value={seed} onChange={(e) => setSeed(e.target.value)} disabled={building} />
        </label>
        <p className="footnote">
          The same seed always produces the same world. Every player here is fictional and
          procedurally generated — see the README for importing real FIVB data with your own VIS
          credentials.
        </p>
      </Card>

      <div className="wizard-actions">
        <button onClick={() => g.goToMenu('createManager')} disabled={building}>
          <Icon name="back" size={14} /> Back
        </button>
        <button className="primary" onClick={start} disabled={building}>
          {building ? (<><span className="spinner" /> Building world…</>) : (<>Create world <Icon name="forward" size={14} /></>)}
        </button>
      </div>
    </Wizard>
  );
}

/** Continents as a manager would name them — each maps onto one of the
 *  volleyball confederations every nation already belongs to. */
const CONTINENTS: ReadonlyArray<readonly [Confederation, string]> = [
  ['CEV', 'Europe'],
  ['CSV', 'South America'],
  ['NORCECA', 'North & Central America'],
  ['AVC', 'Asia & Oceania'],
  ['CAVB', 'Africa'],
];

/** A league's name without its nation prefix — "Superliga", not "Portugal Superliga". */
function divisionName(comp: Competition): string {
  const prefix = `${NATIONS[comp.nation]?.name ?? ''} `;
  return comp.name.startsWith(prefix) ? comp.name.slice(prefix.length) : comp.name;
}

/**
 * Where the career begins. Narrowed the way every management sim does it —
 * continent, then country, then division — down to a wall of crests to pick
 * from, so any club in any league in the world can be taken over, not just
 * the famous ones.
 */
export function ClubSelect(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;

  // Every nation's domestic leagues, top flight first.
  const leaguesByNation = new Map<number, Competition[]>();
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.participants.length === 0) continue;
    const list = leaguesByNation.get(comp.nation) ?? [];
    list.push(comp);
    leaguesByNation.set(comp.nation, list);
  }
  for (const list of leaguesByNation.values()) {
    list.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }

  const nationsOf = (conf: Confederation): number[] => nationsIn(conf)
    .filter((n) => leaguesByNation.has(n))
    .sort((a, b) => NATIONS[a].name.localeCompare(NATIONS[b].name));
  const topLeagueOf = (nation: number): number => leaguesByNation.get(nation)?.[0]?.id ?? -1;

  // Open on the manager's own country when it has a league, like a real career start.
  const homeNation = leaguesByNation.has(world.manager.nation)
    ? world.manager.nation
    : nationsOf('CEV')[0] ?? 0;
  const [conf, setConf] = useState<Confederation>(NATIONS[homeNation].confederation);
  const [nation, setNation] = useState(homeNation);
  const [leagueId, setLeagueId] = useState(() => topLeagueOf(homeNation));
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<number | null>(null);

  const chooseNation = (n: number): void => {
    setNation(n);
    setLeagueId(topLeagueOf(n));
  };
  const chooseConf = (c: Confederation): void => {
    setConf(c);
    const first = nationsOf(c)[0];
    if (first !== undefined) chooseNation(first);
  };

  const q = query.trim().toLowerCase();
  const searching = q.length >= 2;
  const league = world.competitions[leagueId];
  const shown = searching
    ? world.clubs
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => b.reputation - a.reputation)
      .slice(0, 60)
    : (league?.participants ?? [])
      .map((id) => world.clubs[id])
      .filter((c) => c !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));

  const avgOf = (players: readonly number[]): number => (players.length > 0
    ? players.reduce((s, p) => s + store.currentAbility[p], 0) / players.length
    : 0);
  const club = picked !== null ? world.clubs[picked] : undefined;
  const clubLeague = club !== undefined ? world.competitions[club.leagueId] : undefined;
  const bestPlayers = club !== undefined
    ? [...club.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 5)
    : [];

  return (
    <Wizard
      step={2}
      wide
      title="Choose a club"
      subtitle={g.careerMode === 'both'
        ? 'First the club — the national team comes next. Pick a continent, a country and a division — starting at a smaller club is harder and more interesting.'
        : 'You are the head coach, general manager and sporting director. Pick a continent, a country and a division — starting at a smaller club is harder and more interesting.'}
    >
      <div className="club-select">
        <section className="card club-browser">
          <div className="club-filters">
            <label className="pick-field">
              <span className="pick-label">Continent</span>
              <span className="pick-control">
                <span className="pick-icon"><Icon name="world" size={15} /></span>
                <select value={conf} onChange={(e) => chooseConf(e.target.value as Confederation)}>
                  {CONTINENTS.filter(([c]) => nationsOf(c).length > 0).map(([c, label]) => (
                    <option key={c} value={c}>{label}</option>
                  ))}
                </select>
              </span>
            </label>
            <label className="pick-field">
              <span className="pick-label">Country</span>
              <span className="pick-control">
                <span className="pick-icon"><Flag nation={nation} /></span>
                <select value={nation} onChange={(e) => chooseNation(Number(e.target.value))}>
                  {nationsOf(conf).map((n) => <option key={n} value={n}>{NATIONS[n].name}</option>)}
                </select>
              </span>
            </label>
            <label className="pick-field pick-field-wide">
              <span className="pick-label">Division</span>
              <span className="pick-control">
                <span className="pick-icon"><Icon name="trophy" size={15} /></span>
                <select value={leagueId} onChange={(e) => setLeagueId(Number(e.target.value))}>
                  {(leaguesByNation.get(nation) ?? []).map((c) => (
                    <option key={c.id} value={c.id}>Tier {c.tier} · {divisionName(c)}</option>
                  ))}
                </select>
              </span>
            </label>
            <span className="flex-spacer" />
            <label className="pick-field">
              <span className="pick-label">Search all clubs</span>
              <span className="search-mini">
                <Icon name="search" size={14} />
                <input placeholder="Club name" value={query} onChange={(e) => setQuery(e.target.value)} />
              </span>
            </label>
          </div>

          <div className="club-browser-head">
            {searching ? (
              <span><strong>{shown.length}</strong> <span className="dim">clubs match “{query.trim()}”</span></span>
            ) : (
              <span className="club-browser-title">
                <Flag nation={nation} /> <strong>{league?.name ?? '—'}</strong>
                <span className="dim"> · {shown.length} clubs</span>
              </span>
            )}
            <span className="faint">Click to preview · double-click to take charge</span>
          </div>

          <div className="club-tiles">
            {shown.map((c) => (
              <button
                key={c.id}
                className={`club-tile${picked === c.id ? ' active' : ''}`}
                title={c.name}
                onClick={() => setPicked(c.id)}
                onDoubleClick={() => g.takeCharge(c.id)}
              >
                <ClubCrest club={c} size={54} />
                <span className="club-tile-name">{c.name}</span>
                {searching && (
                  <span className="club-tile-meta"><Flag nation={c.nation} /> Tier {c.tier}</span>
                )}
              </button>
            ))}
            {shown.length === 0 && <p className="empty">No clubs match.</p>}
          </div>

          <div className="club-browser-foot">
            {club === undefined
              ? <span className="faint">Select a club to continue.</span>
              : (
                <span className="club-browser-picked">
                  <ClubCrest club={club} size={28} />
                  <span>
                    <strong>{club.name}</strong>
                    <span className="faint"> · {clubLeague?.name ?? `Tier ${club.tier}`}</span>
                  </span>
                </span>
              )}
            <button
              className="primary lg"
              disabled={club === undefined}
              onClick={() => { if (club !== undefined) g.takeCharge(club.id); }}
            >
              Take charge <Icon name="forward" size={16} />
            </button>
          </div>
        </section>

        <Card title="Club Overview" icon="club" className="club-preview">
          {club === undefined ? <p className="empty">Select a club to see its details.</p> : (
            <div className="themed club-preview-inner" style={clubThemeStyle(club)}>
              <div className="club-preview-head">
                <ClubCrest club={club} size={64} />
                <div>
                  <strong className="club-preview-name">{club.name}</strong>
                  <span className="faint"><Flag nation={club.nation} /> {NATIONS[club.nation].name} · Tier {club.tier}</span>
                </div>
              </div>
              <KV k="League">{clubLeague !== undefined ? divisionName(clubLeague) : '—'}</KV>
              <KV k="Reputation"><StarMeter value={club.reputation} max={10000} size={13} /></KV>
              <KV k="Arena">{club.arenaName} ({club.arenaCapacity.toLocaleString()})</KV>
              <KV k="Balance" cls={club.finances.balance < 0 ? 'bad' : ''}>{money(club.finances.balance)}</KV>
              <KV k="Wage budget">{money(club.finances.wageBudget)}</KV>
              <KV k="Transfer budget">{money(club.finances.transferBudget)}</KV>
              <KV k="Squad average">
                <span className={abilityClass(avgOf(club.players))}>{avgOf(club.players).toFixed(0)}</span>
              </KV>
              <h4 className="section-label">Key players</h4>
              {bestPlayers.map((p) => (
                <div className="mini-player" key={p}>
                  <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={26} />
                  <span className="mini-player-name">{store.fullName(p)}</span>
                  <Pos pos={store.position[p] as Position} />
                  <span className={abilityClass(store.currentAbility[p])}>{store.currentAbility[p]}</span>
                </div>
              ))}
              {bestPlayers.length === 0 && <p className="empty">No players registered.</p>}
            </div>
          )}
        </Card>
      </div>
    </Wizard>
  );
}

// ---- The national team ---------------------------------------------------------------------

/** What a nation's standing in the world leads its federation to expect. */
function expectationOf(rank: number): { label: string; text: string } {
  if (rank <= 4) return { label: 'Favourites', text: 'Expected to win medals at every major.' };
  if (rank <= 10) return { label: 'Contenders', text: 'Expected to reach the knockout rounds and push for the podium.' };
  if (rank <= 20) return { label: 'Outsiders', text: 'Expected to qualify for the majors and make life hard for the big names.' };
  return { label: 'Building', text: 'A nation to build — qualifying for a major would be a success.' };
}

interface NationRow {
  nation: number;
  rank: number;
  points: number;
  /** The assistant's fourteen, and their average ability. */
  squad: number[];
  strength: number;
  pool: number;
}

/**
 * Take charge of a national team — the whole career, or the second half of
 * club and country. Every nation with a squad's worth of players, by world
 * ranking, narrowed by continent or a search; the one picked in full on the
 * right: what its federation expects, the summer and spring ahead, and the
 * players it would call.
 */
export function NationSelect(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const both = g.careerMode === 'both';

  const rows = useMemo<NationRow[]>(() => {
    // Everyone each nation could call, in one pass over the players.
    const pools = new Map<number, number[]>();
    for (let i = 0; i < store.count; i++) {
      if (!store.isActive(i) || store.hasFlag(i, PlayerFlag.Youth)) continue;
      for (const n of [store.nation[i], secondNation(world, i)]) {
        if (n < 0) continue;
        const list = pools.get(n) ?? [];
        list.push(i);
        pools.set(n, list);
      }
    }
    const ranking = worldRanking(world);
    return ranking.flatMap((nation, i): NationRow[] => {
      const pool = pools.get(nation) ?? [];
      if (pool.length < SQUAD_SIZE) return [];
      const squad = pickSquad(world, pool);
      const strength = squad.reduce((s, p) => s + store.currentAbility[p], 0) / squad.length;
      const team = world.nationalTeams.find((t) => t.nation === nation);
      return [{ nation, rank: i + 1, points: team?.rankingPoints ?? 0, squad, strength, pool: pool.length }];
    });
  }, [world]);

  const home = world.manager.nation;
  const [conf, setConf] = useState<Confederation | 'all'>('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<number | null>(() => rows.find((r) => r.nation === home)?.nation ?? rows[0]?.nation ?? null);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (conf === 'all' || NATIONS[r.nation].confederation === conf)
    && (q.length < 2 || NATIONS[r.nation].name.toLowerCase().includes(q)));
  const row = rows.find((r) => r.nation === picked);
  const tournaments = (world.internationals?.tournaments ?? []).filter((t) => t.status !== 'done');
  const playsIn = (n: number): Tournament[] => tournaments.filter((t) => t.teams.includes(n)).sort((a, b) => a.startDay - b.startDay);
  const team = row !== undefined ? world.nationalTeams.find((t) => t.nation === row.nation) : undefined;
  const steps = both ? 3 : 2;

  return (
    <Wizard
      step={steps}
      wide
      title="Choose a national team"
      subtitle={both
        ? 'Your club is set — now the country. You name the squad for every tournament and coach its matches yourself, in the summer and the spring.'
        : 'You name the squad for every tournament — the Nations League, the continental championships, the World Championship and the Olympic Games — and coach its matches yourself.'}
    >
      <div className="club-select">
        <section className="card club-browser">
          <div className="club-filters">
            <label className="pick-field">
              <span className="pick-label">Continent</span>
              <span className="pick-control">
                <span className="pick-icon"><Icon name="world" size={15} /></span>
                <select value={conf} onChange={(e) => setConf(e.target.value as Confederation | 'all')}>
                  <option value="all">The whole world</option>
                  {CONTINENTS.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
                </select>
              </span>
            </label>
            <span className="flex-spacer" />
            <label className="pick-field">
              <span className="pick-label">Search nations</span>
              <span className="search-mini">
                <Icon name="search" size={14} />
                <input placeholder="Nation" value={query} onChange={(e) => setQuery(e.target.value)} />
              </span>
            </label>
          </div>

          <div className="club-browser-head">
            <span><strong>{shown.length}</strong> <span className="dim">national teams, by world ranking</span></span>
            <span className="faint">Click to preview · double-click to take charge</span>
          </div>

          <div className="nation-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="num">#</th><th>Nation</th><th className="num">Points</th><th>Squad</th>
                  <th>Best player</th><th>This summer</th><th className="num" title="Olympic gold · World titles">Titles</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const best = [...r.squad].sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[0];
                  const summer = playsIn(r.nation).find((t) => t.kind !== 'nationsLeague');
                  const nt = world.nationalTeams.find((t) => t.nation === r.nation);
                  return (
                    <tr
                      key={r.nation}
                      className={`clickable${picked === r.nation ? ' nation-on' : ''}${r.nation === home ? ' me' : ''}`}
                      onClick={() => setPicked(r.nation)}
                      onDoubleClick={() => g.takeChargeOfNation(r.nation)}
                    >
                      <td className="num faint">{r.rank}</td>
                      <td><span className="intl-nation"><Flag nation={r.nation} /> <b>{NATIONS[r.nation].name}</b></span></td>
                      <td className="num">{r.points}</td>
                      <td>
                        <span className="nation-strength">
                          <StarMeter value={r.strength} size={12} />
                          <span className={abilityClass(r.strength)}>{Math.round(r.strength)}</span>
                        </span>
                      </td>
                      <td className="dim">{best !== undefined ? store.fullName(best) : '—'}</td>
                      <td>{summer !== undefined
                        ? <>{summer.name.replace(/ \d{4}$/, '')}{summer.host === r.nation && <span className="nation-host">Hosts</span>}</>
                        : <span className="faint">—</span>}</td>
                      <td className="num">{(nt?.olympicGolds ?? 0) + (nt?.worldTitles ?? 0) || <span className="faint">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 && <p className="empty">No nations match.</p>}
          </div>

          <div className="club-browser-foot">
            {row === undefined
              ? <span className="faint">Select a nation to continue.</span>
              : (
                <span className="club-browser-picked">
                  <Flag nation={row.nation} />
                  <span><strong>{NATIONS[row.nation].name}</strong><span className="faint"> · #{row.rank} in the world</span></span>
                </span>
              )}
            <span className="nation-foot-actions">
              {both && (
                <button className="ghost" onClick={() => g.skipNationStep()} title="Start with the club alone — national jobs are in the National Team screen later">
                  Club only
                </button>
              )}
              <button className="primary lg" disabled={row === undefined} onClick={() => { if (row !== undefined) g.takeChargeOfNation(row.nation); }}>
                Take charge <Icon name="forward" size={16} />
              </button>
            </span>
          </div>
        </section>

        <Card title="National Team" icon="world" className="club-preview">
          {row === undefined ? <p className="empty">Select a nation to see its details.</p> : (
            <div className="club-preview-inner">
              <div className="club-preview-head">
                <span className="nation-preview-flag"><Flag nation={row.nation} /></span>
                <div>
                  <strong className="club-preview-name">{NATIONS[row.nation].name}</strong>
                  <span className="faint">{CONTINENTS.find(([c]) => c === NATIONS[row.nation].confederation)?.[1]} · #{row.rank} in the world</span>
                </div>
              </div>
              <KV k="Expectation"><span className="gold">{expectationOf(row.rank).label}</span></KV>
              <p className="nation-expect faint">{expectationOf(row.rank).text}</p>
              <KV k="Ranking points">{row.points}</KV>
              <KV k="Squad strength"><StarMeter value={row.strength} size={13} /></KV>
              <KV k="Players to choose from">{row.pool}</KV>
              <KV k="Honours">
                {team === undefined ? '—' : `${team.olympicGolds} Olympic · ${team.worldTitles} World · ${team.continentalTitles ?? 0} continental`}
              </KV>
              <KV k="Coming up">
                {playsIn(row.nation).length === 0 ? <span className="faint">Not qualified for anything yet</span> : (
                  <span className="nation-coming">
                    {playsIn(row.nation).map((t) => (
                      <span key={t.id}>{t.name}{t.host === row.nation ? ' (hosts)' : ''} · {g.dateLabelForDay(t.startDay)}</span>
                    ))}
                  </span>
                )}
              </KV>
              <h4 className="section-label">Key players</h4>
              {[...row.squad].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 6).map((p) => (
                <div className="mini-player" key={p}>
                  <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={26} />
                  <span className="mini-player-name">{store.fullName(p)}</span>
                  <Pos pos={store.position[p] as Position} />
                  <span className={abilityClass(store.currentAbility[p])}>{store.currentAbility[p]}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Wizard>
  );
}
