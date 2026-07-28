import { useEffect, useState, type JSX } from 'react';
import type { ManagerProfile } from '../../engine/world/world.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { money } from '../components.tsx';
import { useGame } from '../state.ts';

const MIN_BIRTH_DATE = '1946-01-01';
const MAX_BIRTH_DATE = '2008-07-01';

export function MainMenu(): JSX.Element {
  const g = useGame();

  return (
    <div className="menu-screen">
      <h1>Volleyball Manager</h1>
      <p className="subtitle">
        A management simulation of professional indoor volleyball, built on a
        rally-by-rally match engine.
      </p>
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="toolbar">
          <button className="primary" onClick={() => g.goToMenu('createManager')}>
            New career
          </button>
          <button onClick={() => g.goToMenu('load')}>Load game</button>
        </div>
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
    <div className="menu-screen">
      <h1>Load game</h1>
      <p className="subtitle">Pick a career to continue.</p>

      {g.saves.length === 0 ? (
        <p className="faint">No saved careers yet.</p>
      ) : (
        <div className="club-list">
          <table>
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
                  <td>{s.managerName}</td>
                  <td className="dim">{s.nationCode}</td>
                  <td>{s.clubName}</td>
                  <td className="num dim">{s.inGameDate}</td>
                  <td className="num dim">{new Date(s.updatedAt).toLocaleString()}</td>
                  <td>
                    <button
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

      <div className="toolbar" style={{ marginTop: 12 }}>
        <button onClick={() => g.goToMenu('main')}>Back</button>
      </div>
    </div>
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
    <div className="menu-screen">
      <h1>Create your manager</h1>
      <p className="subtitle">
        Every career starts with you — this appears on your profile and in the
        record books.
      </p>

      <div className="panel" style={{ marginTop: 24 }}>
        <h3>Manager profile</h3>
        <div className="kv">
          <span className="k">First name</span>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={{ width: 220 }} />
        </div>
        <div className="kv" style={{ marginTop: 8 }}>
          <span className="k">Last name</span>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={{ width: 220 }} />
        </div>
        <div className="kv" style={{ marginTop: 8 }}>
          <span className="k">Date of birth</span>
          <input
            type="date"
            value={birthDate}
            min={MIN_BIRTH_DATE}
            max={MAX_BIRTH_DATE}
            onChange={(e) => setBirthDate(e.target.value)}
            style={{ width: 220 }}
          />
        </div>
        <div className="kv" style={{ marginTop: 8 }}>
          <span className="k">Gender</span>
          <select value={gender} onChange={(e) => setGender(e.target.value as 'male' | 'female')} style={{ width: 220 }}>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>
        <div className="kv" style={{ marginTop: 8 }}>
          <span className="k">Nation</span>
          <select value={nation} onChange={(e) => setNation(Number(e.target.value))} style={{ width: 220 }}>
            {NATIONS.map((n, i) => (
              <option key={n.code} value={i}>{n.name}</option>
            ))}
          </select>
        </div>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <button onClick={() => g.goToMenu('main')}>Back</button>
          <button className="primary" onClick={submit} disabled={!valid}>Continue</button>
        </div>
      </div>
    </div>
  );
}

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
    <div className="menu-screen">
      <h1>Set up the world</h1>
      <p className="subtitle">
        Choose how large a world to generate before picking a club.
      </p>

      <div className="panel" style={{ marginTop: 24 }}>
        <h3>New career</h3>
        <div className="kv">
          <span className="k">World size</span>
          <select value={scale} onChange={(e) => setScale(e.target.value as 'small')}>
            <option value="small">Small — top divisions only, fastest</option>
            <option value="standard">Standard — full pyramids in major nations</option>
            <option value="large">Large — every division worldwide (~117,000 players)</option>
          </select>
        </div>
        <div className="kv" style={{ marginTop: 8 }}>
          <span className="k">Seed</span>
          <input value={seed} onChange={(e) => setSeed(e.target.value)} style={{ width: 140 }} />
        </div>
        <p className="faint" style={{ marginTop: 10, fontSize: 12 }}>
          The same seed always produces the same world. Every player here is
          fictional and procedurally generated — see the README for importing
          real FIVB data with your own VIS credentials.
        </p>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button onClick={() => g.goToMenu('createManager')} disabled={building}>Back</button>
          <button className="primary" onClick={start} disabled={building}>
            {building ? 'Building world…' : 'Create world'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClubSelect(): JSX.Element {
  const g = useGame();
  const clubs = g.selectableClubs(80);
  const store = g.world!.players;

  return (
    <div className="menu-screen">
      <h1>Choose a club</h1>
      <p className="subtitle">
        You are the head coach, general manager and sporting director. Starting
        at a smaller club is harder and more interesting.
      </p>
      <div className="club-list">
        <table>
          <thead>
            <tr>
              <th>Club</th>
              <th>Nation</th>
              <th className="num">Tier</th>
              <th className="num">Reputation</th>
              <th className="num">Arena</th>
              <th className="num">Wage budget</th>
              <th className="num">Squad</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clubs.map((c) => {
              const avg = c.players.length > 0
                ? c.players.reduce((s, p) => s + store.currentAbility[p], 0) / c.players.length
                : 0;
              return (
                <tr key={c.id} className="clickable" onClick={() => g.takeCharge(c.id)}>
                  <td>{c.name}</td>
                  <td className="dim">{NATIONS[c.nation].name}</td>
                  <td className="num">{c.tier}</td>
                  <td className="num">{c.reputation}</td>
                  <td className="num dim">{c.arenaCapacity.toLocaleString()}</td>
                  <td className="num">{money(c.finances.wageBudget)}</td>
                  <td className="num dim">{avg.toFixed(0)}</td>
                  <td><button>Take charge</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
