import type { JSX } from 'react';
import { NATIONS } from '../engine/world/nations.ts';
import { ClubLink, money } from './components.tsx';
import { PHASE_NAMES, useGame, type ScreenId } from './state.ts';
import {
  CreateManager, ClubSelect, LoadGameList, MainMenu, WorldSetup,
} from './screens/Menu.tsx';
import { ClubDetail } from './screens/ClubDetail.tsx';
import { IncomingOfferScreen } from './screens/IncomingOffer.tsx';
import { MatchdayScreen } from './screens/Matchday.tsx';
import { NegotiationScreen } from './screens/Negotiation.tsx';
import { OverviewScreen } from './screens/Overview.tsx';
import { SquadScreen, PlayerDetail, YouthScreen } from './screens/Squad.tsx';
import { FixturesScreen, TableScreen } from './screens/Match.tsx';
import {
  TacticsScreen, RotationsScreen, TrainingScreen, FinancesScreen,
  StaffScreen, ScoutingScreen, TransfersScreen,
} from './screens/Manage.tsx';
import { StatsScreen, RankingsScreen, HallOfFameScreen } from './screens/World.tsx';

/** Identifies the current main-content view, so it can be keyed to replay the fade-in on change. */
function viewKey(g: ReturnType<typeof useGame>): string {
  if (g.matchday !== null) return 'matchday';
  if (g.negotiation !== null) return 'negotiation';
  if (g.incomingOffer !== null) return 'offer';
  if (g.selectedClub !== null) return `club-${g.selectedClub}`;
  if (g.selectedPlayer !== null) return `player-${g.selectedPlayer}`;
  return `screen-${g.screen}`;
}

type NavIconName = 'club' | 'competition' | 'management' | 'world';

const NAV: Array<{ group: string; icon: NavIconName; items: Array<[ScreenId, string]> }> = [
  {
    group: 'Club',
    icon: 'club',
    items: [
      ['overview', 'Overview'],
      ['squad', 'Squad'],
      ['tactics', 'Tactics'],
      ['rotations', 'Rotations'],
      ['training', 'Training'],
      ['youth', 'Youth Academy'],
    ],
  },
  {
    group: 'Competition',
    icon: 'competition',
    items: [
      ['fixtures', 'Fixtures'],
      ['table', 'League Table'],
      ['stats', 'Statistics'],
    ],
  },
  {
    group: 'Management',
    icon: 'management',
    items: [
      ['transfers', 'Transfers'],
      ['scouting', 'Scouting'],
      ['staff', 'Staff'],
      ['finances', 'Finances'],
    ],
  },
  {
    group: 'World',
    icon: 'world',
    items: [
      ['rankings', 'World Rankings'],
      ['halloffame', 'Hall of Fame'],
    ],
  },
];

/** Small monochrome line icons for the nav group headers — inherits `color` from its container. */
function NavIcon({ name }: { name: NavIconName }): JSX.Element {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'nav-icon',
  };
  switch (name) {
    case 'club':
      return (
        <svg {...common}>
          <path d="M8 3 L4 6 L6 9 L8 7.5 V20 H16 V7.5 L18 9 L20 6 L16 3 C16 4.5 14.5 5.5 12 5.5 C9.5 5.5 8 4.5 8 3 Z" />
        </svg>
      );
    case 'competition':
      return (
        <svg {...common}>
          <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
          <path d="M7 5H4a1 1 0 0 0-1 1c0 2.5 1.8 4 4 4.2" />
          <path d="M17 5h3a1 1 0 0 1 1 1c0 2.5-1.8 4-4 4.2" />
          <path d="M9 20h6M12 15v5" />
        </svg>
      );
    case 'management':
      return (
        <svg {...common}>
          <rect x="3" y="7.5" width="18" height="12" rx="1.5" />
          <path d="M8 7.5V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5" />
          <path d="M3 12.5h18" />
        </svg>
      );
    case 'world':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.4-3.8-8.5S9.5 5.9 12 3.5Z" />
        </svg>
      );
  }
}

export function App(): JSX.Element {
  const g = useGame();

  if (g.world === null) return <MenuScreen />;
  if (g.world.userClubId < 0) return <ClubSelect />;

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <nav className="nav">
          {NAV.map((section) => (
            <div key={section.group}>
              <div className="group"><NavIcon name={section.icon} /> {section.group}</div>
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
            <div key={g.notice} className="notice" onClick={() => { g.notice = ''; g.touch(); }}>
              {g.notice}
            </div>
          )}
          <div key={viewKey(g)} className="view-fade">
            {g.matchday !== null
              ? <MatchdayScreen />
              : g.negotiation !== null
                ? <NegotiationScreen />
                : g.incomingOffer !== null
                  ? <IncomingOfferScreen />
                  : g.selectedClub !== null
                    ? <ClubDetail />
                    : g.selectedPlayer !== null
                      ? <PlayerDetail />
                      : <Screen />}
          </div>
        </main>
      </div>
    </div>
  );
}

function MenuScreen(): JSX.Element {
  const g = useGame();
  switch (g.menuStage) {
    case 'main': return <MainMenu />;
    case 'load': return <LoadGameList />;
    case 'createManager': return <CreateManager />;
    case 'worldSetup': return <WorldSetup />;
    default: return <MainMenu />;
  }
}

function Screen(): JSX.Element {
  const g = useGame();
  switch (g.screen) {
    case 'overview': return <OverviewScreen />;
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
      <span className="club"><ClubLink id={club.id} /></span>
      <span className="meta">
        {NATIONS[club.nation].name} · Tier {club.tier} · Rep {club.reputation}
      </span>
      <span className="meta">{world.manager.firstName} {world.manager.lastName}</span>
      <span className="spacer" />
      <span className="meta">{money(club.finances.balance)}</span>
      <span className="meta">{g.dateLabel()}</span>
      <span className="meta">{PHASE_NAMES[g.phase()]}</span>
      <button disabled={next?.day === world.day} onClick={() => g.advance(1)}>+1 day</button>
      <button disabled={next?.day === world.day} onClick={() => g.advance(7)}>+1 week</button>
      <button
        className="primary"
        disabled={next === null}
        onClick={() => g.openMatchday()}
      >
        {next === null
          ? 'No fixture'
          : `Play ${next.home === world.userClubId ? 'vs' : 'at'} ${
              world.clubs[next.home === world.userClubId ? next.away : next.home]?.shortName ?? ''
            }`}
      </button>
      <button onClick={() => { void g.saveCurrentGame(); }} disabled={g.busy}>
        {g.busy ? 'Saving…' : 'Save'}
      </button>
      <button onClick={() => { void g.exitToMenu(); }} disabled={g.busy}>
        Save &amp; Exit
      </button>
    </header>
  );
}

