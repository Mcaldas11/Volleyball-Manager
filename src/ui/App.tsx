import { openPortraits } from './portraits.ts';
import { DiagnosisScreen, PrepLabScreen } from './screens/TacticalLab.tsx';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import { StaffRole } from '../engine/model/staff.ts';
import logo from './logo.png';
import { Splash, splashDue } from './splash.tsx';
import { EditorScreen } from './screens/Editor.tsx';
import { PreferencesDialog } from './settingsDialog.tsx';
import { FpsCounter } from './fpsCounter.tsx';
import { ErrorScreen } from './errorScreen.tsx';
import { AchievementsScreen, CoursesScreen } from './screens/Milestones.tsx';
import { InternationalsScreen } from './screens/Internationals.tsx';
import { PlayerFlag } from '../engine/model/players.ts';
import type { Position } from '../engine/model/positions.ts';
import {
  ClubCrest, clubThemeStyle, Flag, initials, managerPhotoUrl, PersonFace, PlayerFace, Pos, useDismiss, WorkspaceHeading,
} from './components.tsx';
import { NATIONS } from '../engine/world/nations.ts';
import { baseNation, sideCode, sideName } from '../engine/world/sides.ts';
import { userNation, worldRanking } from '../engine/world/internationals.ts';
import { Icon, type IconName } from './icons.tsx';
import { FullscreenButton, useFullscreenKey } from './fullscreen.tsx';
import { useBackNavigation } from './backNav.ts';
import { HolidayDialog } from './holiday.tsx';
import { FriendlyDialog } from './friendlyDialog.tsx';
import { CupsDialog } from './cupsDialog.tsx';
import { ReplayViewer } from './replay.tsx';
import { TacticPicker } from './tacticPicker.tsx';
import { ProcessingWindow } from './processing.tsx';
import { TaskWindow } from './taskWindow.tsx';
import { CLUBLESS_SCREENS, NATIONAL_TEAM_SCREENS, PHASE_NAMES, useGame, type ScreenId } from './state.ts';
import { NationalSquadScreen } from './screens/National.tsx';
import {
  CreateLook, CreateManager, ClubSelect, LoadGameList, MainMenu, NationSelect, WorldSetup,
} from './screens/Menu.tsx';
import { CalendarScreen } from './screens/Calendar.tsx';
import { CareerScreen, JobCentreScreen } from './screens/Career.tsx';
import { CoachTalkScreen } from './screens/CoachTalk.tsx';
import { PlayerTalkScreen } from './screens/PlayerTalk.tsx';
import { AnalysisScreen } from './screens/Analysis.tsx';
import { ClubDetail } from './screens/ClubDetail.tsx';
import { CoachProfile } from './screens/CoachProfile.tsx';
import { TrainingScreen } from './screens/Training.tsx';
import { NationProfile } from './screens/NationProfile.tsx';
import { CompetitionDetail, CompetitionsScreen } from './screens/Competitions.tsx';
import { NewsScreen } from './screens/News.tsx';
import { HomeScreen } from './screens/Home.tsx';
import { InboxScreen } from './screens/Inbox.tsx';
import { IncomingOfferScreen } from './screens/IncomingOffer.tsx';
import { InterviewScreen } from './screens/Interview.tsx';
import { MatchdayScreen } from './screens/Matchday.tsx';
import { MatchResultScreen } from './screens/MatchResult.tsx';
import { NegotiationScreen } from './screens/Negotiation.tsx';
import { StaffNegotiationScreen } from './screens/StaffNegotiation.tsx';
import { DressingRoomScreen } from './screens/DressingRoom.tsx';
import { SquadPlannerScreen } from './screens/SquadPlanner.tsx';
import { DirectorScreen, MissionsScreen, ShortlistScreen } from './screens/Recruitment.tsx';
import { DeadlineDayScreen } from './screens/DeadlineDay.tsx';
import { StaffMeetingScreen } from './staffMeeting.tsx';
import { CoachesScreen, DataHubScreen, DraftScreen, SocialScreen } from './screens/Insights.tsx';
import { HelpDialog } from './help.tsx';
import { TutorialOverlay } from './tutorial.tsx';
import { AffiliatesScreen, OwnerScreen, CommercialScreen, FacilitiesScreen } from './screens/ClubBusiness.tsx';
import { SquadScreen, PlayerDetail, YouthScreen } from './screens/Squad.tsx';
import { LineupScreen } from './screens/Lineup.tsx';
import { FixturesScreen, TableScreen } from './screens/Match.tsx';
import { WatchBar, WatchMatchItem } from './watchLive.tsx';
import {
  TacticsScreen, RotationsScreen, FinancesScreen,
  ScoutingScreen, TransfersScreen,
} from './screens/Manage.tsx';
import { StaffScreen } from './screens/Staff.tsx';
import { StatsScreen, RankingsScreen, HallOfFameScreen } from './screens/World.tsx';
import { SeasonReviewScreen } from './seasonReview.tsx';

/** Identifies the current main-content view, so it can be keyed to replay the fade-in on change. */
function viewKey(g: ReturnType<typeof useGame>): string {
  if (g.matchday !== null) return 'matchday';
  if (g.activeInterviewId !== null) return `interview-${g.activeInterviewId}`;
  if (g.postMatch !== null) return `result-${g.postMatch}`;
  if (g.negotiation !== null) return 'negotiation';
  if (g.staffNegotiation !== null) return 'staff-negotiation';
  if (g.incomingOffer !== null) return 'offer';
  if (g.coachTalk !== null) return 'coach-talk';
  if (g.playerTalk !== null) return 'player-talk';
  if (g.selectedClub !== null) return `club-${g.selectedClub}`;
  if (g.selectedPlayer !== null) return `player-${g.selectedPlayer}`;
  if (g.selectedReview !== null) return `review-${g.selectedReview}`;
  if (g.selectedCompetition !== null) return `competition-${g.selectedCompetition}`;
  return `screen-${g.screen}`;
}

/** A sidebar entry: one area of the club, split into the sub-screens shown as header tabs. */
interface Section {
  id: string;
  label: string;
  icon: IconName;
  tabs: Array<[ScreenId, string]>;
}

/** The top bar's menus, as in the follower's build: each a section, its tabs in its dropdown. */
const SECTION_GROUPS: Array<{ label: string; sections: Section[] }> = [
  {
    label: 'Management',
    sections: [
      {
        id: 'home', label: 'Portal', icon: 'home',
        tabs: [['home', 'Overview'], ['inbox', 'Inbox'], ['calendar', 'Calendar'], ['news', 'World News'], ['social', 'Social'],
          ['career', 'Career'], ['achievements', 'Achievements'], ['courses', 'Courses'], ['jobs', 'Job Centre']],
      },
      { id: 'squad', label: 'Squad', icon: 'squad', tabs: [['squad', 'First team'], ['youth', 'Youth Academy'], ['planner', 'Squad Planner'], ['dressing', 'Dressing Room']] },
      {
        id: 'lineup', label: 'Tactics', icon: 'tactics',
        tabs: [['lineup', 'Team Sheet'], ['tactics', 'Instructions'], ['rotations', 'Rotations'], ['analysis', 'Analysis'],
          ['diagnosis', 'Tactical Diagnosis'], ['preplab', 'Prep Lab'], ['datahub', 'Data Hub']],
      },
      {
        id: 'competitions', label: 'Competitions', icon: 'trophy',
        tabs: [['competitions', 'Overview'], ['table', 'League Table'], ['fixtures', 'Fixtures & Results'], ['internationals', 'International'],
          ['stats', 'Player Stats'], ['rankings', 'World Rankings'], ['coaches', 'Coaches'], ['halloffame', 'Hall of Fame']],
      },
      {
        id: 'scouting', label: 'Recruitment', icon: 'scouting',
        tabs: [['scouting', 'Player Search'], ['shortlist', 'Shortlist'], ['missions', 'Scout Missions'], ['transfers', 'Transfer Centre'],
          ['deadline', 'Deadline Day'], ['director', 'Director & Delegation']],
      },
      { id: 'training', label: 'Training', icon: 'training', tabs: [['training', 'Training']] },
      {
        id: 'finances', label: 'Club', icon: 'club',
        tabs: [['finances', 'Finances'], ['commercial', 'Tickets & Sponsors'], ['facilities', 'Facilities'], ['staff', 'Staff'],
          ['meeting', 'Staff Meeting'], ['affiliates', 'Affiliates'], ['owner', 'Owner'], ['editor', 'Editor']],
      },
    ],
  },
];

const ALL_SECTIONS = SECTION_GROUPS.flatMap((grp) => grp.sections);

/** The team's sections — a national team has its squad and its team sheet, but no training ground or academy. */
const TEAM_SECTIONS: ReadonlySet<string> = new Set(['squad', 'lineup', 'training']);

function sectionFor(screen: ScreenId): Section {
  return ALL_SECTIONS.find((s) => s.tabs.some(([id]) => id === screen)) ?? ALL_SECTIONS[0];
}

/** A section as it stands for the manager now: out of work, only the tabs
 *  that need no club are left — and a section with none left goes. */
function availableTabs(section: Section, hasClub: boolean, national = false): Array<[ScreenId, string]> {
  if (national && TEAM_SECTIONS.has(section.id)) return section.tabs.filter(([id]) => NATIONAL_TEAM_SCREENS.has(id));
  return hasClub ? section.tabs : section.tabs.filter(([id]) => CLUBLESS_SCREENS.has(id));
}

export function App(): JSX.Element {
  const g = useGame();
  useFullscreenKey();
  // The browser's Back, a mouse's side buttons and Alt+arrows: through the game's own history.
  useBackNavigation(g);
  // The open career's own portraits, loaded as it opens.
  useEffect(() => { void openPortraits(g.world !== null ? g.currentSaveId : null); }, [g.currentSaveId, g.world]);
  // As the game opens, before the menu: the splash.
  const [splash, setSplash] = useState(() => g.world === null && splashDue());
  return (
    <>
      <ErrorScreen><AppBody /></ErrorScreen>
      <TaskWindow />
      {g.settingsOpen && <PreferencesDialog />}
      {g.prefs.showFps && <FpsCounter />}
      {splash && <Splash onDone={() => setSplash(false)} />}
    </>
  );
}

function AppBody(): JSX.Element {
  const g = useGame();

  if (g.world === null) return <MenuScreen />;
  // A career still to begin picks its club, its nation or both; one between jobs carries on.
  const step = g.setupStep();
  if (step === 'club') return <ClubSelect />;
  if (step === 'nation') return <NationSelect />;
  return <GameShell />;
}


function GameShell(): JSX.Element {
  const g = useGame();
  const club = g.club;
  const key = viewKey(g);
  // Match day — team selection and the live match — is laid out to the
  // window and takes the sidebar's width too: nothing in it can be used
  // until the match is over anyway.
  const live = g.matchday !== null;
  // Once the ball is in play, the match is the whole window: no menus over it.
  const inPlay = g.matchday?.stage === 'live';
  const contentClass = live ? ' content-live' : ' content-fill';
  // In the women's game the screens speak of the players as women — not of the
  // coaches, the staff, the owner or the manager's own career: those keep theirs.
  const onAProfile = g.selectedPlayer !== null || g.selectedClub !== null || g.selectedReview !== null || g.selectedCompetition !== null ||
    g.selectedNation !== null || g.negotiation !== null || g.incomingOffer !== null || g.playerTalk !== null;
  const keepPronouns = g.selectedCoach !== null || g.staffNegotiation !== null || g.coachTalk !== null ||
    (!onAProfile && ['staff', 'career', 'jobs', 'owner', 'achievements', 'courses'].includes(g.screen));

  return (
    <div className={`app vm-shell vm-topnav${live ? ' vm-match-live' : ''}${inPlay ? ' vm-match-play' : ''}`} style={club !== null ? clubThemeStyle(club) : undefined}>
      <div className="main-col">
        {!inPlay && <Header />}
        <main className={`content${contentClass}`} data-pronouns={keepPronouns ? 'keep' : undefined}>
          <div key={key} className="view-fade">
            {g.matchday !== null
              ? <MatchdayScreen />
              : g.activeInterviewId !== null
                ? <InterviewScreen />
              : g.postMatch !== null
                ? <MatchResultScreen />
                : g.negotiation !== null
                  ? <NegotiationScreen />
                  : g.staffNegotiation !== null
                    ? <StaffNegotiationScreen />
                  : g.incomingOffer !== null
                    ? <IncomingOfferScreen />
                    : g.coachTalk !== null
                    ? <CoachTalkScreen />
                    : g.playerTalk !== null
                    ? <PlayerTalkScreen />
                      : g.selectedNation !== null
                        ? <NationProfile />
                      : g.selectedCoach !== null
                        ? <CoachProfile />
                      : g.selectedClub !== null
                        ? <ClubDetail />
                        : g.selectedPlayer !== null
                          ? <PlayerDetail />
                          : g.selectedReview !== null
                            ? <SeasonReviewScreen />
                            : g.selectedCompetition !== null
                              ? <CompetitionDetail />
                              : <><ScreenHeading /><Screen /></>}
          </div>
        </main>
      </div>
      <Toast />
      <TrophyOverlay />
      <HolidayDialog />
      <FriendlyDialog />
      <CupsDialog />
      <ReplayViewer />
      <ProcessingWindow />
      <HelpDialog />
      <TutorialOverlay />
    </div>
  );
}

/** The screens whose heading the shell draws: eyebrow, line, sentence, and a way on to another screen. */
const SCREEN_HEADINGS: Partial<Record<ScreenId, [eyebrow: string, title: string, description?: string, next?: ScreenId, nextLabel?: string]>> = {
  tactics: ['Tactics', 'Give your team a clear direction.', 'Build your identity in attack, serve and defence.', 'lineup', 'Team Sheet'],
  diagnosis: ['Analysis', 'A second pair of eyes.', 'Your assistant, the evidence and the next adjustment.', 'preplab', 'Prep Lab'],
  preplab: ['Analysis', 'Prepare before the first serve.', 'Compare tactical plans against your next opponent.', 'lineup', 'Team Sheet'],
  analysis: ['PERFORMANCE ANALYSIS', 'Read the patterns. Find the advantage.', 'Match by match, rotation by rotation, lane by lane.', 'diagnosis', 'Tactical Diagnosis'],
  datahub: ['PERFORMANCE INTELLIGENCE', 'See where your team stands. Find the next improvement.', undefined, 'analysis', 'Analysis'],
  scouting: ['Recruitment', 'Find your next difference maker.', 'Search, evaluate and compare before making your move.', 'shortlist', 'Shortlist'],
  transfers: ['Recruitment', 'Build the next chapter.', 'Every arrival and departure, under control.', 'scouting', 'Player Search'],
  shortlist: ['Recruitment', 'Talent worth following.', 'Keep your recruitment priorities within reach.', 'missions', 'Scout Missions'],
  missions: ['Recruitment', 'Give your scouts a direction.', 'Turn your squad needs into a recruitment plan.', 'scouting', 'Player Search'],
  director: ['Recruitment', 'A shared sporting vision.', 'Set responsibilities and keep control of recruitment.', 'staff', 'Staff'],
  career: ['Career', 'Your story on the touchline.', 'Experience, reputation and the next opportunity.', 'achievements', 'Achievements'],
  achievements: ['Your legacy', 'The milestones that tell your story.', undefined, 'courses', 'Courses'],
  courses: ['The learning never stops', 'Become the coach you want to be.', undefined, 'career', 'Career'],
  jobs: ['Your next opportunity', 'Find a challenge that fits your ambition.', undefined, 'career', 'Career'],
  staff: ['Staff', 'Expertise makes the difference.', undefined, 'meeting', 'Staff Meeting'],
  meeting: ['Staff meeting', 'Good decisions start with your team.', undefined, 'staff', 'Staff'],
  commercial: ['Club', 'A club people believe in.', 'Shape the matchday experience and build lasting partnerships.', 'finances', 'Finances'],
  facilities: ['Club', 'Build the foundations of success.', 'Your arena, your facilities and the next investment.', 'finances', 'Finances'],
  affiliates: ['Club partnerships', 'A wider path to the first team.', undefined, 'youth', 'Youth Academy'],
  owner: ['Club', 'One club. A shared ambition.', 'Expectations, trust and the decisions that shape the club.', 'finances', 'Finances'],
  news: ['Beyond the touchline', 'The volleyball journal.', undefined, 'social', 'Social'],
  social: ['AROUND THE GAME', 'The conversation.', undefined, 'news', 'World News'],
  competitions: ['THE SEASON AHEAD', 'Every competition. Every step towards the next trophy.', undefined, 'fixtures', 'Fixtures & Results'],
  table: ['Competitions', 'Where every point counts.', undefined, 'fixtures', 'Fixtures & Results'],
  fixtures: ['MATCH CENTRE', 'Every match, every set.', undefined, 'table', 'League Table'],
  internationals: ['THE WORLD STAGE', 'National pride. Global ambition.', 'Follow the tournaments, the next generation and the race for gold.', 'rankings', 'World Rankings'],
  stats: ['Stats', 'The numbers behind the season.', undefined, 'rankings', 'World Rankings'],
  rankings: ['Stats', 'The standard to aim for.', 'Explore the leading clubs and players.', 'stats', 'Player Stats'],
  coaches: ['THE PEOPLE BEHIND THE TEAMS', 'Coaching excellence.', undefined, 'halloffame', 'Hall of Fame'],
  halloffame: ['THE GAME REMEMBERS', 'A place among the greats.', 'Outstanding careers, preserved for every generation.', 'stats', 'Player Stats'],
  dressing: ['DRESSING ROOM', 'A team beyond the court.', 'Understand the leaders, the relationships and the mood of your squad.', 'squad', 'First team'],
  planner: ['SQUAD PLANNING', 'Build the next three seasons.', 'Anticipate departures. Make room for the next generation.', 'scouting', 'Player search'],
  deadline: ['Recruitment', 'The last hours of the window.', undefined, 'transfers', 'Transfer Centre'],
  editor: ['CAREER STUDIO', 'Make this world your own.', 'Clubs, players and colours, all in one place.'],
};

function ScreenHeading(): JSX.Element | null {
  const g = useGame();
  const h = SCREEN_HEADINGS[g.screen];
  if (h === undefined) return null;
  // Out of work, a heading that leads to a club's screen would lead nowhere.
  const [eyebrow, title, description, next, nextLabel] = h;
  // A heading never leads where the team on show has no screen: out of work, or the national team's club-only tools.
  const clubOnly = g.nationalView() && next !== undefined && ['diagnosis', 'preplab', 'datahub', 'training', 'youth'].includes(next);
  const canGo = next !== undefined && !clubOnly && (g.club !== null || CLUBLESS_SCREENS.has(next));
  return (
    <div className="vm-workspace-heading">
      <WorkspaceHeading
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={canGo ? <button onClick={() => g.go(next)}>{nextLabel} <Icon name="arrowRight" size={14} /></button> : undefined}
      />
    </div>
  );
}

function MenuScreen(): JSX.Element {
  const g = useGame();
  switch (g.menuStage) {
    case 'main': return <MainMenu />;
    case 'load': return <LoadGameList />;
    case 'createManager': return <CreateManager />;
    case 'managerLook': return <CreateLook />;
    case 'worldSetup': return <WorldSetup />;
    default: return <MainMenu />;
  }
}

function Screen(): JSX.Element {
  const g = useGame();
  // Out of work, anything about the club is gone with it — but a national team has a squad and a team sheet too.
  const nationalTeamScreen = g.nationalView() && NATIONAL_TEAM_SCREENS.has(g.screen);
  // A created club's draft comes before anything else.
  if (g.world?.draft !== undefined) return <DraftScreen />;
  if (g.club === null && !CLUBLESS_SCREENS.has(g.screen) && !nationalTeamScreen) return <HomeScreen />;
  switch (g.screen) {
    case 'datahub': return <DataHubScreen />;
    case 'diagnosis': return <DiagnosisScreen />;
    case 'preplab': return <PrepLabScreen />;
    case 'social': return <SocialScreen />;
    case 'coaches': return <CoachesScreen />;
    case 'home': return <HomeScreen />;
    case 'inbox': return <InboxScreen />;
    case 'career': return <CareerScreen />;
    case 'jobs': return <JobCentreScreen />;
    case 'calendar': return <CalendarScreen />;
    case 'news': return <NewsScreen />;
    case 'competitions': return <CompetitionsScreen />;
    case 'squad': return g.nationalView() ? <NationalSquadScreen /> : <SquadScreen />;
    case 'lineup': return <LineupScreen />;
    case 'tactics': return <TacticsScreen />;
    case 'rotations': return <RotationsScreen />;
    case 'training': return <TrainingScreen />;
    case 'youth': return <YouthScreen />;
    case 'fixtures': return <FixturesScreen />;
    case 'table': return <TableScreen />;
    case 'internationals': return <InternationalsScreen />;
    case 'stats': return <StatsScreen />;
    case 'transfers': return <TransfersScreen />;
    case 'scouting': return <ScoutingScreen />;
    case 'staff': return <StaffScreen />;
    case 'finances': return <FinancesScreen />;
    case 'dressing': return <DressingRoomScreen />;
    case 'planner': return <SquadPlannerScreen />;
    case 'shortlist': return <ShortlistScreen />;
    case 'missions': return <MissionsScreen />;
    case 'deadline': return <DeadlineDayScreen />;
    case 'director': return <DirectorScreen />;
    case 'meeting': return <StaffMeetingScreen />;
    case 'analysis': return <AnalysisScreen />;
    case 'commercial': return <CommercialScreen />;
    case 'facilities': return <FacilitiesScreen />;
    case 'affiliates': return <AffiliatesScreen />;
    case 'owner': return <OwnerScreen />;
    case 'achievements': return <AchievementsScreen />;
    case 'courses': return <CoursesScreen />;
    case 'editor': return <EditorScreen />;
    case 'rankings': return <RankingsScreen />;
    case 'halloffame': return <HallOfFameScreen />;
    default: return <HomeScreen />;
  }
}

/** True while a full-screen flow (a match, its result, a press conference)
 *  owns the content area — sidebar navigation would only change what's underneath. */
function inTakeover(g: ReturnType<typeof useGame>): boolean {
  return g.matchday !== null || g.activeInterviewId !== null || g.postMatch !== null;
}

/** With a club and a country: which of the two the team screens are about. */
function TeamSwitch({ disabled }: { disabled: boolean }): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const club = g.club;
  const nation = userNation(world);
  if (club === null || nation < 0) return null;
  const national = g.nationalView();
  return (
    <div className="side-team-switch">
      <button className={national ? '' : 'on'} disabled={disabled} onClick={() => g.setTeamView('club')} title={`${club.name} — squad, team sheet and instructions`}>
        <ClubCrest club={club} size={16} /><span>{club.shortName}</span>
      </button>
      <button className={national ? 'on' : ''} disabled={disabled} onClick={() => g.setTeamView('national')} title={`${sideName(nation)} national team — its own squad, team sheet and instructions`}>
        <Flag nation={nation} /><span>{sideCode(nation)}</span>
      </button>
    </div>
  );
}

/** The manager at the foot of the sidebar — and behind him the game's
 *  system menu: save, or save and leave. */
function ManagerMenu({ name, photo, offers = 0 }: { name: string; photo: string; offers?: number }): JSX.Element {
  const g = useGame();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="side-manager" ref={ref}>
      <button className="side-manager-btn" onClick={() => setOpen((o) => !o)} title={name}>
        <PersonFace photoUrl={photo} name={name} size={28} />
        <span className="side-item-label">{name}</span>
        <Icon name="chevronDown" size={14} className="side-manager-caret" />
        {offers > 0 && <span className="vm-count">{offers}</span>}
      </button>
      {open && (
        <div className="menu-pop menu-pop-up">
          <button disabled={inTakeover(g)} onClick={() => { setOpen(false); g.go('career'); }}>
            <Icon name="career" size={16} /> Career &amp; jobs
            {offers > 0 && <span className="menu-pop-note">{offers} offer{offers === 1 ? '' : 's'}</span>}
          </button>
          <button disabled={g.busy} onClick={() => { void g.saveCurrentGame(); setOpen(false); }}>
            <Icon name="save" size={16} /> {g.busy ? 'Saving…' : 'Save game'}
          </button>
          <button disabled={g.busy} onClick={() => { void g.exportCurrentCareer(); setOpen(false); }}
            title="Download the career as a file — a copy outside the browser">
            <Icon name="download" size={16} /> Export career file
          </button>
          <button onClick={() => { setOpen(false); g.openSettings(); }}>
            <Icon name="gear" size={16} /> Preferences
          </button>
          <button disabled={g.busy} onClick={() => { setOpen(false); void g.exitToMenu(); }}>
            <Icon name="exit" size={16} /> Save &amp; exit to menu
          </button>
        </div>
      )}
    </div>
  );
}

/** What the header names the current view, and which tabs sit beneath it. */
function headerInfo(g: ReturnType<typeof useGame>): {
  title: string;
  tabs: Array<[ScreenId, string]> | null;
} {
  const world = g.world!;
  if (g.matchday !== null) {
    const stage = g.matchday.stage;
    return { title: stage === 'lineup' ? 'Team Selection' : stage === 'setBreak' ? 'Set Break' : 'Live Match', tabs: null };
  }
  if (g.activeInterviewId !== null) return { title: 'Press Conference', tabs: null };
  if (g.postMatch !== null) return { title: 'Full Time', tabs: null };
  if (g.negotiation !== null) return { title: 'Contract Negotiation', tabs: null };
  if (g.staffNegotiation !== null) return { title: 'Staff Negotiation', tabs: null };
  if (g.incomingOffer !== null) return { title: 'Transfer Offer', tabs: null };
  if (g.coachTalk !== null) return { title: 'Talk to the Coach', tabs: null };
  if (g.playerTalk !== null) return { title: 'Player Talk', tabs: null };
  if (g.selectedNation !== null) return { title: 'National Team', tabs: null };
  if (g.selectedCoach !== null) return { title: 'Coach', tabs: null };
  if (g.selectedClub !== null) {
    return { title: g.selectedClub === world.userClubId ? 'Club Info' : 'Club', tabs: null };
  }
  if (g.selectedPlayer !== null) return { title: 'Player', tabs: null };
  if (g.selectedReview !== null) return { title: 'Season Review', tabs: null };
  if (g.selectedCompetition !== null) return { title: 'Competition', tabs: null };
  const section = sectionFor(g.screen);
  const tabs = availableTabs(section, g.club !== null, g.nationalView());
  return { title: section.label, tabs: tabs.length > 1 ? tabs : null };
}

/** How far the top bar has to give way, step by step, before everything in it fits. */
const TOPBAR_SQUEEZE_MAX = 6;

/**
 * Keeps the top bar on one line at any window width and with any Continue label: after each
 * render and each resize it finds the first squeeze level (see redesign-fit.css) at which
 * nothing in the bar overflows — set on the element itself, so no extra render is needed.
 */
function useFitTopBar(): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  // What the last fit was worked out for: measuring makes the browser lay the whole page out
  // there and then, so a render that changed nothing the bar's width depends on skips it.
  const fitted = useRef('');
  const fit = (force = false): void => {
    const bar = ref.current;
    if (bar === null) return;
    const de = document.documentElement;
    const key = `${window.innerWidth}|${de.className}|${de.style.cssText}|${bar.textContent}`;
    if (!force && key === fitted.current) return;
    fitted.current = key;
    const nav = bar.querySelector<HTMLElement>('.vm-primary-nav');
    const fits = (): boolean => bar.scrollWidth <= bar.clientWidth + 1 && (nav === null || nav.scrollWidth <= nav.clientWidth + 1);
    for (let level = 0; level <= TOPBAR_SQUEEZE_MAX; level++) {
      bar.dataset.squeeze = String(level);
      if (fits()) return;
    }
  };
  useLayoutEffect(() => fit());
  useEffect(() => {
    const bar = ref.current;
    if (bar === null) return;
    // A resize, or the fonts arriving, can change what fits with the same words in the bar.
    // (The first report is only the bar being observed: the render's own fit has just run.)
    let first = true;
    const watch = new ResizeObserver(() => { if (first) first = false; else fit(true); });
    watch.observe(bar);
    void document.fonts?.ready.then(() => fit(true));
    return () => watch.disconnect();
  }, []);
  return ref;
}

/** The top bar's menus: each section's name opens its first screen, the chevron beside it the rest. */
function PrimaryNav({ disabled }: { disabled: boolean }): JSX.Element {
  const g = useGame();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useDismiss(open !== null, () => setOpen(null));
  const onProfile = g.selectedPlayer !== null || g.selectedReview !== null || g.selectedClub !== null || g.selectedCoach !== null ||
    g.selectedNation !== null || g.negotiation !== null || g.staffNegotiation !== null || g.incomingOffer !== null ||
    g.coachTalk !== null || g.playerTalk !== null;
  const active = g.selectedCompetition !== null ? 'competitions' : onProfile ? null : sectionFor(g.screen).id;
  const unread = g.unreadMessages().length;
  return (
    <nav className="vm-primary-nav" aria-label="Main navigation" ref={ref}>
      {ALL_SECTIONS.map((s) => {
        const tabs = availableTabs(s, g.club !== null, g.nationalView());
        if (tabs.length === 0) return null;
        return (
          <div key={s.id} className={`vm-primary-item${active === s.id ? ' active' : ''}`}>
            <button data-tour={`nav-${s.id}`} className="vm-primary-main" disabled={disabled}
              aria-current={active === s.id ? 'page' : undefined}
              onClick={() => { setOpen(null); g.go(tabs[0][0]); }}>
              {s.label}
            </button>
            {tabs.length > 1 && (
              <button className="vm-primary-more" title={`${s.label} — more sections`} aria-label={`${s.label} — more sections`}
                aria-haspopup="menu" aria-expanded={open === s.id} disabled={disabled}
                onClick={() => setOpen(open === s.id ? null : s.id)}>
                <Icon name="chevronDown" size={11} />
              </button>
            )}
            {open === s.id && (
              <div className="menu-pop vm-nav-pop" role="menu">
                {tabs.map(([id, label]) => (
                  <button key={id} role="menuitem" className={g.screen === id ? 'on' : ''} onClick={() => { setOpen(null); g.go(id); }}>
                    {label}
                    {id === 'inbox' && unread > 0 && <b>{unread}</b>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Header(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club;
  const info = headerInfo(g);
  const takeover = inTakeover(g);
  const league = club !== null ? world.competitions[club.leagueId] : undefined;
  const manager = `${world.manager.firstName} ${world.manager.lastName}`;
  const nationalTeam = world.career.nationalTeam ?? -1;
  // Looking at the national team's squad, team sheet or instructions: the header says so.
  const nationalTeamView = club !== null && g.nationalView() && TEAM_SECTIONS.has(sectionFor(g.screen).id) &&
    g.selectedPlayer === null && g.selectedClub === null && g.selectedNation === null && g.matchday === null;
  const unread = g.unreadMessages().length;
  const offers = world.career.offers.length + (world.internationals?.offers?.length ?? 0);
  const [searching, setSearching] = useState(false);
  const searchRef = useDismiss(searching, () => setSearching(false));
  useEffect(() => { if (searching) searchRef.current?.querySelector('input')?.focus(); }, [searching, searchRef]);
  const tacticScreen = ['lineup', 'tactics', 'rotations'].includes(g.screen);
  const barRef = useFitTopBar();

  return (
    <header className="hdr">
      <div className="hdr-top vm-topbar" ref={barRef}>
        <button className="vm-brand" onClick={() => g.go('home')} disabled={takeover} title="Portal" aria-label="Portal">
          <img src={logo} alt="" />
          <span translate="no">Volleyball<small>Manager</small></span>
        </button>
        {nationalTeamView ? (
          <button className="hdr-club" onClick={() => g.selectNation(nationalTeam)} disabled={takeover} title="National team">
            <span className="side-flag hdr-flag"><Flag nation={nationalTeam} /></span>
            <span className="hdr-club-text">
              <strong translate="no">{sideName(nationalTeam)}</strong>
              <span>National team</span>
            </span>
          </button>
        ) : club !== null ? (
          <button className="hdr-club" onClick={() => g.selectClub(club.id)} disabled={takeover} title="Club info">
            <ClubCrest club={club} size={36} />
            <span className="hdr-club-text">
              <strong translate="no">{club.name}</strong>
              <span>{league?.name ?? ''}</span>
            </span>
          </button>
        ) : (
          <button className="hdr-club" onClick={() => g.go('career')} disabled={takeover} title="Career">
            <PersonFace photoUrl={managerPhotoUrl(world.manager)} name={manager} size={36} />
            <span className="hdr-club-text">
              <strong>{manager}</strong>
              <span>{nationalTeam >= 0 ? `${sideName(nationalTeam)} national team` : 'Out of work'}</span>
            </span>
          </button>
        )}

        <PrimaryNav disabled={takeover} />

        <div className="vm-header-tools">
          <FullscreenButton compact />
          <div ref={searchRef}>
            <button className="vm-tool" title="Search" aria-label="Search" disabled={takeover} aria-expanded={searching}
              onClick={() => setSearching((s) => !s)}>
              <Icon name="search" size={18} />
            </button>
            {searching && <div className="vm-search-pop"><GlobalSearch disabled={takeover} /></div>}
          </div>
          <button className="vm-tool" title="Inbox" aria-label="Inbox" disabled={takeover} onClick={() => g.go('inbox')}>
            <Icon name="inbox" size={18} />
            {unread > 0 && <span className="vm-count">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <button className="vm-tool" title="Help" aria-label="Help" onClick={() => g.openHelp()}><Icon name="help" size={18} /></button>
          <ManagerMenu name={manager} photo={managerPhotoUrl(world.manager)} offers={offers} />
        </div>

        <div className="hdr-date">
          <span className="hdr-date-main">{g.longDateLabel(world.day)}</span>
          <span className="hdr-date-sub">Season {world.season + 1} · {PHASE_NAMES[g.phase()]}</span>
        </div>

        <ContinueButton />
      </div>

      <div className="hdr-tabs-row vm-subbar">
        <div className="vm-history">
          <button title="Back" aria-label="Back" disabled={takeover || !g.canGoBack()} onClick={() => g.back()}><Icon name="back" size={16} /></button>
          <button title="Forward" aria-label="Forward" disabled={takeover || !g.canGoForward()} onClick={() => g.forward()}><Icon name="forward" size={16} /></button>
        </div>
        {info.tabs !== null ? (
          <nav className="hdr-tabs" aria-label="Section navigation">
            {info.tabs.map(([id, label]) => (
              <button
                key={id}
                data-tour={`tab-${id}`}
                className={`hdr-tab${g.screen === id && g.selectedClub === null && g.selectedPlayer === null && g.selectedCompetition === null ? ' active' : ''}`}
                onClick={() => g.go(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        ) : (
          <span className="vm-context-title">{info.title}</span>
        )}
        {!takeover && <WatchBar />}
        <TeamSwitch disabled={takeover} />
        {/* The club's tactic loaded, and the others saved — over the tactics screens; not the national team's. */}
        {tacticScreen && club !== null && !takeover && !g.nationalView() && <TacticPicker />}
      </div>
    </header>
  );
}

/**
 * The big button in the corner, and the way time moves on. It reads what the
 * day needs: the next unread message while you are working through the inbox,
 * the match on a match day, the aftermath once a match is over — and
 * otherwise Continue, which moves on a single day. Jumping further, to the
 * next match or a date, is a holiday; the chevron beside it keeps that and
 * the other finer controls.
 */
function ContinueButton(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const next = g.nextFixture();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const unread = g.unreadMessages().length;
  // The tutorial's practice match counts as a match today — with a side lent for it, too.
  const clubMatchToday = g.ownFixtureToday() !== null || g.testMatchToday() !== null;
  const nationalToday = g.nationalMatchToday();
  const matchToday = clubMatchToday || nationalToday !== null;
  const inMatch = g.matchday !== null;
  // A press conference or a bid to answer holds the day up.
  const decision = g.pendingDecision();
  const blocked = inMatch || g.activeInterviewId !== null || g.processing;
  const inInbox = g.screen === 'inbox' && g.selectedPlayer === null && g.selectedClub === null &&
    g.selectedReview === null && g.negotiation === null && g.staffNegotiation === null && g.incomingOffer === null;

  // No club match ahead: the national team's next, for a manager who has one.
  const nat = next === null ? g.nationalDates() : null;
  const natDay = nat?.match ?? null;
  const opponentId = next === null ? -1 : next.home === world.userClubId ? next.away : next.home;
  const opponent = world.clubs[opponentId];
  // No match of his own today: the other clubs' matches, to watch from the stands.
  const watchable = matchToday || !open ? [] : g.watchableMatches().slice(0, 4);
  // Out of work, with no fixture of his own: the next day other clubs play, to go and watch.
  const nextWatch = next === null && natDay === null && g.unemployed && open ? g.nextWatchDay() : null;
  const watchDay = nextWatch !== null && nextWatch > world.day ? nextWatch : null;

  let label = 'Continue';
  let icon: IconName = 'playOutline';
  let action = (): void => { void g.continueGame(); };
  if (g.processing) {
    label = 'Processing';
  } else if (inMatch) {
    label = g.matchday?.stage === 'lineup' ? 'Team selection'
      : g.matchday?.stage === 'setBreak' ? 'Set break' : 'Match in progress';
  } else if (g.postMatch !== null) {
    action = () => g.finishPostMatch();
  } else if (decision !== null) {
    label = decision.label;
    icon = decision.kind === 'interview' ? 'press' : decision.kind === 'squad' ? 'world' : 'offer';
    action = () => { g.openPendingDecision(); };
  } else if (g.testMatchToday() !== null) {
    // The tutorial's practice match: the button the tutorial points at says what it says.
    label = 'Play match';
    icon = 'ball';
    action = () => g.openMatchday();
  } else if (inInbox && unread > 0) {
    label = 'Next unread';
    icon = 'inbox';
    action = () => g.nextUnread();
  } else if (clubMatchToday) {
    label = 'Play match';
    icon = 'ball';
    action = () => g.openMatchday();
  } else if (nationalToday !== null) {
    label = 'Play match';
    icon = 'world';
    action = () => g.openNationalMatchday();
  }

  return (
    <div className="continue" ref={ref} data-tour="continue">
      <button className={`continue-main${g.processing ? ' busy' : ''}`} disabled={blocked} onClick={action} title={label}>
        {g.processing ? <span className="spinner" /> : <Icon name={icon} size={16} />}
        <span className="continue-label">{label}</span>
      </button>
      <button
        className="continue-more"
        disabled={blocked || g.postMatch !== null}
        onClick={() => setOpen((o) => !o)}
        title="More options"
      >
        <Icon name="chevronDown" size={15} />
      </button>
      {open && (
        <div className="menu-pop menu-pop-right">
          <button
            disabled={matchToday || decision !== null}
            title={decision?.reason}
            onClick={() => { setOpen(false); void g.continueGame(); }}
          >
            <Icon name="playOutline" size={15} /> Continue to the next day
            {decision !== null
              ? <span className="menu-pop-note">{decision.label}</span>
              : unread > 0 && <span className="menu-pop-note">{unread} unread</span>}
          </button>
          <button onClick={() => { setOpen(false); g.openHoliday(); }}>
            <Icon name="calendar" size={15} /> Go on holiday…
          </button>
          <button disabled={next === null && natDay === null && watchDay === null && !clubMatchToday} onClick={() => {
            setOpen(false);
            if (next !== null || g.testMatchToday() !== null) g.openMatchday();
            else if (natDay !== null && natDay <= world.day) g.openNationalMatchday();
            else if (natDay !== null) g.openHoliday(natDay);
            else if (watchDay !== null) g.openHoliday(watchDay);
          }}>
            <Icon name="fastForward" size={15} />
            <span className="menu-pop-stack">
              <span>{next === null && natDay === null && !clubMatchToday
                ? (watchDay !== null ? 'Holiday until the next matches…' : 'No fixture scheduled')
                : matchToday ? 'Play match' : 'Holiday until the next match…'}</span>
              {next === null && natDay === null && watchDay !== null && (
                <span className="faint">Other clubs play · {g.dateLabelForDay(watchDay)}</span>
              )}
              {next !== null && opponent !== undefined && (
                <span className="faint">
                  {next.home === world.userClubId ? 'vs' : 'at'} {opponent.shortName} · {g.dateLabelForDay(next.day)}
                </span>
              )}
              {next === null && nat !== null && natDay !== null && (
                <span className="faint">
                  {nat.opponent >= 0 ? `vs ${sideName(nat.opponent)}` : nat.tournament} · {g.dateLabelForDay(natDay)}
                </span>
              )}
            </span>
          </button>
          {matchToday && (
            <button onClick={() => { g.instantResult(); setOpen(false); }}>
              <Icon name="whistle" size={15} /> Instant result
            </button>
          )}
          {watchable.length > 0 && (
            <>
              <div className="menu-sep" />
              <span className="menu-pop-label">Watch live from the stands</span>
              {watchable.map((f) => <WatchMatchItem key={f.id} fixture={f} onPick={() => setOpen(false)} />)}
            </>
          )}
          <div className="menu-sep" />
          <button disabled={unread === 0} onClick={() => { g.nextUnread(); setOpen(false); }}>
            <Icon name="inbox" size={15} /> Next unread
          </button>
          <button disabled={unread === 0} onClick={() => { g.markAllRead(); setOpen(false); }}>
            <Icon name="check" size={15} /> Mark all as read
          </button>
        </div>
      )}
    </div>
  );
}

interface SearchResult {
  /** A coach is a staff member's id — or -1 for the manager himself. */
  kind: 'club' | 'player' | 'nation' | 'league' | 'coach';
  id: number;
}

/**
 * The header's search box: any club, player, coach, national team or league in
 * the world by name — a country's name finds its national team and its leagues —
 * opened straight into its page. Results are capped and debounced so typing
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
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Ctrl/Cmd + K jumps to the search box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 140);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo((): SearchResult[] => {
    if (debounced.length < 2) return [];
    const nations = world.nationalTeams
      .map((t) => t.nation)
      .filter((n) => NATIONS[n] !== undefined && (NATIONS[n].name.toLowerCase().includes(debounced) ||
        NATIONS[n].code.toLowerCase() === debounced))
      .slice(0, 3)
      .map((n): SearchResult => ({ kind: 'nation', id: n }));
    const leagues = world.competitions
      .filter((c) => c.kind === 'league' && c.participants.length > 0 &&
        (c.name.toLowerCase().includes(debounced) || (NATIONS[c.nation]?.name.toLowerCase().includes(debounced) ?? false)))
      .sort((a, b) => a.tier - b.tier || b.reputation - a.reputation)
      .slice(0, 4)
      .map((c): SearchResult => ({ kind: 'league', id: c.id }));
    const clubs = world.clubs
      .filter((c) => c.name.toLowerCase().includes(debounced) || c.shortName.toLowerCase() === debounced)
      .sort((a, b) => b.reputation - a.reputation)
      .slice(0, 4)
      .map((c): SearchResult => ({ kind: 'club', id: c.id }));
    // Head coaches, in work or not, and the manager himself — the best known first.
    const manager = `${world.manager.firstName} ${world.manager.lastName}`;
    const coaches: SearchResult[] = world.staff
      .filter((s) => (s.role === StaffRole.HeadCoach || (s.spells?.length ?? 0) > 0) &&
        `${s.firstName} ${s.lastName}`.toLowerCase().includes(debounced))
      .sort((a, b) => b.reputation - a.reputation)
      .slice(0, 4)
      .map((s) => ({ kind: 'coach', id: s.id }));
    if (manager.toLowerCase().includes(debounced)) coaches.unshift({ kind: 'coach', id: -1 });
    const players: number[] = [];
    for (let i = 0; i < store.count; i++) {
      if (!store.isActive(i)) continue;
      if (store.hasFlag(i, PlayerFlag.Youth) && store.clubId[i] !== world.userClubId) continue;
      if (!store.fullName(i).toLowerCase().includes(debounced)) continue;
      players.push(i);
    }
    players.sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
    return [...nations, ...leagues, ...clubs, ...coaches.slice(0, 4), ...players.slice(0, 8).map((p): SearchResult => ({ kind: 'player', id: p }))];
  }, [debounced, world]);

  useEffect(() => setHighlight(0), [debounced]);

  const openResult = (r: SearchResult): void => {
    if (r.kind === 'club') g.selectClub(r.id);
    else if (r.kind === 'nation') g.selectNation(r.id);
    else if (r.kind === 'league') g.openCompetition(r.id);
    else if (r.kind === 'coach') { if (r.id >= 0) g.selectCoach(r.id); else g.go('career'); }
    else g.select(r.id);
    setQuery('');
    setDebounced('');
    setOpen(false);
  };

  return (
    <div className="search" ref={ref}>
      <Icon name="search" size={16} className="search-icon" />
      <input
        ref={inputRef}
        className="search-input"
        placeholder="Search players, coaches, clubs, nations & leagues"
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
      <span className="search-kbd">Ctrl/Cmd + K</span>
      {open && debounced.length >= 2 && (
        <div className="search-pop" id={listId} role="listbox">
          {results.length === 0 && <div className="search-empty">Nothing matches “{query.trim()}”.</div>}
          {results.map((r, i) => {
            if (r.kind === 'nation') {
              const rank = worldRanking(world).indexOf(r.id) + 1;
              return (
                <button
                  key={`n${r.id}`}
                  className={`search-row${i === highlight ? ' active' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => openResult(r)}
                >
                  <span className="search-flag"><Flag nation={r.id} /></span>
                  <span className="search-row-main">
                    <strong>{NATIONS[r.id].name}</strong>
                    <span className="faint">National team{rank > 0 ? ` · ranked ${rank}` : ''}</span>
                  </span>
                </button>
              );
            }
            if (r.kind === 'league') {
              const c = world.competitions[r.id];
              return (
                <button
                  key={`l${r.id}`}
                  className={`search-row${i === highlight ? ' active' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => openResult(r)}
                >
                  <span className="search-league"><Icon name="trophy" size={15} /></span>
                  <span className="search-row-main">
                    <strong>{c.name}</strong>
                    <span className="faint"><Flag nation={c.nation} /> League · Tier {c.tier} · {c.participants.length} clubs</span>
                  </span>
                </button>
              );
            }
            if (r.kind === 'coach') {
              const s = r.id >= 0 ? world.staff[r.id] : undefined;
              const name = s !== undefined ? `${s.firstName} ${s.lastName}` : `${world.manager.firstName} ${world.manager.lastName}`;
              const where = s === undefined
                ? world.clubs[world.userClubId]
                : s.role === StaffRole.HeadCoach && s.retired !== true ? world.clubs[s.clubId] : undefined;
              return (
                <button
                  key={`h${r.id}`}
                  className={`search-row${i === highlight ? ' active' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => openResult(r)}
                >
                  {s === undefined
                    ? <PersonFace photoUrl={managerPhotoUrl(world.manager)} name={name} size={26} />
                    : <span className="coach-initials search-coach">{initials(name)}</span>}
                  <span className="search-row-main">
                    <strong>{name}</strong>
                    <span className="faint">
                      {s === undefined ? 'You · ' : 'Head coach · '}
                      {where !== undefined ? where.name : s?.retired === true ? 'Retired' : 'Out of work'}
                    </span>
                  </span>
                  <span className="search-coach-tag">Coach</span>
                </button>
              );
            }
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
        {cel.nation !== undefined && NATIONS[baseNation(cel.nation)] !== undefined && (
          <div className="trophy-club"><Flag nation={cel.nation} /> {sideName(cel.nation)}</div>
        )}
        <div className="trophy-competition">{cel.competitionName}</div>
        <button className="primary" onClick={() => g.dismissTrophyCelebration()}>Continue</button>
      </div>
    </div>
  );
}
