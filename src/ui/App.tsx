import { useState, type JSX } from 'react';
import { NATIONS } from '../engine/world/nations.ts';
import { money } from './components.tsx';
import { PHASE_NAMES, useGame, type ScreenId } from './state.ts';
import { SquadScreen, PlayerDetail, YouthScreen } from './screens/Squad.tsx';
import { FixturesScreen, TableScreen } from './screens/Match.tsx';
import {
  TacticsScreen, RotationsScreen, TrainingScreen, FinancesScreen,
  StaffScreen, ScoutingScreen, TransfersScreen,
} from './screens/Manage.tsx';
import { StatsScreen, RankingsScreen, HallOfFameScreen } from './screens/World.tsx';

const NAV: Array<{ group: string; items: Array<[ScreenId, string]> }> = [
  {
    group: 'Club',
    items: [
      ['squad', 'Squad'],
      ['tactics', 'Tactics'],
      ['rotations', 'Rotations'],
      ['training', 'Training'],
      ['youth', 'Youth Academy'],
    ],
  },
  {
    group: 'Competition',
    items: [
      ['fixtures', 'Fixtures'],
      ['table', 'League Table'],
      ['stats', 'Statistics'],
    ],
  },
  {
    group: 'Management',
    items: [
      ['transfers', 'Transfers'],
      ['scouting', 'Scouting'],
      ['staff', 'Staff'],
      ['finances', 'Finances'],
    ],
  },
  {
    group: 'World',
    items: [
      ['rankings', 'World Rankings'],
      ['halloffame', 'Hall of Fame'],
    ],
  },
];

export function App(): JSX.Element {
  const g = useGame();

  if (g.world === null) return <NewGame />;
  if (g.world.userClubId < 0) return <ClubSelect />;

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <nav className="nav">
          {NAV.map((section) => (
            <div key={section.group}>
              <div className="group">{section.group}</div>
              {section.items.map(([id, label]) => (
                <button
                  key={id}
                  className={g.screen === id ? 'active' : ''}
                  onClick={() => g.go(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <main className="main">
          {g.notice !== '' && (
            <div className="notice" onClick={() => { g.notice = ''; g.touch(); }}>
              {g.notice}
            </div>
          )}
          <Screen />
          {g.selectedPlayer !== null && <PlayerDetail />}
        </main>
      </div>
    </div>
  );
}

function Screen(): JSX.Element {
  const g = useGame();
  switch (g.screen) {
    case 'squad': return <SquadScreen />;
    case 'tactics': return <TacticsScreen />;
    case 'rotations': return <RotationsScreen />;
    case 'training': return <TrainingScreen />;
    case 'youth': return <YouthScreen />;
    case 'fixtures': return <FixturesScreen />;
    case 'table': return <TableScreen />;
    case 'stats': return <StatsScreen />;
    case 'transfers': return <TransfersScreen />;
    case 'scouting': return <ScoutingScreen />;
    case 'staff': return <StaffScreen />;
    case 'finances': return <FinancesScreen />;
    case 'rankings': return <RankingsScreen />;
    case 'halloffame': return <HallOfFameScreen />;
    default: return <SquadScreen />;
  }
}

function TopBar(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const next = g.nextFixture();
  const world = g.world!;

  return (
    <header className="topbar">
      <span className="club">{club.name}</span>
      <span className="meta">
        {NATIONS[club.nation].name} · Tier {club.tier} · Rep {club.reputation}
      </span>
      <span className="spacer" />
      <span className="meta">{money(club.finances.balance)}</span>
      <span className="meta">{g.dateLabel()}</span>
      <span className="meta">{PHASE_NAMES[g.phase()]}</span>
      <button onClick={() => g.advance(1)}>+1 day</button>
      <button onClick={() => g.advance(7)}>+1 week</button>
      <button
        className="primary"
        disabled={next === null}
        onClick={() => { g.playNextMatch(); g.go('fixtures'); }}
      >
        {next === null
          ? 'No fixture'
          : `Play ${next.home === world.userClubId ? 'vs' : 'at'} ${
              world.clubs[next.home === world.userClubId ? next.away : next.home]?.shortName ?? ''
            }`}
      </button>
    </header>
  );
}

function NewGame(): JSX.Element {
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
      <h1>Volleyball Manager</h1>
      <p className="subtitle">
        A management simulation of professional indoor volleyball, built on a
        rally-by-rally match engine.
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
        <button
          className="primary"
          style={{ marginTop: 12 }}
          onClick={start}
          disabled={building}
        >
          {building ? 'Building world…' : 'Create world'}
        </button>
      </div>
    </div>
  );
}

function ClubSelect(): JSX.Element {
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
