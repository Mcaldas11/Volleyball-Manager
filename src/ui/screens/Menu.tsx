import { useEffect, useState, type JSX, type ReactNode } from 'react';
import type { Position } from '../../engine/model/positions.ts';
import type { ManagerProfile } from '../../engine/world/world.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import {
  abilityClass, Card, ClubCrest, clubThemeStyle, Flag, FlagByCode, KV, money, PlayerFace, Pos, StarMeter,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

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
              <span className="start-item-meta">Create a manager and take charge of a club.</span>
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

const STEPS = ['Manager', 'World', 'Club'] as const;

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
  return (
    <div className="wizard-page">
      <div className={`wizard${wide ? ' wizard-wide' : ''}`}>
        <div className="wizard-top">
          <Wordmark />
          {step >= 0 && (
            <ol className="wizard-steps">
              {STEPS.map((s, i) => (
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
    <Wizard step={1} title="Set up the world" subtitle="Choose how large a world to generate before picking a club.">
      <Card title="World Size" icon="world">
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

export function ClubSelect(): JSX.Element {
  const g = useGame();
  const clubs = g.selectableClubs(80);
  const store = g.world!.players;
  const [query, setQuery] = useState('');
  const [nationFilter, setNationFilter] = useState(-1);
  const [picked, setPicked] = useState<number | null>(clubs[0]?.id ?? null);

  const nations = [...new Set(clubs.map((c) => c.nation))]
    .sort((a, b) => NATIONS[a].name.localeCompare(NATIONS[b].name));
  const q = query.trim().toLowerCase();
  const shown = clubs.filter((c) =>
    (nationFilter < 0 || c.nation === nationFilter) &&
    (q === '' || c.name.toLowerCase().includes(q)));
  const avgOf = (players: readonly number[]): number => (players.length > 0
    ? players.reduce((s, p) => s + store.currentAbility[p], 0) / players.length
    : 0);
  const club = picked !== null ? g.world!.clubs[picked] : undefined;
  const bestPlayers = club !== undefined
    ? [...club.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 5)
    : [];

  return (
    <Wizard
      step={2}
      wide
      title="Choose a club"
      subtitle="You are the head coach, general manager and sporting director. Starting at a smaller club is harder and more interesting."
    >
      <div className="club-select">
        <Card
          title="Clubs"
          icon="club"
          flush
          actions={(
            <div className="toolbar-inline">
              <span className="search-mini">
                <Icon name="search" size={14} />
                <input placeholder="Search clubs" value={query} onChange={(e) => setQuery(e.target.value)} />
              </span>
              <select value={nationFilter} onChange={(e) => setNationFilter(Number(e.target.value))}>
                <option value={-1}>All nations</option>
                {nations.map((n) => <option key={n} value={n}>{NATIONS[n].name}</option>)}
              </select>
            </div>
          )}
        >
          <div className="table-wrap club-select-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Club</th>
                  <th>Nation</th>
                  <th className="num">Tier</th>
                  <th>Reputation</th>
                  <th className="num">Arena</th>
                  <th className="num">Wage budget</th>
                  <th className="num">Avg ability</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const avg = avgOf(c.players);
                  return (
                    <tr
                      key={c.id}
                      className={`clickable${picked === c.id ? ' selected' : ''}`}
                      onClick={() => setPicked(c.id)}
                      onDoubleClick={() => g.takeCharge(c.id)}
                    >
                      <td className="strong"><ClubCrest club={c} size={20} /> {c.name}</td>
                      <td className="dim"><Flag nation={c.nation} /> {NATIONS[c.nation].name}</td>
                      <td className="num">{c.tier}</td>
                      <td><StarMeter value={c.reputation} max={10000} size={11} /></td>
                      <td className="num dim">{c.arenaCapacity.toLocaleString()}</td>
                      <td className="num">{money(c.finances.wageBudget)}</td>
                      <td className={`num ${abilityClass(avg)}`}>{avg.toFixed(0)}</td>
                      <td className="num">
                        <button className="sm" onClick={(e) => { e.stopPropagation(); g.takeCharge(c.id); }}>
                          Take charge
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={8}><p className="empty">No clubs match.</p></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

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
              <button className="primary block lg" onClick={() => g.takeCharge(club.id)}>
                Take charge of {club.shortName} <Icon name="forward" size={16} />
              </button>
            </div>
          )}
        </Card>
      </div>
    </Wizard>
  );
}
