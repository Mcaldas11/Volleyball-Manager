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

const NAV: Array<{ group: string; items: Array<[ScreenId, string]> }> = [
  {
    group: 'Club',
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

  if (g.world === null) return <MenuScreen />;
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
      <button onClick={() => g.advance(1)}>+1 day</button>
      <button onClick={() => g.advance(7)}>+1 week</button>
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

