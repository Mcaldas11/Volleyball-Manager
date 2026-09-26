import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';
import { PlayerFlag } from '../engine/model/players.ts';
import type { Position } from '../engine/model/positions.ts';
import {
  ClubCrest, clubThemeStyle, managerPhotoUrl, money, PersonFace, PlayerFace, Pos,
} from './components.tsx';
import { Icon, type IconName } from './icons.tsx';
import { PHASE_NAMES, useGame, type ScreenId } from './state.ts';
import {
  CreateManager, ClubSelect, LoadGameList, MainMenu, WorldSetup,
} from './screens/Menu.tsx';
import { ClubDetail } from './screens/ClubDetail.tsx';
import { IncomingOfferScreen } from './screens/IncomingOffer.tsx';
import { InterviewScreen } from './screens/Interview.tsx';
import { MatchdayScreen } from './screens/Matchday.tsx';
import { NegotiationScreen } from './screens/Negotiation.tsx';
import { OverviewScreen } from './screens/Overview.tsx';
import { SquadScreen, PlayerDetail, YouthScreen } from './screens/Squad.tsx';
import { LineupScreen } from './screens/Lineup.tsx';
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
  if (g.activeInterviewFixtureId !== null) return `interview-${g.activeInterviewFixtureId}`;
  if (g.selectedClub !== null) return `club-${g.selectedClub}`;
  if (g.selectedPlayer !== null) return `player-${g.selectedPlayer}`;
  return `screen-${g.screen}`;
}

/** A sidebar entry: one area of the club, split into the sub-screens shown as header tabs. */
interface Section {
  id: string;
  label: string;
  icon: IconName;
  tabs: Array<[ScreenId, string]>;
}

/** The sidebar, in groups — a thin rule separates each group, the way the
 *  real thing keeps day-to-day club work apart from the wider world. */
const SECTION_GROUPS: Section[][] = [
  [
    { id: 'home', label: 'Home', icon: 'home', tabs: [['overview', 'Inbox']] },
  ],
  [
    { id: 'squad', label: 'Squad', icon: 'squad', tabs: [['squad', 'Players'], ['youth', 'Youth Academy']] },
    {
      id: 'tactics',
      label: 'Tactics',
      icon: 'tactics',
      tabs: [['lineup', 'Team Sheet'], ['tactics', 'Instructions'], ['rotations', 'Rotations']],
    },
    { id: 'training', label: 'Training', icon: 'training', tabs: [['training', 'Development']] },
  ],
  [
    { id: 'schedule', label: 'Schedule', icon: 'schedule', tabs: [['fixtures', 'Fixtures & Results']] },
    { id: 'competitions', label: 'Competitions', icon: 'trophy', tabs: [['table', 'Standings'], ['stats', 'Player Stats']] },
  ],
  [
    { id: 'scouting', label: 'Scouting', icon: 'scouting', tabs: [['scouting', 'Player Search']] },
    { id: 'transfers', label: 'Transfers', icon: 'transfers', tabs: [['transfers', 'Transfer Centre']] },
  ],
  [
    { id: 'staff', label: 'Staff', icon: 'staff', tabs: [['staff', 'Overview']] },
    { id: 'finances', label: 'Finances', icon: 'finances', tabs: [['finances', 'Summary']] },
  ],
  [
    { id: 'world', label: 'World', icon: 'world', tabs: [['rankings', 'World Rankings'], ['halloffame', 'Hall of Fame']] },
  ],
];

const ALL_SECTIONS = SECTION_GROUPS.flat();

function sectionFor(screen: ScreenId): Section {
  return ALL_SECTIONS.find((s) => s.tabs.some(([id]) => id === screen)) ?? ALL_SECTIONS[0];
}

const SIDEBAR_KEY = 'vm.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

export function App(): JSX.Element {
  const g = useGame();

  if (g.world === null) return <MenuScreen />;
  if (g.world.userClubId < 0) return <ClubSelect />;
  return <GameShell />;
}

function GameShell(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1');
      } catch { /* per-viewer convenience only */ }
      return !c;
    });
  };

  const key = viewKey(g);
  // The inbox claims the whole content height so only its message list
  // scrolls; every other view grows with its content and scrolls the page.
  const fill = key === 'screen-overview';

  return (
    <div className={`app${collapsed ? ' sidebar-collapsed' : ''}`} style={clubThemeStyle(club)}>
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      <div className="main-col">
        <Header />
        <main className={`content${fill ? ' content-fill' : ''}`}>
          <div key={key} className="view-fade">
            {g.matchday !== null
              ? <MatchdayScreen />
              : g.negotiation !== null
                ? <NegotiationScreen />
                : g.incomingOffer !== null
                  ? <IncomingOfferScreen />
                  : g.activeInterviewFixtureId !== null
                    ? <InterviewScreen />
                    : g.selectedClub !== null
                      ? <ClubDetail />
                      : g.selectedPlayer !== null
                        ? <PlayerDetail />
                        : <Screen />}
          </div>
        </main>
      </div>
      <Toast />
      <TrophyOverlay />
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
    case 'lineup': return <LineupScreen />;
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

/** True while a full-screen flow (a match, a press conference) owns the
 *  content area — sidebar navigation would only change what's underneath. */
function inTakeover(g: ReturnType<typeof useGame>): boolean {
  return g.matchday !== null || g.activeInterviewFixtureId !== null;
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const manager = world.manager;
  const unread = world.messages.filter((m) => m.read !== true).length;
  const takeover = inTakeover(g);
  const onProfile = g.selectedClub !== null || g.selectedPlayer !== null ||
    g.negotiation !== null || g.incomingOffer !== null;
  const activeSection = onProfile ? null : sectionFor(g.screen).id;
  const clubInfoActive = g.selectedClub === club.id;

  const item = (
    key: string, label: string, icon: IconName, active: boolean, onClick: () => void, badge?: number,
  ): JSX.Element => (
    <button
      key={key}
      className={`side-item${active ? ' active' : ''}`}
      onClick={onClick}
      disabled={takeover}
      title={collapsed ? label : undefined}
    >
      <Icon name={icon} size={19} />
      <span className="side-item-label">{label}</span>
      {badge !== undefined && badge > 0 && <span className="side-badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="side-brand">
        <span className="brand-badge">VM</span>
        <span className="side-brand-text">
          <strong>Volleyball</strong>
          <span>Manager</span>
        </span>
      </div>

      <div className="side-manager" title={`${manager.firstName} ${manager.lastName}`}>
        <PersonFace photoUrl={managerPhotoUrl(manager)} name={`${manager.firstName} ${manager.lastName}`} size={34} />
        <span className="side-manager-text">
          <strong>{manager.firstName} {manager.lastName}</strong>
          <span>Manager · {club.shortName}</span>
        </span>
      </div>

      <nav className="side-nav">
        {SECTION_GROUPS.map((group, gi) => (
          <div className="side-group" key={gi}>
            {group.map((s) => item(
              s.id, s.label, s.icon, activeSection === s.id,
              () => g.go(s.tabs[0][0]),
              s.id === 'home' ? unread : undefined,
            ))}
            {gi === 4 && item('clubinfo', 'Club Info', 'club', clubInfoActive, () => g.selectClub(club.id))}
          </div>
        ))}
      </nav>

      <button className="side-collapse" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <Icon name={collapsed ? 'expand' : 'collapse'} size={18} />
        <span className="side-item-label">Collapse</span>
      </button>
    </aside>
  );
}

/** What the header names the current view, and which tabs sit beneath it. */
function headerInfo(g: ReturnType<typeof useGame>): {
  kicker: string;
  title: string;
  tabs: Array<[ScreenId, string]> | null;
} {
  const world = g.world!;
  const club = g.club!;
  if (g.matchday !== null) {
    const comp = world.competitions[g.matchday.fixture.competitionId];
    return {
      kicker: comp?.name ?? 'Match day',
      title: g.matchday.stage === 'lineup' ? 'Team Selection' : 'Live Match',
      tabs: null,
    };
  }
  if (g.negotiation !== null) return { kicker: 'Transfers', title: 'Contract Negotiation', tabs: null };
  if (g.incomingOffer !== null) return { kicker: 'Transfers', title: 'Transfer Offer', tabs: null };
  if (g.activeInterviewFixtureId !== null) return { kicker: 'Media', title: 'Press Conference', tabs: null };
  if (g.selectedClub !== null) {
    const c = world.clubs[g.selectedClub];
    return { kicker: 'Club Profile', title: c?.name ?? 'Club', tabs: null };
  }
  if (g.selectedPlayer !== null) {
    return { kicker: 'Player Profile', title: world.players.fullName(g.selectedPlayer), tabs: null };
  }
  const section = sectionFor(g.screen);
  return { kicker: club.name, title: section.label, tabs: section.tabs };
}

function Header(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const info = headerInfo(g);
  const takeover = inTakeover(g);

  return (
    <header className="hdr">
      <div className="hdr-top">
        <div className="hdr-nav">
          <button
            className="icon-btn hdr-icon-btn"
            title="Back"
            disabled={takeover || !g.canGoBack()}
            onClick={() => g.back()}
          >
            <Icon name="back" size={18} />
          </button>
          <button
            className="icon-btn hdr-icon-btn"
            title="Forward"
            disabled={takeover || !g.canGoForward()}
            onClick={() => g.forward()}
          >
            <Icon name="forward" size={18} />
          </button>
        </div>

        <div className="hdr-title">
          <ClubCrest club={club} size={38} />
          <div className="hdr-title-text">
            <span className="hdr-kicker">{info.kicker}</span>
            <h1 className="hdr-h1">{info.title}</h1>
          </div>
        </div>

        <span className="hdr-spacer" />

        <GlobalSearch disabled={takeover} />

        <div className="hdr-date" title={PHASE_NAMES[g.phase()]}>
          <span className="hdr-date-day">{g.weekdayLabelForDay(world.day)}</span>
          <span className="hdr-date-main">{g.dateLabel()}</span>
          <span className="hdr-date-phase">{PHASE_NAMES[g.phase()]}</span>
        </div>

        <div className={`hdr-balance${club.finances.balance < 0 ? ' negative' : ''}`} title="Club balance">
          <span>Balance</span>
          <strong>{money(club.finances.balance)}</strong>
        </div>

        <GameMenu />
        <ContinueButton />
      </div>

      {info.tabs !== null && (
        <nav className="hdr-tabs">
          {info.tabs.map(([id, label]) => (
            <button
              key={id}
              className={`hdr-tab${g.screen === id && g.selectedClub === null && g.selectedPlayer === null ? ' active' : ''}`}
              onClick={() => g.go(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}

/** Close a popover when the user clicks anywhere outside it or presses Escape. */
function useDismiss(open: boolean, close: () => void): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return ref;
}

/**
 * The big button in the corner: moves the calendar on. On the day of one of
 * the user's own fixtures it becomes the way into the match instead, since
 * time never skips past a fixture. The chevron beside it offers the longer
 * jumps — a week, or straight to the next match.
 */
function ContinueButton(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const next = g.nextFixture();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const matchToday = next !== null && next.day === world.day;
  const inMatch = g.matchday !== null;
  const blocked = inMatch || g.activeInterviewFixtureId !== null;

  const opponentId = next === null ? -1 : next.home === world.userClubId ? next.away : next.home;
  const opponent = world.clubs[opponentId];

  const primary = (): void => {
    if (matchToday) g.openMatchday();
    else g.advance(1);
  };

  return (
    <div className="continue" ref={ref}>
      <button className="continue-main" disabled={blocked} onClick={primary}>
        <span className="continue-label">
          {inMatch
            ? (g.matchday?.stage === 'lineup' ? 'Team selection' : 'Match in progress')
            : matchToday ? 'Match Day' : 'Continue'}
        </span>
        <Icon name={matchToday && !inMatch ? 'ball' : 'play'} size={16} />
      </button>
      <button
        className="continue-more"
        disabled={blocked}
        onClick={() => setOpen((o) => !o)}
        title="More options"
      >
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="menu-pop menu-pop-right">
          <button disabled={matchToday} onClick={() => { g.advance(1); setOpen(false); }}>
            <Icon name="forward" size={16} /> Advance one day
          </button>
          <button disabled={matchToday} onClick={() => { g.advance(7); setOpen(false); }}>
            <Icon name="fastForward" size={16} /> Advance one week
          </button>
          <div className="menu-sep" />
          <button disabled={next === null} onClick={() => { g.openMatchday(); setOpen(false); }}>
            <Icon name="ball" size={16} />
            <span className="menu-pop-stack">
              <span>{next === null ? 'No fixture scheduled' : 'Go to next match'}</span>
              {next !== null && opponent !== undefined && (
                <span className="faint">
                  {next.home === world.userClubId ? 'vs' : 'at'} {opponent.shortName} · {g.dateLabelForDay(next.day)}
                </span>
              )}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Save / exit, tucked behind one button like a game's system menu. */
function GameMenu(): JSX.Element {
  const g = useGame();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="game-menu" ref={ref}>
      <button className="icon-btn hdr-icon-btn" title="Game menu" onClick={() => setOpen((o) => !o)}>
        <Icon name="menu" size={18} />
      </button>
      {open && (
        <div className="menu-pop menu-pop-right">
          <button disabled={g.busy} onClick={() => { void g.saveCurrentGame(); setOpen(false); }}>
            <Icon name="save" size={16} /> {g.busy ? 'Saving…' : 'Save game'}
          </button>
          <button disabled={g.busy} onClick={() => { setOpen(false); void g.exitToMenu(); }}>
            <Icon name="exit" size={16} /> Save &amp; exit to menu
          </button>
        </div>
      )}
    </div>
  );
}

interface SearchResult {
  kind: 'club' | 'player';
  id: number;
}

/**
 * The header's search box: any club or player in the world by name, opened
 * straight into their profile. Results are capped and debounced so typing
 * never stalls even with a large world's full player pool behind it.
 */
function GlobalSearch({ disabled }: { disabled: boolean }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const ref = useDismiss(open, () => setOpen(false));
  const listId = useId();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 140);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo((): SearchResult[] => {
    if (debounced.length < 2) return [];
    const clubs = world.clubs
      .filter((c) => c.name.toLowerCase().includes(debounced) || c.shortName.toLowerCase() === debounced)
      .sort((a, b) => b.reputation - a.reputation)
      .slice(0, 4)
      .map((c): SearchResult => ({ kind: 'club', id: c.id }));
    const players: number[] = [];
    for (let i = 0; i < store.count; i++) {
      if (!store.isActive(i)) continue;
      if (store.hasFlag(i, PlayerFlag.Youth) && store.clubId[i] !== world.userClubId) continue;
      if (!store.fullName(i).toLowerCase().includes(debounced)) continue;
      players.push(i);
    }
    players.sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
    return [...clubs, ...players.slice(0, 8).map((p): SearchResult => ({ kind: 'player', id: p }))];
  }, [debounced, world]);

  useEffect(() => setHighlight(0), [debounced]);

  const openResult = (r: SearchResult): void => {
    if (r.kind === 'club') g.selectClub(r.id);
    else g.select(r.id);
    setQuery('');
    setDebounced('');
    setOpen(false);
  };

  return (
    <div className="search" ref={ref}>
      <Icon name="search" size={16} className="search-icon" />
      <input
        className="search-input"
        placeholder="Search players & clubs"
        value={query}
        disabled={disabled}
        aria-controls={listId}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(results.length - 1, h + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); }
          if (e.key === 'Enter' && results[highlight] !== undefined) openResult(results[highlight]);
        }}
      />
      {open && debounced.length >= 2 && (
        <div className="search-pop" id={listId} role="listbox">
          {results.length === 0 && <div className="search-empty">No players or clubs match “{query.trim()}”.</div>}
          {results.map((r, i) => {
            if (r.kind === 'club') {
              const c = world.clubs[r.id];
              return (
                <button
                  key={`c${r.id}`}
                  className={`search-row${i === highlight ? ' active' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => openResult(r)}
                >
                  <ClubCrest club={c} size={26} />
                  <span className="search-row-main">
                    <strong>{c.name}</strong>
                    <span className="faint">Club · Tier {c.tier}</span>
                  </span>
                </button>
              );
            }
            const clubId = store.clubId[r.id];
            const c = clubId >= 0 ? world.clubs[clubId] : undefined;
            return (
              <button
                key={`p${r.id}`}
                className={`search-row${i === highlight ? ' active' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => openResult(r)}
              >
                <PlayerFace playerId={store.id[r.id]} name={store.fullName(r.id)} size={26} />
                <span className="search-row-main">
                  <strong>{store.fullName(r.id)}</strong>
                  <span className="faint">{c !== undefined ? c.name : 'Free agent'}</span>
                </span>
                <Pos pos={store.position[r.id] as Position} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Notices appear as a toast in the corner and fade out by themselves. */
function Toast(): JSX.Element | null {
  const g = useGame();
  const text = g.notice;
  useEffect(() => {
    if (text === '') return;
    const t = setTimeout(() => g.dismissNotice(text), 6000);
    return () => clearTimeout(t);
  }, [text]);
  if (text === '') return null;
  return (
    <div key={text} className="toast" role="status" onClick={() => g.dismissNotice()}>
      <Icon name="news" size={17} />
      <span>{text}</span>
      <Icon name="close" size={14} className="toast-close" />
    </div>
  );
}

const CONFETTI_COLORS = ['var(--gold)', 'var(--accent)', '#ffffff', '#ffe6a3', '#9db8ff'];

/** A burst of falling confetti behind the trophy card — regenerated each
 *  time the celebration opens. */
function Confetti(): JSX.Element {
  const pieces = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: Math.random() * 1.4,
    duration: 2.6 + Math.random() * 2,
    rotate: Math.round(Math.random() * 360),
  }));
  return (
    <>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </>
  );
}

function TrophyIcon({ className }: { className?: string }): JSX.Element {
  const gradId = useId();
  return (
    <svg viewBox="0 0 64 64" className={className}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe07a" />
          <stop offset="100%" stopColor="var(--gold)" />
        </linearGradient>
      </defs>
      <path
        d="M20 8h24v13c0 8-5.4 14-12 14s-12-6-12-14V8Z"
        fill={`url(#${gradId})`} stroke="#a67c00" strokeWidth="1.5"
      />
      <path
        d="M20 12h-7a6 6 0 0 0 6 10.5"
        fill="none" stroke="#a67c00" strokeWidth="2.5" strokeLinecap="round"
      />
      <path
        d="M44 12h7a6 6 0 0 1-6 10.5"
        fill="none" stroke="#a67c00" strokeWidth="2.5" strokeLinecap="round"
      />
      <rect x="29" y="35" width="6" height="9" fill={`url(#${gradId})`} />
      <path d="M20 52h24l-2.5-6h-19L20 52Z" fill={`url(#${gradId})`} stroke="#a67c00" strokeWidth="1.5" />
      <rect x="16" y="52" width="32" height="5" rx="2" fill={`url(#${gradId})`} stroke="#a67c00" strokeWidth="1.5" />
    </svg>
  );
}

/** Pops up right after a rollover in which the user's own club was crowned
 *  champion of whatever it was playing in. */
function TrophyOverlay(): JSX.Element | null {
  const g = useGame();
  const cel = g.trophyCelebration;
  if (cel === null) return null;
  const club = g.world?.clubs[cel.clubId];

  return (
    <div className="trophy-overlay" onClick={() => g.dismissTrophyCelebration()}>
      <Confetti />
      <div className="trophy-card" onClick={(e) => e.stopPropagation()}>
        <span className="trophy-glow" />
        <TrophyIcon className="trophy-icon" />
        <span className="trophy-kicker">Champions</span>
        <h2 className="trophy-title">Champions!</h2>
        {club !== undefined && (
          <div className="trophy-club"><ClubCrest club={club} size={32} /> {club.name}</div>
        )}
        <div className="trophy-competition">{cel.competitionName}</div>
        <button className="primary" onClick={() => g.dismissTrophyCelebration()}>Continue</button>
      </div>
    </div>
  );
}
