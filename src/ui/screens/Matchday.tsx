import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { clubKit, kitFromHue, matchKits } from '../kits.ts';
import { asItStands, liveTable, type AroundTheLeague, type Progress } from '../../engine/season/aroundTheLeague.ts';
import { chemistryOf } from '../../engine/world/chemistry.ts';
import { TRAVEL_COST, tripTo, type Trip } from '../../engine/world/fatigue.ts';
import { fixtureRivalry } from '../../engine/world/rivals.ts';
import { Position, POSITION_SHORT } from '../../engine/model/positions.ts';
import { INJURY_NAMES, type PlayerStore } from '../../engine/model/players.ts';
import {
  CHALLENGE_CHECK_NAMES, challengeChecksFor, type ChallengeCheck, type LastCall, type ShoutKind,
} from '../../engine/match/engine.ts';
import { BALL_FOOTPRINT, gapWords, type BallMark } from '../../engine/match/landing.ts';
import {
  abilityClass, Bar, ChoiceField, ClubCrest, clubHue, Flag, PlayerFace, Pos, POSITION_ACCENT, RatingBadge,
  Segmented, StarMeter, useDismiss,
} from '../components.tsx';
import { NATIONS } from '../../engine/world/nations.ts';
import type { World } from '../../engine/world/world.ts';
import { Icon } from '../icons.tsx';
import { LiveCourt, type CourtLabels } from '../LiveCourt.tsx';
import { serverReadyOnCourt, TROPHY_LIFT_AT } from '../courtMotion.ts';
import { rallyBeats, setupScene, type Radar, type Scene } from '../matchCourt.ts';
import { bigPlayMs, playBeats, RADAR_MS, sleep, stingerFor, type BigPlay } from '../rallyPlayer.ts';
import type { Kit } from '../court3d.ts';
import { servesJump } from '../../engine/match/ratings.ts';
import { TeamSheet } from '../teamSheet.tsx';
import {
  ATTACKER_OPTIONS, BLOCK_OPTIONS, COMBINATION_OPTIONS, DEFENSE_OPTIONS, OFFENSE_OPTIONS, RECEPTION_OPTIONS, SERVE_OPTIONS,
  SERVE_TARGET_OPTIONS, SHAPE_OPTIONS, SliderField, TEMPO_OPTIONS,
} from './Manage.tsx';
import {
  combinationsOf, Formation, FORMATION_NAMES, formationOf, lineupSlotPositions, type TeamTactics,
} from '../../engine/match/tactics.ts';
import { TacticsBoard } from '../tacticsBoard.tsx';
import { defenceLayoutsOf, type DefenceLayouts } from '../../engine/match/defence.ts';
import { describeRallyHighlight } from './Match.tsx';
import { useGame, WARM_READY, type LiveInjury, type MatchdayLogEntry, type MatchdaySnapshot, type MatchSide, type VideoReview } from '../state.ts';
import { Dropdown } from '../dropdown.tsx';
import { CAMERA_MODES, type CameraMode } from '../courtCameras.ts';
import { DEFAULT_LOOK, figureLook } from '../coachLook.ts';
import { PlayerDetail } from './Squad.tsx';
import { TALK_LINES, TALK_OPTIONS, type ReactionLabel, type TalkMoment } from '../../engine/world/teamTalk.ts';
import { playCrowd, playHit, playHooter, playPointCrowd, playStinger, playWhistle, setSoundOn, soundOn, startArena, stopArena } from '../sound.ts';

/** National teams play in something like their flag's colour. */
const NATION_HUES: Readonly<Record<string, number>> = {
  POL: 352, ITA: 214, FRA: 224, BRA: 50, USA: 222, JPN: 0, SLO: 135, SRB: 356, ARG: 198, GER: 0, NED: 28, CUB: 0,
  CAN: 356, IRI: 130, TUR: 357, BEL: 4, CHN: 358, BUL: 130, UKR: 50, CZE: 220, FIN: 210, KOR: 220, EGY: 0,
  POR: 140, ESP: 2, SWE: 48, GRE: 210, AUS: 50, MEX: 145, QAT: 335, TUN: 0, CRO: 0, SVK: 220, ROU: 52, NOR: 0,
  AUT: 0, SUI: 0, DEN: 0, CHI: 0, COL: 50, VEN: 350, PUR: 210, DOM: 220, IND: 28, THA: 220, KAZ: 190,
};

/** The hue a side's kit is made from. */
function sideHue(world: World, side: MatchSide): number {
  if (side.clubId >= 0) {
    const club = world.clubs[side.clubId];
    return club !== undefined ? clubHue(club) : 210;
  }
  return NATION_HUES[NATIONS[side.nation]?.code ?? ''] ?? (side.nation * 137.508) % 360;
}

/** The two sides' kits: a club's own (as designed, or from its colour), a nation's from its colours — the away side changing on a clash. */
function sideKits(world: World, home: MatchSide, away: MatchSide): [Kit, Kit] {
  const kit = (s: MatchSide): Kit => {
    const club = s.clubId >= 0 ? world.clubs[s.clubId] : undefined;
    return club !== undefined ? clubKit(club) : kitFromHue(sideHue(world, s));
  };
  return matchKits(kit(home), kit(away), sideHue(world, away));
}

/** A side's badge: the club's crest, or the nation's flag. */
function SideCrest({ side, size }: { side: MatchSide; size: number }): JSX.Element | null {
  const g = useGame();
  if (side.clubId < 0) {
    return <span className="side-flag" style={{ width: size * 1.3, height: size * 0.88 }}><Flag nation={side.nation} /></span>;
  }
  const club = g.world?.clubs[side.clubId];
  return club !== undefined ? <ClubCrest club={club} size={size} /> : null;
}

/** Both sides set up for the next serve, from the live snapshot — the
 *  server where his own serve, jump or float, starts, given his ball by a ball kid. */
function sceneFor(snap: MatchdaySnapshot | null, roles: Uint8Array, nearTeam: 0 | 1, store: PlayerStore): Scene {
  if (snap === null) return { positions: new Map(), poses: new Map(), ball: null, arc: 0, actor: null, ms: 400 };
  return { ...setupScene(snap, snap.serving, roles, nearTeam, (p) => (servesJump(store, p) ? 'jump' : 'float')), ballKids: true };
}

/**
 * Play one rally out on the court: every beat moves the players into where
 * they would really be — serve receive, the switch, the setter running to
 * the target, hitters approaching, the block closing — and sends the ball to
 * whoever touches it next.
 */
async function animateRally(
  logEntry: MatchdayLogEntry,
  roles: Uint8Array,
  nearTeam: 0 | 1,
  speed: number,
  cancelled: { current: boolean },
  setScene: (scene: Scene) => void,
  onBigPlay: (play: BigPlay) => void,
  onRadar: (radar: Radar) => void,
  defenceOf?: (team: 0 | 1) => DefenceLayouts | undefined,
  onPoint?: (entry: MatchdayLogEntry['entry']) => void,
): Promise<void> {
  const { entry } = logEntry;
  const seed = entry.set * 1000 + entry.scoreBefore[0] * 31 + entry.scoreBefore[1];
  const beats = rallyBeats(logEntry, entry.serveTeam, entry.contacts, roles, seed, nearTeam, entry.winner, defenceOf, entry.passers);
  await playBeats(beats, speed, cancelled, setScene, onBigPlay, onRadar, (beat) => {
    if (beat.actor !== null) playHit(beat.callout !== null || beat.radar !== undefined);
    const stinger = stingerFor(beat.callout);
    if (stinger !== null) playStinger(stinger);
  });
  // The crowd for the point — the home crowd louder for the home side's.
  if (onPoint !== undefined) onPoint(entry);
  else playCrowd(entry.winner === 0 ? 0.9 : 0.35);
}

/** A side's trip to the match, as the team sheet says it. */
const TRIP_WORDS: Readonly<Record<Trip, string>> = { short: 'Short trip', long: 'Long trip', abroad: 'Flew in' };

/** How full the stand is: a big competition draws a crowd, a big match fills the place. */
export function crowdFor(world: World, competitionId: number, importance: number, derby = false): number {
  const comp = world.competitions[competitionId];
  const draw = comp !== undefined ? Math.min(1, comp.reputation / 8000) : 0.7;
  // A derby sells out.
  return derby ? 1 : Math.min(1, 0.42 + 0.38 * draw + 0.3 * importance);
}

/** A big moment flashed over the court — with, for a spike put away or an
 *  ace, the ball's speed and how high it was struck, and for a stuff block
 *  how high the hands were. */
export function BigPlayCallout({ play }: { play: BigPlay }): JSX.Element {
  const reading = play.reading !== undefined && (play.speed !== undefined || play.height !== undefined);
  return (
    <div className={`big-play ${play.team === 0 ? 'home' : 'away'}${reading ? ' with-speed' : ''}`}>
      {play.text}
      {reading && (
        <span className="big-play-reading">
          {play.speed !== undefined && play.reading === 'strike' && (
            <span className="big-play-speed"><small>Speed</small> {play.speed} <small>km/h</small></span>
          )}
          {play.height !== undefined && (
            <span className="big-play-speed">
              <small>{play.reading === 'block' ? 'Block' : 'Contact'}</small> {play.height.toFixed(2)} <small>m</small>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** The radar's reading of a serve as it flies: who served, how fast, how high — tucked in a corner, the way television shows it. */
export function ServeRadar({ radar, store, kits }: { radar: Radar & { key: number }; store: PlayerStore; kits: [Kit, Kit] }): JSX.Element {
  return (
    <div className="serve-radar" style={{ borderLeftColor: kits[radar.team].shirt }}>
      <span className="serve-radar-who"><small>Serve</small> {store.shortName(radar.player)}</span>
      {radar.speed !== undefined && <span className="serve-radar-val"><b>{radar.speed}</b> km/h</span>}
      {radar.height !== undefined && <span className="serve-radar-val"><b>{radar.height.toFixed(2)}</b> m</span>}
    </div>
  );
}

export function MatchdayScreen(): JSX.Element | null {
  const g = useGame();
  const md = g.matchday;
  // The hall is never silent while a match is on: from the team sheet to the last point, breaks and all.
  const on = md !== null;
  useEffect(() => {
    if (!on) return undefined;
    startArena();
    return () => stopArena();
  }, [on]);
  if (md === null) return null;
  return (
    <>
      {md.stage === 'lineup' ? <LineupSetup /> : md.stage === 'setBreak' ? <SetBreak /> : <LiveMatchView />}
      {g.selectedPlayer !== null && <ProfileOverlay />}
    </>
  );
}

/** A player's profile, opened from the match — over it, rather than in place of it, until closed. */
function ProfileOverlay(): JSX.Element {
  const g = useGame();
  return (
    <div className="hol-overlay" onClick={() => g.select(null)}>
      <div className="lv-profile content-fill" role="dialog" aria-label="Player profile" onClick={(e) => e.stopPropagation()}>
        <div className="view-fade"><PlayerDetail /></div>
      </div>
    </div>
  );
}

/** Average current ability of a squad's best six — a quick read of how strong a side is. */
function bestSixAverage(players: readonly number[], store: PlayerStore, canPlay: (p: number) => boolean): number {
  const top = [...players]
    .filter(canPlay)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])
    .slice(0, 6);
  return top.length > 0 ? Math.round(top.reduce((s, p) => s + store.currentAbility[p], 0) / top.length) : 0;
}

function LineupSetup(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;

  const [home, away] = md.sides;
  const opponent = md.sides[md.userIsHome ? 1 : 0];
  // The reserves named for today; everyone else fit is left out, to be called up instead.
  const bench = md.homeBench.filter((p) =>
    g.matchAvailable(p) && !md.homeLineup.includes(p) && p !== md.homeLibero && p !== md.homeDefensiveLibero);

  const starters = md.homeLineup.filter((p): p is number => p !== undefined);
  const teamAvg = starters.length > 0
    ? Math.round(starters.reduce((s, p) => s + store.currentAbility[p], 0) / starters.length)
    : 0;
  const oppAvg = bestSixAverage(opponent.players, store, (p) => g.matchAvailable(p));
  // How far each side came — a club match only: national sides gather days before.
  const tripTag = (clubId: number): JSX.Element | null => {
    const trip = md.national === null ? tripTo(world, md.fixture, clubId) : null;
    if (trip === null || TRAVEL_COST[trip] === 0) return null;
    return (
      <span className="md-banner-trip" title={`Travelled the day before: ${TRAVEL_COST[trip]} condition off every player`}>
        <Icon name="clock" size={11} /> {TRIP_WORDS[trip]} −{TRAVEL_COST[trip]}
      </span>
    );
  };

  return (
    <div className="md-setup">
      <div className="md-banner">
        <div className="md-banner-team">
          <SideCrest side={home} size={46} />
          <div className="md-banner-team-text">
            <span className="md-banner-name">{home.name}</span>
            <span className="md-banner-tag">Home{md.userIsHome ? ' · Your team' : ''}</span>
            {tripTag(md.fixture.home)}
          </div>
        </div>
        <div className="md-banner-mid">
          <span className="md-banner-comp">{md.title}</span>
          <span className="md-banner-vs">VS</span>
          <span className="md-banner-date">{g.weekdayLabelForDay(md.fixture.day)} {g.dateLabelForDay(md.fixture.day)}</span>
        </div>
        <div className="md-banner-team right">
          <div className="md-banner-team-text">
            <span className="md-banner-name">{away.name}</span>
            <span className="md-banner-tag">Away{!md.userIsHome ? ' · Your team' : ''}</span>
            {tripTag(md.fixture.away)}
          </div>
          <SideCrest side={away} size={46} />
        </div>
        <div className="md-banner-side">
          <div className="md-strength">
            <div className="lineup-bar-rating">
              <span className="faint">Your starting six</span>
              <StarMeter value={teamAvg} size={13} />
              <strong className={abilityClass(teamAvg)}>{teamAvg}</strong>
            </div>
            <div className="lineup-bar-rating">
              <span className="faint">{opponent.shortName} best six</span>
              <StarMeter value={oppAvg} size={13} />
              <strong className={abilityClass(oppAvg)}>{oppAvg}</strong>
            </div>
          </div>
          {md.national === null && <MatchdayTacticSelect />}
          <MatchdayFormation />
          <TeamTalkButton />
          <button className="primary lg" onClick={() => g.kickOff()} data-tour="kickoff">
            <Icon name="whistle" size={18} /> Kick off
          </button>
        </div>
      </div>

      <TeamSheet
        lineup={md.homeLineup}
        libero={md.homeLibero}
        defensiveLibero={md.homeDefensiveLibero}
        bench={bench}
        store={store}
        onSetPlayer={(slot, p) => g.setMatchdayPlayer(slot, p)}
        onSwapPlayers={(a, b) => g.swapMatchdayPlayers(a, b)}
        onSetLibero={(p) => g.setMatchdayLibero(p)}
        onSetDefensiveLibero={(p) => g.setMatchdayDefensiveLibero(p)}
        slotPositions={lineupSlotPositions(formationOf(g.matchTactics() ?? undefined))}
        outOfSquad={g.matchdayLeftOut()}
        onAddToSquad={(p) => g.addToMatchdaySquad(p)}
        onDropFromSquad={(p) => g.dropFromMatchdaySquad(p)}
        outfieldLiberos={md.homeOutfieldLiberos}
        onToggleReserveLibero={(p) => g.toggleReserveLibero(p)}
        chemistry={(s, h) => chemistryOf(world, s, h)}
      />
    </div>
  );
}

/** The saved tactic to play today — loading another picks the six again for it. */
function MatchdayTacticSelect(): JSX.Element | null {
  const g = useGame();
  const saved = g.savedTactics();
  if (saved === null || saved.slots.length < 2) return null;
  const load = (v: number): void => {
    if (g.matchday?.stage !== 'setBreak') {
      g.loadTactic(v);
      return;
    }
    // At a set break the tactic's system comes with it, and the six is picked for it.
    const f = g.loadTacticInMatch(v);
    if (f !== null && f !== formationOf(g.matchTactics() ?? undefined)) g.setMatchdayFormation(f);
  };
  return (
    <div className="md-formation">
      <span className="faint">Tactic</span>
      <Dropdown
        size="sm"
        className="md-tactic-select"
        value={saved.active}
        onChange={load}
        options={saved.slots.map((t, i) => ({ value: i, label: `${i + 1}. ${t.name}` }))}
      />
    </div>
  );
}

/** The 5-1 / 4-2 switch of the team-sheet screens — before kickoff, or for the next set. */
function MatchdayFormation(): JSX.Element {
  const g = useGame();
  return (
    <div className="md-formation" title="5-1: one setter and an opposite. 4-2: two setters, diagonal — the one in the back row sets, the one at the net attacks.">
      <span className="faint">Formation</span>
      <Segmented<Formation>
        size="sm"
        options={[[Formation.FiveOne, FORMATION_NAMES[Formation.FiveOne]], [Formation.FourTwo, FORMATION_NAMES[Formation.FourTwo]]]}
        value={formationOf(g.matchTactics() ?? undefined)}
        onChange={(f) => g.setMatchdayFormation(f)}
      />
    </div>
  );
}

/**
 * The break between two sets: the score so far, and the team sheet again,
 * filled in with the six who started the set just played — keep them, or
 * change anyone and any zone before the next set starts.
 */
function SetBreak(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;

  const [home, away] = md.sides;
  const setsPlayed = md.snapshot?.set ?? 0;
  const setScores = completedSets(md.log, setsPlayed, false);
  // Only the fourteen named at kickoff can play.
  const bench = g.matchSquadOf(md.userIsHome ? 0 : 1).filter((p) =>
    g.matchAvailable(p) && !md.homeLineup.includes(p) && p !== md.homeLibero && p !== md.homeDefensiveLibero);
  const teamAvg = Math.round(
    md.homeLineup.reduce((s, p) => s + store.currentAbility[p], 0) / Math.max(1, md.homeLineup.length));
  const last = g.lastSetSheet();
  const changed = last !== null && (
    last.lineup.some((p, i) => md.homeLineup[i] !== p)
    || last.libero !== md.homeLibero || last.defensiveLibero !== md.homeDefensiveLibero);
  // The opponent has already handed in its sheet: say what it changed.
  const opponentText = md.opponentChanges.length === 0
    ? 'Same six as last set'
    : md.opponentChanges.map((c) => `${store.shortName(c.inPlayerIdx)} for ${store.shortName(c.outPlayerIdx)}${
      c.reason === 'fatigue' ? ' (tired)' : c.reason === 'form' ? ' (struggling)' : ''}`).join(' · ');
  const opponentNote = (
    <span className={`md-banner-changes${md.opponentChanges.length > 0 ? ' changed' : ''}`} title={opponentText}>
      {md.opponentChanges.length > 0 && <Icon name="swap" size={11} />}
      <span>{opponentText}</span>
    </span>
  );

  return (
    <div className="md-setup">
      <div className="md-banner">
        <div className="md-banner-team">
          <SideCrest side={home} size={46} />
          <div className="md-banner-team-text">
            <span className="md-banner-name">{home.name}</span>
            <span className="md-banner-tag">Home{md.userIsHome ? ' · Your team' : ''}</span>
            {!md.userIsHome && opponentNote}
          </div>
        </div>
        <div className="md-banner-mid">
          <span className="md-banner-comp">End of set {setsPlayed}</span>
          <span className="md-banner-vs md-banner-sets">{md.snapshot?.homeSets ?? 0} – {md.snapshot?.awaySets ?? 0}</span>
          <span className="md-banner-date mono">{setScores.map(([h, a]) => `${h}-${a}`).join('  ·  ')}</span>
        </div>
        <div className="md-banner-team right">
          <div className="md-banner-team-text">
            <span className="md-banner-name">{away.name}</span>
            <span className="md-banner-tag">Away{!md.userIsHome ? ' · Your team' : ''}</span>
            {md.userIsHome && opponentNote}
          </div>
          <SideCrest side={away} size={46} />
        </div>
        <div className="md-banner-side">
          <div className="md-strength">
            <div className="lineup-bar-rating">
              <span className="faint">Set {setsPlayed + 1} six</span>
              <StarMeter value={teamAvg} size={13} />
              <strong className={abilityClass(teamAvg)}>{teamAvg}</strong>
            </div>
            <div className="md-setbreak-actions">
              {changed && (
                <button className="sm ghost" onClick={() => g.resetSetBreakSheet()} title="Back to the six who started the last set">
                  <Icon name="swap" size={13} /> Same as last set
                </button>
              )}
              <button className="sm danger" onClick={() => g.finishMatchdayNow()} title="Skip to the result">
                <Icon name="fastForward" size={13} /> Finish match
              </button>
            </div>
          </div>
          {md.national === null && <MatchdayTacticSelect />}
          <MatchdayFormation />
          <TeamTalkButton />
          <button className="primary lg" onClick={() => g.startNextSet()}>
            <Icon name="whistle" size={18} /> Start set {setsPlayed + 1}
          </button>
        </div>
      </div>

      <TeamSheet
        lineup={md.homeLineup}
        libero={md.homeLibero}
        defensiveLibero={md.homeDefensiveLibero}
        bench={bench}
        store={store}
        onSetPlayer={(slot, p) => g.setMatchdayPlayer(slot, p)}
        onSwapPlayers={(a, b) => g.swapMatchdayPlayers(a, b)}
        onSetLibero={(p) => g.setMatchdayLibero(p)}
        onSetDefensiveLibero={(p) => g.setMatchdayDefensiveLibero(p)}
        slotPositions={lineupSlotPositions(formationOf(g.matchTactics() ?? undefined))}
        registered={md.homeLiberos ?? g.matchLiberosOf(md.userIsHome ? 0 : 1)}
        chemistry={(s, h) => chemistryOf(world, s, h)}
      />
    </div>
  );
}

/** How a reaction to a talk reads, and its colour. */
const REACTION_TONE: Readonly<Record<ReactionLabel, string>> = {
  'Fired up': 'good', Focused: 'good', Unmoved: '', Nervous: 'bad', Annoyed: 'bad',
};

/** The team talk, before the match or at a set break: give it, or see how it went. */
function TeamTalkButton(): JSX.Element {
  const g = useGame();
  const [open, setOpen] = useState(false);
  const given = g.givenTalk();
  const moment = g.talkMoment();
  return (
    <>
      <button className={`md-talk-btn${given !== null ? ' done' : ''}`} onClick={() => setOpen(true)} data-tour="team-talk"
        title={given !== null ? given.result.summary : 'Talk to the players'}>
        <Icon name="press" size={15} /> {given !== null ? 'Talk given' : 'Team talk'}
      </button>
      {open && <TeamTalkDialog moment={moment} onClose={() => setOpen(false)} />}
    </>
  );
}

function TeamTalkDialog({ moment, onClose }: { moment: TalkMoment | null; onClose: () => void }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  const given = g.givenTalk();
  const md = g.matchday!;
  return (
    <div className="hol-overlay" onClick={onClose}>
      <div className="hol-card talk-card" role="dialog" aria-label="Team talk" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs">{md.stage === 'lineup' ? 'Before the match' : `Before set ${(md.snapshot?.set ?? 0) + 1}`} <Icon name="chevronRight" size={12} /> <b>Team talk</b></span>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <h2 className="hol-title">Team Talk</h2>
        {given === null && moment !== null ? (
          <>
            <p className="hol-sub">What do you tell them? It depends on the moment — and on who is listening.</p>
            <div className="talk-options">
              {TALK_OPTIONS[moment].map((tone) => (
                <button key={tone} className="talk-option" onClick={() => g.giveTeamTalk(tone)}>
                  <Icon name="press" size={16} /> <span>“{TALK_LINES[tone]}”</span>
                </button>
              ))}
            </div>
          </>
        ) : given !== null ? (
          <>
            <p className="hol-sub">“{TALK_LINES[given.tone]}” — <b>{given.result.summary}</b></p>
            <div className="talk-reactions">
              {given.result.reactions.map((r) => (
                <div key={r.p} className="talk-reaction">
                  <PlayerFace playerId={store.id[r.p]} name={store.fullName(r.p)} size={26} />
                  <span className="talk-name">{store.shortName(r.p)}</span>
                  <span className={`talk-label ${REACTION_TONE[r.label]}`}>{r.label}</span>
                </div>
              ))}
            </div>
            <footer className="talk-foot"><button className="primary" onClick={onClose}>Done</button></footer>
          </>
        ) : <p className="hol-sub">There is nothing to say just now.</p>}
      </div>
    </div>
  );
}

const TIMEOUT_SECONDS = 30;

/** The compact tactics editor shown while a timeout is active — the same club.tactics
 *  object the rally engine reads live, so a change here applies from the next rally on. */
/**
 * Someone down hurt: who, and what — and when it is the user's own player,
 * his call: let him play on with a knock, or take him off — and for whom, the
 * assistant's choice first; an exceptional substitution when the six are
 * spent. One who has to come off, has to.
 */
function InjuryPanel(): JSX.Element | null {
  const g = useGame();
  const md = g.matchday!;
  const live = md.injury;
  if (live == null) return null;
  const store = g.world!.players;
  const roles = g.liveRoles();
  const { inj } = live;
  const knock = inj.severity === 'knock';
  const deciding = live.phase === 'decide';
  const liberos = g.liveLiberos();
  const isLibero = live.ours && (inj.p === liberos.reception || inj.p === liberos.defence);
  const options = deciding ? g.injuryOptions() : [];
  const otherLibero = inj.p === liberos.reception ? liberos.defence : liberos.reception;
  const line = live.phase === 'down' ? 'He is down. The physio is on his way.'
    : live.phase === 'treat' ? 'The physio is with him.'
      : live.phase === 'decide'
        ? knock ? 'He can carry on — below his best, and every rally he plays on with it, it may get worse.'
          : inj.aggravated === true ? 'Playing on has made it worse — he has to come off.' : 'He cannot carry on. Who comes on?'
        : live.phase === 'up' ? 'Back on his feet — he plays on.' : 'Helped off.';
  return (
    <div className={`injury-panel${deciding ? ' deciding' : ''}`}>
      <div className="injury-head">
        <span className="injury-icon"><Icon name="medical" size={22} /></span>
        <PlayerFace playerId={store.id[inj.p]} name={store.fullName(inj.p)} size={38} />
        <div className="injury-title">
          <strong>{store.fullName(inj.p)} <Pos pos={roles[inj.p] as Position} /></strong>
          <span className="faint">{INJURY_NAMES[inj.type] ?? 'Injury'} · {md.sides[inj.team].shortName}</span>
        </div>
        <span className={`injury-tag ${knock ? 'knock' : 'serious'}`}>{knock ? 'Knock' : 'Has to come off'}</span>
      </div>
      <p className="injury-line">{line}</p>
      {deciding && (
        <div className="injury-choices">
          {knock && (
            <button className="primary" onClick={() => g.injuryPlayOn()}>
              <Icon name="play" size={13} /> Play on
            </button>
          )}
          <span className="faint">{knock ? 'or take him off for' : 'Bring on'}</span>
          <div className="injury-options">
            {isLibero && (
              <button className="injury-option" onClick={() => g.injuryTakeOff(-1)}>
                {otherLibero >= 0 ? `${store.shortName(otherLibero)} plays libero alone` : 'Go on without a libero'}
              </button>
            )}
            {options.map((o) => (
              <button key={o.p} className={`injury-option${o.pick ? ' pick' : ''}`} onClick={() => g.injuryTakeOff(o.p)}>
                <PlayerFace playerId={store.id[o.p]} name={store.fullName(o.p)} size={24} />
                <span className="injury-option-name">{store.shortName(o.p)}</span>
                <Pos pos={roles[o.p] as Position} />
                <b>{store.currentAbility[o.p]}</b>
                {o.pick && <span className="injury-flag pick">Assistant's pick</span>}
                {o.exceptional && (
                  <span className="injury-flag" title="Your six are spent: the rules allow an exceptional substitution for an injury, and it uses none of them">
                    Exceptional
                  </span>
                )}
              </button>
            ))}
            {options.length === 0 && !isLibero && !knock && (
              <button className="injury-option" onClick={() => g.injuryCarryOn()}>Nobody left — he carries on as best he can</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeoutPanel({
  secondsLeft, calledBy,
}: {
  secondsLeft: number;
  calledBy?: string;
}): JSX.Element | null {
  const g = useGame();
  const t = g.matchTactics();
  if (t === null) return null;
  return (
    <div className="timeout-panel">
      <div className="timeout-head">
        <span className="timeout-icon"><Icon name="whistle" size={22} /></span>
        <div className="timeout-title">
          <strong>Timeout{calledBy !== undefined ? ` — ${calledBy}` : ''}</strong>
          <span className="faint">Adjust the instructions here, or open Tactics for the system and each rotation — changes apply from the next rally.</span>
        </div>
        <span className="timeout-countdown">0:{secondsLeft.toString().padStart(2, '0')}</span>
        <button className="primary" onClick={() => g.resumeFromTimeout()} data-tour="resume-timeout">
          <Icon name="play" size={14} /> Resume play
        </button>
      </div>
      <div className="timeout-clock"><span style={{ width: `${(secondsLeft / TIMEOUT_SECONDS) * 100}%` }} /></div>
      <div className="grid2 timeout-fields">
        <ChoiceField
          label="Offensive system"
          value={t.offense}
          onChange={(v) => { t.offense = v; g.touch(); }}
          options={OFFENSE_OPTIONS}
        />
        <ChoiceField
          label="Tempo"
          value={t.tempo}
          onChange={(v) => { t.tempo = v; g.touch(); }}
          options={TEMPO_OPTIONS}
        />
        <ChoiceField
          label="Combination plays"
          value={combinationsOf(t)}
          onChange={(v) => { t.combinations = v; g.touch(); }}
          options={COMBINATION_OPTIONS}
        />
        <ChoiceField
          label="Defensive system"
          value={t.defense}
          onChange={(v) => { t.defense = v; g.touch(); }}
          options={DEFENSE_OPTIONS}
        />
        <ChoiceField
          label="Serve strategy"
          value={t.serve}
          onChange={(v) => { t.serve = v; g.touch(); }}
          options={SERVE_OPTIONS}
        />
      </div>
    </div>
  );
}

interface TeamLiveStats { points: number; kills: number; aces: number; blocks: number; errors: number; }

/** Running per-team totals, read off how each revealed rally ended. A block
 *  or an error is logged against the player who lost the point, so the
 *  credit for a block goes to the other side. */
function liveStats(log: readonly MatchdayLogEntry[]): [TeamLiveStats, TeamLiveStats] {
  const s: [TeamLiveStats, TeamLiveStats] = [
    { points: 0, kills: 0, aces: 0, blocks: 0, errors: 0 },
    { points: 0, kills: 0, aces: 0, blocks: 0, errors: 0 },
  ];
  for (const { entry } of log) {
    s[entry.winner].points++;
    const last = entry.contacts[entry.contacts.length - 1];
    if (last === undefined) continue;
    if (entry.overturned === true) {
      // Turned over on video: a kill or an ace out, a stuff block with the blocker in the net —
      // errors; an attack called out that was in, or off the block, a kill; a blocker in the net, his error.
      if (last.kind === 'attackError' && entry.doubt !== 'netTouch') s[last.team].kills++;
      else s[1 - entry.winner].errors++;
      continue;
    }
    switch (last.kind) {
      case 'kill': s[last.team].kills++; break;
      case 'ace': s[last.team].aces++; break;
      case 'blocked': s[1 - last.team].blocks++; break;
      case 'attackError': case 'serveError': case 'receptionError': case 'setError': case 'digError':
        s[last.team].errors++;
        break;
      default: break;
    }
  }
  return s;
}

/** Final scores of every set already finished, from the last rally of each. */
/**
 * The rest of the round, alongside: each match at the same point of the evening as the manager's —
 * its sets so far and the one under way — and the table if they all ended now.
 */
function AroundPanel({ around, progress, own }: {
  around: AroundTheLeague;
  progress: Progress;
  own: { home: number; away: number; homeSets: number; awaySets: number };
}): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const me = world.userClubId;
  const name = (id: number): string => world.clubs[id]?.shortName ?? '?';
  const games = around.ids.map((id) => world.fixtures[id]).filter((f) => f !== undefined).map((f) => {
    const now = asItStands(f, progress);
    const won = now.sets.reduce((s, [h, a]) => [s[0] + (h > a ? 1 : 0), s[1] + (a > h ? 1 : 0)], [0, 0]);
    return { f, now, homeSets: won[0], awaySets: won[1] };
  });
  const table = liveTable(around.base, [own, ...games.map((x) => ({ home: x.f.home, away: x.f.away, homeSets: x.homeSets, awaySets: x.awaySets }))]);
  return (
    <div className="lv-around">
      <div className="lv-around-games">
        {games.map(({ f, now, homeSets, awaySets }) => (
          <div key={f.id} className="lv-around-game">
            <span className="lv-around-team">{name(f.home)}</span>
            <b className="lv-around-sets">{homeSets}–{awaySets}</b>
            <span className="lv-around-team away">{name(f.away)}</span>
            <span className={`lv-around-now${now.done ? ' done' : ''}`}>
              {now.done ? 'FT' : now.live !== null ? `${now.live[0]}-${now.live[1]}` : ''}
            </span>
          </div>
        ))}
      </div>
      <div className="lv-around-sub">As it stands</div>
      <table className="lv-around-table">
        <tbody>
          {table.map((r, i) => {
            const move = r.was - (i + 1);
            return (
              <tr key={r.clubId} className={r.clubId === me ? 'me' : ''}>
                <td className="num">{i + 1}</td>
                <td className={`mv ${move > 0 ? 'up' : move < 0 ? 'down' : ''}`}>{move > 0 ? '▲' : move < 0 ? '▼' : ''}</td>
                <td className="club">{name(r.clubId)}</td>
                <td className="num faint">{r.played}</td>
                <td className="num pts">{r.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function completedSets(log: readonly MatchdayLogEntry[], currentSet: number, matchOver: boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const last = new Map<number, MatchdayLogEntry>();
  for (const l of log) last.set(l.entry.set, l);
  for (const [set, l] of [...last.entries()].sort((a, b) => a[0] - b[0])) {
    if (set >= currentSet && !matchOver) continue;
    const e = l.entry;
    out.push([e.scoreBefore[0] + (e.winner === 0 ? 1 : 0), e.scoreBefore[1] + (e.winner === 1 ? 1 : 0)]);
  }
  return out;
}


const STAT_ROWS: ReadonlyArray<[keyof TeamLiveStats, string]> = [
  ['points', 'Points won'],
  ['kills', 'Kills'],
  ['aces', 'Aces'],
  ['blocks', 'Blocks'],
  ['errors', 'Errors'],
];

/** The players on court for a side, in the order a team sheet lists them: setter, hitters, middles, libero. */
const ROLE_ORDER: Readonly<Record<Position, number>> = {
  [Position.Setter]: 0, [Position.OutsideHitter]: 1, [Position.Opposite]: 2, [Position.MiddleBlocker]: 3, [Position.Libero]: 4,
};

/** What a shout sounded like from the touchline, and how it landed. */
const SHOUT_LINES: Readonly<Record<ShoutKind, { label: string; hint: string; line: string }>> = {
  encourage: { label: 'Encourage', hint: 'Lift the side', line: 'Come on — keep going!' },
  demand: { label: 'Demand more', hint: 'Best when behind', line: 'Is that all you have got?!' },
  calm: { label: 'Calm down', hint: 'Settle a side in a slump', line: 'Breathe — one point at a time.' },
};
const SHOUT_EFFECT: Readonly<Record<'lifted' | 'flat' | 'tense', string>> = {
  lifted: 'the side responds',
  flat: 'it changes little',
  tense: 'they tighten up',
};

/** The match's sounds, on or off — remembered in this browser. */
function SoundToggle(): JSX.Element {
  const [on, setOn] = useState(soundOn);
  return (
    <button className={on ? '' : 'muted'} title={on ? 'Sound on — click to mute' : 'Sound off — click to hear the match'}
      onClick={() => { setSoundOn(!on); setOn(!on); }}>
      <Icon name={on ? 'sound' : 'mute'} size={15} />
    </button>
  );
}

/**
 * The video check, over the court: who asked and what, the replay running
 * underneath like the television's — then the verdict, stamped.
 */
function VideoCheck({ review, side, kit }: { review: VideoReview; side: MatchSide; kit: Kit }): JSX.Element {
  const g = useGame();
  const v = review.verdict;
  const contacts = review.log.entry.contacts;
  const blockout = review.call === 'kill' && contacts[contacts.length - 1]?.shot === 'blockout';
  return (
    <div className={`vr${v !== null ? ' decided' : ''}`}>
      <div className="vr-top">
        <span className="vr-tag"><i className="vr-rec" /> Video check</span>
        <span className="vr-ask">
          <b style={{ borderColor: kit.shirt }}>{side.shortName}</b>
          <span className="vr-check">{CHALLENGE_CHECK_NAMES[review.check]}</span>
          {checkQuestion(review.call, blockout, review.check)}
        </span>
        {v === null && <span className="vr-replay">Replay</span>}
      </div>
      {v !== null && (
        <div className={`vr-verdict ${v.overturned ? 'over' : 'stands'}`}>
          {v.mark !== undefined && <BallMarkView mark={v.mark} />}
          <b>{v.overturned ? 'Overturned' : 'Call stands'}</b>
          <span>{v.text}</span>
          <em>{v.overturned ? `${side.shortName} keep their challenge` : `${side.shortName} lose a challenge`}</em>
        </div>
      )}
      {v === null && (
        <button className="sm vr-skip" onClick={() => g.finishVideoReview()}>
          <Icon name="forward" size={13} /> Skip to the verdict
        </button>
      )}
    </div>
  );
}

/**
 * The video's ball mark, the way the broadcast shows it: the floor seen from
 * straight above, close up — the court, the line, the floor beyond it — and
 * the ball's footprint where it came down, with the ball's size around it.
 * In if any of the footprint is on the line.
 */
function BallMarkView({ mark }: { mark: BallMark }): JSX.Element {
  // Metres from the line's outer edge, outwards positive: the ball's centre.
  const centre = mark.gap + BALL_FOOTPRINT;
  const ballR = 0.105;
  // A window wide enough for both the line and the ball, however far out it went.
  const x0 = Math.min(-0.32, centre - ballR - 0.08);
  const x1 = Math.max(0.32, centre + ballR + 0.08);
  const h = (x1 - x0) * 0.56;
  const isIn = mark.gap <= 0;
  const lineName = mark.line === 'end' ? 'End line' : 'Sideline';
  return (
    <div className={`vr-mark ${isIn ? 'in' : 'out'}`}>
      <svg viewBox={`${x0} ${-h / 2} ${x1 - x0} ${h}`} preserveAspectRatio="xMidYMid meet" aria-label={`Ball mark: ${isIn ? 'in' : 'out'}`}>
        {/* The court, the line on its edge, and the floor beyond. */}
        <rect x={x0} y={-h / 2} width={-x0} height={h} fill="#c76f36" />
        <rect x={0} y={-h / 2} width={x1} height={h} fill="#2b5c8c" />
        <rect x={-0.05} y={-h / 2} width={0.05} height={h} fill="#f4f1ea" />
        {/* The whole ball, for its size, and the footprint it left. */}
        <circle cx={centre} cy={0} r={ballR} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={0.004} strokeDasharray="0.012 0.01" />
        <ellipse cx={centre} cy={0} rx={BALL_FOOTPRINT} ry={BALL_FOOTPRINT * 1.35} fill={isIn ? 'rgba(46, 204, 113, 0.85)' : 'rgba(231, 76, 60, 0.85)'}
          stroke="#fff" strokeWidth={0.004} className="vr-mark-ball" />
      </svg>
      <div className="vr-mark-read">
        <span>{lineName}</span>
        <b>{isIn ? 'IN' : 'OUT'}</b>
        <span>{gapWords(mark.gap)}</span>
      </div>
    </div>
  );
}

/** The question a check puts to the video, on the call the referee made. */
function checkQuestion(call: LastCall['call'], blockout: boolean, check: ChallengeCheck): string {
  if (check === 'inOut') return call === 'attackError' ? 'Was the ball in?' : call === 'ace' ? 'Was the serve out?' : 'Was the ball out?';
  if (check === 'blockTouch') return blockout ? 'Did it really touch the block?' : 'Did it come off the block?';
  return call === 'kill' ? 'Did the hitter touch the net?' : 'Did a blocker touch the net?';
}

/** What looked close on a point, as everyone saw it. */
const DOUBT_WORDS: Readonly<Record<ChallengeCheck, string>> = {
  inOut: 'right on the line', blockTouch: 'a touch off the block?', netTouch: 'was that the net?',
};

/**
 * The video challenge: the bench says what the video should look at — the
 * line, a touch off the block, the net. Right about the thing the referee
 * missed, the point is turned over and the challenge kept; anything else, the
 * call stands and the challenge is gone.
 */
function ChallengeButton({ shown, onOpen }: { shown: boolean; onOpen: (open: boolean) => void }): JSX.Element {
  const g = useGame();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  // While the bench decides what to ask, the referee holds the next serve.
  useEffect(() => {
    onOpen(open);
  }, [open]);
  useEffect(() => () => onOpen(false), []);
  // Not before the point has been played out on the court: nobody challenges what he hasn't seen.
  const why = shown ? g.challengeError() : 'Wait for the point to finish.';
  const call = g.lastCall();
  const close = why === null && call !== null && call.close;
  useEffect(() => {
    if (why !== null) setOpen(false);
  }, [why]);
  return (
    <div className="lv-shout" ref={ref} data-tour="challenge">
      <button className={`${close ? 'hot' : ''}${open ? ' on' : ''}`} disabled={why !== null} onClick={() => setOpen((o) => !o)}
        title={why ?? (close && call?.doubt != null ? `That looked close — ${DOUBT_WORDS[call.doubt]}` : 'Ask the video to look at one thing')}>
        <Icon name="search" size={15} /> Challenge <span className="lv-badge">{g.challengesLeft()}</span>
      </button>
      {open && why === null && call !== null && (
        <div className="menu-pop lv-shout-menu lv-challenge-menu">
          <div className="lv-challenge-head">What should the video look at?</div>
          {challengeChecksFor(call.call, call.blockout).map((c) => (
            <button key={c} onClick={() => { setOpen(false); g.challenge(c); }}>
              <span className="menu-pop-stack">
                <span>{CHALLENGE_CHECK_NAMES[c]}{call.doubt === c && <span className="lv-close-tag">Looked close</span>}</span>
                <span className="faint">{checkQuestion(call.call, call.blockout, c)}</span>
              </span>
            </button>
          ))}
          <p className="lv-challenge-note">Right, and the point is yours and you keep the challenge. Wrong, and it is lost.</p>
        </div>
      )}
    </div>
  );
}

/** A side's six on court and its libero, each with the live rating — the panel down either side of the court. */
function LiveTeamCard({ team, serving, ratings, onPick }: {
  team: 0 | 1;
  serving: boolean;
  ratings: Map<number, number>;
  /** The user's own side: a player clicked, for his options. */
  onPick?: (p: number, row: DOMRect) => void;
}): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;
  const side = md.sides[team];
  const roles = g.liveRoles();
  const court = (team === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  const libero = (team === 0 ? md.snapshot?.homeLibero : md.snapshot?.awayLibero) ?? -1;
  const rows = [...court, ...(libero >= 0 ? [libero] : [])]
    .filter((p, i, all) => all.indexOf(p) === i)
    .sort((a, b) => ROLE_ORDER[roles[a] as Position] - ROLE_ORDER[roles[b] as Position]);
  const knocks = g.liveKnocks();
  return (
    <section className="card lv-team">
      <header className="lv-team-head">
        <SideCrest side={side} size={22} />
        <strong>{side.name}</strong>
        <span className={`lv-serve-dot${serving ? ' on' : ''}`} title={serving ? 'Serving' : undefined} />
      </header>
      <div className="lv-team-rows">
        {rows.map((p) => {
          const r = ratings.get(p);
          return (
            <div
              key={p}
              className={`lv-team-row${onPick !== undefined ? ' pickable' : ''}`}
              onClick={(e) => (onPick !== undefined ? onPick(p, e.currentTarget.getBoundingClientRect()) : g.select(p))}
              title={onPick !== undefined ? `${store.fullName(p)} — click to change him` : store.fullName(p)}
            >
              <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={22} />
              <span className="lv-team-name">
                {store.shortName(p).split(' ').pop()}
                {knocks.has(p) && <span className="lv-knock" title="Playing on with a knock — below his best, and it may get worse">+</span>}
              </span>
              <Pos pos={roles[p] as Position} />
              {r !== undefined ? <RatingBadge value={r} size="sm" /> : <span className="lv-rating-none">—</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * One of the user's players clicked beside the court: who could come on for
 * him — like for like first, the assistant's eye on who is warm — and, for
 * any who can't, why not. A libero's are the other liberos.
 */
function QuickSub({ at, onClose }: {
  at: { p: number; x: number; y: number; side: 'left' | 'right' };
  onClose: () => void;
}): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  const roles = g.liveRoles();
  const liberos = g.liveLiberos();
  const p = at.p;
  const isLibero = p === liberos.reception || p === liberos.defence;
  const options = g.subOptionsFor(p);
  const ref = useDismiss(true, onClose);
  const width = 300;
  const left = at.side === 'left' ? at.x : at.x - width;
  const top = Math.max(8, Math.min(at.y, window.innerHeight - 360));
  return (
    <div ref={ref} className="lv-quicksub" style={{ left, top, width }}>
      <header className="lv-quicksub-head">
        <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={30} />
        <div>
          <b>{store.fullName(p)}</b>
          <span className="faint">
            {isLibero ? 'Libero — changes are free and unlimited' : `Bring on for him · ${g.subsRemaining()} left this set`}
          </span>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={14} /></button>
      </header>
      <div className="lv-quicksub-list">
        {options.length === 0 && <p className="faint lv-quicksub-none">Nobody on the bench can come on for him.</p>}
        {options.map((o) => {
          const cold = g.warmthOf(o.p) < WARM_READY;
          return (
            <button
              key={o.p}
              className="lv-quicksub-opt"
              disabled={o.why !== null}
              title={o.why ?? (cold ? 'Not warmed up — he risks a strain' : undefined)}
              onClick={() => {
                if (isLibero) g.changeLibero(p === liberos.reception ? 'reception' : 'defence', o.p);
                else g.substitute(p, o.p);
                onClose();
              }}
            >
              <PlayerFace playerId={store.id[o.p]} name={store.fullName(o.p)} size={24} />
              <span className="lv-quicksub-name">{store.shortName(o.p)}</span>
              <Pos pos={roles[o.p] as Position} />
              <b>{store.currentAbility[o.p]}</b>
              {o.why === null && <span className={`lv-quicksub-warm${cold ? ' cold' : ''}`}>{cold ? 'Cold' : 'Ready'}</span>}
            </button>
          );
        })}
      </div>
      <footer className="lv-quicksub-foot">
        <button className="link" onClick={() => { g.select(p); onClose(); }}>His profile <Icon name="arrowRight" size={12} /></button>
      </footer>
    </div>
  );
}

/** What switching system takes on court: who could make way, who could come on, and the obvious pair. */
interface SystemChange {
  out: number[];
  in: number[];
  why: string;
}

/**
 * The substitution a change of system needs, or null if the six on court
 * already fit it: a 4-2 wants a second setter, diagonal to the first — so on
 * for the opposite; a 5-1 wants one, so an opposite on for the other.
 */
function systemChangeFor(
  store: PlayerStore, roles: ArrayLike<number>, target: Formation, court: readonly number[], bench: readonly number[],
): SystemChange | null {
  const pos = (p: number): Position => roles[p] as Position;
  const best = (ps: number[]): number[] => [...ps].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const setters = court.filter((p) => pos(p) === Position.Setter);
  if (target === Formation.FourTwo) {
    if (setters.length >= 2) return null;
    const zone = court.findIndex((p) => pos(p) === Position.Setter);
    const diagonal = zone >= 0 ? court[(zone + 3) % 6] : -1;
    const rank = (p: number): number => (p === diagonal ? 0 : pos(p) === Position.Opposite ? 1 : 2);
    return {
      out: court.filter((p) => pos(p) !== Position.Setter && pos(p) !== Position.Libero).sort((a, b) => rank(a) - rank(b)),
      in: best(bench.filter((p) => pos(p) === Position.Setter)),
      why: 'A 4-2 plays two setters, diagonal to each other: a second one comes on, for the opposite.',
    };
  }
  if (setters.length <= 1) return null;
  return {
    // The weaker of the two makes way.
    out: [...setters].sort((a, b) => store.currentAbility[a] - store.currentAbility[b]),
    in: [
      ...best(bench.filter((p) => pos(p) === Position.Opposite)),
      ...best(bench.filter((p) => pos(p) === Position.OutsideHitter)),
    ],
    why: 'A 5-1 runs on one setter: an opposite comes on for the other.',
  };
}

/** The system the side plays, and the switch to the other — with the substitution it takes. */
function LiveSystem({ tactics, target, onTarget }: {
  tactics: TeamTactics;
  target: Formation | null;
  onTarget: (f: Formation | null) => void;
}): JSX.Element {
  const g = useGame();
  const md = g.matchday!;
  const store = g.world!.players;
  const team: 0 | 1 = md.userIsHome ? 0 : 1;
  const court = (team === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  const liberos = g.liveLiberos();
  const roles = g.liveRoles();
  const named = new Set(g.matchLiberosOf(team));
  const bench = g.matchSquadOf(team).filter((p) => !court.includes(p) && g.matchAvailable(p)
    && !named.has(p) && p !== liberos.reception && p !== liberos.defence);
  const playing = formationOf(tactics);
  const pending = target !== null && target !== playing ? target : null;
  const change = pending !== null ? systemChangeFor(store, roles, pending, court, bench) : null;
  const [out, setOut] = useState<number | null>(null);
  const [inc, setInc] = useState<number | null>(null);
  useEffect(() => { setOut(null); setInc(null); }, [pending]);
  const remaining = g.subsRemaining();
  const outP = out ?? change?.out[0] ?? -1;
  const inP = inc ?? change?.in[0] ?? -1;

  const name = (p: number): string => store.shortName(p);
  const setters = court.filter((p) => roles[p] === Position.Setter);
  const opposite = court.find((p) => roles[p] === Position.Opposite);
  const now = playing === Formation.FourTwo && setters.length >= 2
    ? `${name(setters[0])} and ${name(setters[1])} set, from the back row`
    : `${setters.length > 0 ? `${name(setters[0])} sets` : 'No setter on court'}${opposite !== undefined ? ` · ${name(opposite)} opposite` : ''}`;

  const pick = (f: Formation): void => {
    if (f === playing) { onTarget(null); return; }
    if (systemChangeFor(store, roles, f, court, bench) === null) {
      g.changeLiveFormation(f);
      onTarget(null);
      return;
    }
    onTarget(f);
  };
  const blocked = md.setBreakPending
    ? 'The set is over: change it at the set break.'
    : change === null ? null
      : remaining <= 0 ? 'No substitutions left this set: the change can be made at the set break.'
        : change.in.length === 0
          ? pending === Formation.FourTwo ? 'There is no setter on the bench to bring on.' : 'There is no opposite or outside hitter on the bench to bring on.'
          : null;
  const option = (p: number): { value: number; label: string; hint: string } => ({
    value: p, label: name(p), hint: `${POSITION_SHORT[store.position[p] as Position]} · ${store.currentAbility[p]}`,
  });

  return (
    <section className="lv-sys">
      <div className="lv-sys-head">
        <div className="lv-sys-now">
          <span className="lv-tac-label">System</span>
          <b>{FORMATION_NAMES[playing]}</b>
          <span className="faint">{now}</span>
        </div>
        <Segmented<Formation>
          options={[[Formation.FiveOne, '5-1 · one setter'], [Formation.FourTwo, '4-2 · two setters']]}
          value={pending ?? playing}
          onChange={pick}
        />
      </div>
      {pending !== null && (
        <div className="lv-sys-change">
          <p>{change?.why ?? `The six on court already fit a ${FORMATION_NAMES[pending]}.`}</p>
          {change !== null && change.in.length > 0 && (
            <div className="lv-sys-swap">
              <div className="lv-sys-pick">
                <span className="lv-tac-label">Off</span>
                <Dropdown size="sm" value={outP} options={change.out.map(option)} onChange={setOut} />
              </div>
              <Icon name="swap" size={16} />
              <div className="lv-sys-pick">
                <span className="lv-tac-label">On</span>
                <Dropdown size="sm" value={inP} options={change.in.map(option)} onChange={setInc} />
              </div>
            </div>
          )}
          {blocked !== null && <p className="lv-sys-blocked"><Icon name="alert" size={13} /> {blocked}</p>}
          <div className="lv-sys-actions">
            <button
              className="primary sm"
              disabled={blocked !== null || (change !== null && (outP < 0 || inP < 0))}
              onClick={() => {
                g.changeLiveFormation(pending, change === null ? undefined : { out: outP, in: inP });
                onTarget(null);
              }}
            >
              <Icon name="check" size={13} />
              {change === null ? ` Switch to ${FORMATION_NAMES[pending]}` : ` Make the change · uses 1 of ${remaining} subs`}
            </button>
            <button className="sm ghost" onClick={() => onTarget(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Each rotation's instructions, the one the side stands in now first. */
function LiveRotations({ tactics, current }: { tactics: TeamTactics; current: number }): JSX.Element {
  const g = useGame();
  const [rot, setRot] = useState(current);
  const r = tactics.rotations[rot];
  const fourTwo = formationOf(tactics) === Formation.FourTwo;
  const setterFront = !fourTwo && rot >= 1 && rot <= 3;
  const copyToAll = (): void => {
    for (let i = 0; i < tactics.rotations.length; i++) if (i !== rot) tactics.rotations[i] = { ...r };
    g.touch();
  };
  return (
    <div className="lv-rot">
      <div className="lv-rot-tabs">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <button key={i} className={`lv-rot-tab${i === rot ? ' active' : ''}${i === current ? ' now' : ''}`} onClick={() => setRot(i)}>
            <b>P{i + 1}</b>
            <span>{i === current ? 'Now' : !fourTwo && i >= 1 && i <= 3 ? 'Setter front' : 'Setter back'}</span>
          </button>
        ))}
      </div>
      <div className="lv-rot-meta">
        <span className={`rot-flag${setterFront ? ' warn' : ''}`}>
          {fourTwo ? 'A setter always in the back row · three attackers' : setterFront ? 'Setter front row · two attackers' : 'Setter back row · three attackers'}
        </span>
        <button className="sm ghost" onClick={copyToAll} title={`Every rotation gets P${rot + 1}'s instructions`}>
          <Icon name="swap" size={13} /> Use for every rotation
        </button>
      </div>
      <div className="grid2 timeout-fields lv-rot-fields">
        <ChoiceField label="Preferred attacker" value={r.preferredAttacker} onChange={(v) => { r.preferredAttacker = v; g.touch(); }} options={ATTACKER_OPTIONS} />
        <ChoiceField label="Serve receive" value={r.receivers ?? 3} onChange={(v) => { r.receivers = v === 3 ? undefined : v; g.touch(); }} options={RECEPTION_OPTIONS} />
        <ChoiceField label="Serve target" value={r.serveTarget} onChange={(v) => { r.serveTarget = v; g.touch(); }} options={SERVE_TARGET_OPTIONS} />
        <ChoiceField label="Block assignment" value={r.blockAssignment} onChange={(v) => { r.blockAssignment = v; g.touch(); }} options={BLOCK_OPTIONS} />
        <ChoiceField label="Defensive shape" value={r.defensiveShape} onChange={(v) => { r.defensiveShape = v; g.touch(); }} options={SHAPE_OPTIONS} />
        <SliderField label="Back-row transition" value={r.transitionBackRow} onChange={(v) => { r.transitionBackRow = v; g.touch(); }} left="Rarely" right="Often" />
        <SliderField label="Setter tempo bias" value={r.setterTempoBias} onChange={(v) => { r.setterTempoBias = v; g.touch(); }} left="Slower" right="Quicker" />
      </div>
    </div>
  );
}

/**
 * The tactics, changed during the match — the same object the engine reads,
 * so a change applies from the next rally: the system (with the substitution
 * a switch takes), the team instructions, each rotation's, or another saved
 * tactic altogether.
 */
function TacticsOverlay({ onClose }: { onClose: () => void }): JSX.Element | null {
  const g = useGame();
  const md = g.matchday!;
  const t = g.matchTactics();
  const [tab, setTab] = useState<'team' | 'rotations'>('team');
  /** A system picked that takes a substitution to play — waiting on who goes off and who comes on. */
  const [target, setTarget] = useState<Formation | null>(null);
  if (t === null) return null;
  const saved = md.national === null ? g.savedTactics() : null;
  const rotation = (md.userIsHome ? md.snapshot?.homeRotation : md.snapshot?.awayRotation) ?? 0;
  return (
    <div className="lv-overlay lv-tac">
      <header className="lv-overlay-head">
        <strong><Icon name="tactics" size={16} /> Tactics</strong>
        <Segmented<'team' | 'rotations'> size="sm" options={[['team', 'Team'], ['rotations', 'Rotations']]} value={tab} onChange={setTab} />
        <span className="faint">Changes apply from the next rally.</span>
        {saved !== null && saved.slots.length >= 2 && (
          <Dropdown
            size="sm"
            className="lv-tac-load"
            title="Load another of your tactics"
            value={saved.active}
            onChange={(i) => {
              const f = g.loadTacticInMatch(i);
              if (f !== null && f !== formationOf(t)) {
                setTab('team');
                setTarget(f);
              }
            }}
            options={saved.slots.map((s, i) => ({ value: i, label: s.name, hint: FORMATION_NAMES[formationOf(s.tactics)] }))}
          />
        )}
        <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
      </header>
      <div className="lv-overlay-body">
        {tab === 'team'
          ? (
            <>
              <LiveSystem tactics={t} target={target} onTarget={setTarget} />
              <TacticsBoard tactics={t} onChange={() => g.touch()} compact />
            </>
          )
          : <LiveRotations tactics={t} current={rotation} />}
      </div>
    </div>
  );
}

function LiveMatchView(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;
  const snap = md.snapshot;
  const logRef = useRef<HTMLDivElement>(null);
  // The user's side plays in the half nearest the camera.
  const nearTeam: 0 | 1 = md.userIsHome ? 0 : 1;
  const [scene, setScene] = useState<Scene>(() => sceneFor(md.snapshot, g.liveRoles(), nearTeam, store));
  const [labels, setLabels] = useState<CourtLabels>('ratings');
  const [overlay, setOverlay] = useState<'subs' | 'tactics' | null>(null);
  /** One of the user's players clicked beside the court: his options, by the row. */
  const [quick, setQuick] = useState<{ p: number; x: number; y: number; side: 'left' | 'right' } | null>(null);
  const openSubs = (): void => {
    setQuick(null);
    setOverlay('subs');
  };
  const closeOverlay = (): void => setOverlay(null);
  const pickPlayer = (p: number, row: DOMRect, side: 'left' | 'right'): void => {
    if (overlay === 'subs') return;
    setQuick({ p, x: side === 'left' ? row.right + 8 : row.left - 8, y: row.top, side });
  };
  const closeQuick = (): void => setQuick(null);
  // The substitutions, a player's options or his profile: while any is open, play holds — and
  // going from one straight to another doesn't let a rally slip through in between.
  const [challengeOpen, setChallengeOpen] = useState(false);
  const panelOpen = overlay === 'subs' || quick !== null || g.selectedPlayer !== null || challengeOpen;
  useEffect(() => {
    if (panelOpen) g.openCoachPanel();
    else g.closeCoachPanel();
  }, [panelOpen]);
  const [shoutOpen, setShoutOpen] = useState(false);
  const shoutRef = useDismiss(shoutOpen, () => setShoutOpen(false));
  const [sideTab, setSideTab] = useState<'stats' | 'around'>('stats');
  const [ceremony, setCeremony] = useState<number | null>(null);
  /** True while a rally is being played out, so snapshot changes don't yank the court mid-rally. */
  const animatingRef = useRef(false);
  /** Who has the last points in a row, this set — for the stands. */
  const runRef = useRef<{ set: number; team: number; n: number }>({ set: 0, team: -1, n: 0 });
  const [bigPlay, setBigPlay] = useState<(BigPlay & { key: number }) | null>(null);
  const [subAnnouncement, setSubAnnouncement] = useState<{ text: string; team: 0 | 1; key: number } | null>(null);
  const [timeoutSecondsLeft, setTimeoutSecondsLeft] = useState(TIMEOUT_SECONDS);
  /** Rallies whose animation has finished — the scoreboard, commentary and
   *  stats only count these, so they change as the ball lands, not before. */
  const [revealed, setRevealed] = useState(md.log.length);
  const bigPlayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const subAnnounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Counts down a called timeout. Purely a presentation-layer clock — the
  // engine has no concept of timeouts — kept as one tick-the-clock effect...
  useEffect(() => {
    if (md.timeoutActive === null) { setTimeoutSecondsLeft(TIMEOUT_SECONDS); return; }
    setTimeoutSecondsLeft(TIMEOUT_SECONDS);
    playHooter();
    const interval = setInterval(() => {
      setTimeoutSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [md.timeoutActive]);

  // ...and one separate effect that reacts to the clock hitting zero, rather
  // than calling back into game state from inside a setState updater.
  useEffect(() => {
    if (md.timeoutActive !== null && timeoutSecondsLeft === 0) g.resumeFromTimeout();
  }, [md.timeoutActive, timeoutSecondsLeft]);

  const [radar, setRadar] = useState<(Radar & { key: number }) | null>(null);
  /** The video's close-up on where the ball came down, while it runs. */
  const [varZoom, setVarZoom] = useState<{ x: number; y: number } | null>(null);
  const radarTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const triggerRadar = (r: Radar): void => {
    setRadar({ ...r, key: Date.now() });
    clearTimeout(radarTimer.current);
    radarTimer.current = setTimeout(() => setRadar(null), RADAR_MS / (g.matchday?.speed ?? 1));
  };

  /** How each side defends right now: the user's as set, the other as its club has it. */
  const defenceNow = (team: 0 | 1): DefenceLayouts | undefined => {
    const now = g.matchday;
    if (now === null) return undefined;
    if (team === (now.userIsHome ? 0 : 1)) return defenceLayoutsOf(g.matchTactics() ?? undefined);
    const club = now.sides[team].clubId >= 0 ? world.clubs[now.sides[team].clubId] : undefined;
    return club !== undefined ? defenceLayoutsOf(club.tactics) : undefined;
  };

  const triggerBigPlay = (play: BigPlay): void => {
    setBigPlay({ ...play, key: Date.now() });
    if (bigPlayTimer.current !== undefined) clearTimeout(bigPlayTimer.current);
    bigPlayTimer.current = setTimeout(() => setBigPlay(null), bigPlayMs(play));
  };

  // Announces every substitution live, either side — driven off state.ts's
  // own record of the last one rather than the call site, since it can come
  // from the user's Substitutions panel or from the AI's own decisions.
  const lastSubSeq = md.lastSubstitution?.seq;
  useEffect(() => {
    const sub = md.lastSubstitution;
    if (sub === null) return;
    const teamName = md.sides[sub.team].shortName;
    const text = sub.libero !== undefined
      ? `${teamName}: ${store.shortName(sub.inPlayerIdx)} in as ${sub.libero === 'reception' ? 'reception' : 'defensive'} libero`
      : sub.plan !== undefined
        ? `${teamName} · ${sub.plan}: ${store.shortName(sub.inPlayerIdx)} ON for ${store.shortName(sub.outPlayerIdx)}${
          sub.also !== undefined ? `, ${store.shortName(sub.also.inPlayerIdx)} ON for ${store.shortName(sub.also.outPlayerIdx)}` : ''}`
        : `${teamName}: ${store.shortName(sub.inPlayerIdx)} ON for ${store.shortName(sub.outPlayerIdx)}${
          sub.reason === 'fatigue' ? ' (tired)' : sub.reason === 'form' ? ' (struggling)' : ''}`;
    setSubAnnouncement({ text, team: sub.team, key: sub.seq });
    if (subAnnounceTimer.current !== undefined) clearTimeout(subAnnounceTimer.current);
    subAnnounceTimer.current = setTimeout(() => setSubAnnouncement(null), 3000);
  }, [lastSubSeq]);

  // A shout from the touchline goes up on the same banner.
  const lastShoutSeq = md.lastShout?.seq;
  useEffect(() => {
    const s = md.lastShout;
    if (s == null) return;
    const team: 0 | 1 = md.userIsHome ? 0 : 1;
    setSubAnnouncement({ text: `“${SHOUT_LINES[s.kind].line}” — ${SHOUT_EFFECT[s.effect]}`, team, key: s.seq });
    if (subAnnounceTimer.current !== undefined) clearTimeout(subAnnounceTimer.current);
    subAnnounceTimer.current = setTimeout(() => setSubAnnouncement(null), 3000);
  }, [lastShoutSeq]);

  /** A line on the banner, for either side. */
  const announce = (text: string, team: 0 | 1): void => {
    setSubAnnouncement({ text, team, key: Date.now() });
    if (subAnnounceTimer.current !== undefined) clearTimeout(subAnnounceTimer.current);
    subAnnounceTimer.current = setTimeout(() => setSubAnnouncement(null), 3200);
  };

  /**
   * Someone hurt: he goes down, the physio comes on and down beside him; the
   * coach makes his call — the user, for his own; the engine has made it for
   * the other side — and he is up and playing on, or helped off and someone
   * else on.
   */
  const playInjury = async (live: LiveInjury, speed: number, cancelled: { current: boolean }): Promise<void> => {
    const who = store.shortName(live.inj.p);
    const side = live.inj.team;
    const sideName = g.matchday?.sides[side].shortName ?? '';
    announce(`${sideName}: ${who} is down — ${(INJURY_NAMES[live.inj.type] ?? 'hurt').toLowerCase()}`, side);
    await sleep(1500 / speed);
    if (cancelled.current) return;
    g.setInjuryPhase('treat');
    await sleep(2200 / speed);
    if (cancelled.current) return;
    if (g.injuryNeedsCall(live)) {
      g.setInjuryPhase('decide');
      while (!cancelled.current && g.matchday?.injury?.phase === 'decide') await sleep(150);
    } else {
      g.setInjuryPhase(live.inj.off === true ? 'off' : 'up');
    }
    if (cancelled.current) return;
    const off = g.matchday?.injury?.phase === 'off';
    const by = live.inj.replacedBy ?? -1;
    announce(off ? `${sideName}: ${who} helped off${by >= 0 ? ` — ${store.shortName(by)} on` : ''}` : `${sideName}: ${who} plays on`, side);
    await sleep((off ? 3400 : 1700) / speed);
    g.endInjuryStoppage();
  };

  // Drives the match forward itself: play a rally, animate it, repeat.
  // No timer in state.ts — pacing is entirely a presentation concern here.
  useEffect(() => {
    // Each mount runs its own loop with its own stop flag. React's development
    // StrictMode mounts the view twice; a flag shared between mounts let the
    // discarded first loop run on beside the real one, two rallies animating
    // over each other on the one court.
    const cancelled = { current: false };
    const run = async (): Promise<void> => {
      // A moment before the first serve, for the referee to wave it on — which
      // also stops a throwaway mount before it has played a single rally.
      await sleep(1200 / (g.matchday?.speed ?? 1));
      // The very start of the match: the warm-up, the line-up and the hands at the net first.
      if (!cancelled.current && (g.matchday?.log.length ?? 1) === 0) {
        setCeremony(Date.now());
        await sleep(6600 / (g.matchday?.speed ?? 1));
      }
      // A rally left half shown when this view went away: its ball is dead now.
      if (!cancelled.current && g.matchday?.ballInPlay === true) g.deadBall();
      let stopped = false;
      let fromTimeout = false;
      while (!cancelled.current) {
        const current = g.matchday;
        if (current === null) break;
        if (current.paused) {
          stopped = true;
          if (current.timeoutActive !== null) fromTimeout = true;
          // A substitution stoppage ends by itself once its wall-clock time is
          // up — but never while a timeout is open, which only the clock or
          // the Resume button may close.
          if (current.pauseUntil !== null && current.timeoutActive === null && current.coachPanel !== true && Date.now() >= current.pauseUntil) {
            g.resume();
            continue;
          }
          await sleep(150);
          continue;
        }
        if (stopped) {
          // Play back on: a moment for the referee to wave the serve on — longer after a
          // time-out, for both sides to come back from their benches.
          stopped = false;
          await sleep((fromTimeout ? 2600 : 1100) / current.speed);
          fromTimeout = false;
          continue;
        }
        // The set's last point: either bench may still ask for the video. Once
        // the window is over — and any video seen — the referee closes the set.
        if (current.setEnding === true) {
          if (Date.now() < (current.setEndsAt ?? 0)) {
            await sleep(150);
            continue;
          }
          const closed = g.closeDecidedSet();
          if (closed === 'match') {
            // Full time: on to the report — or, a final, the trophy first.
            if (g.matchday?.final != null) g.liftTrophy();
            else g.completeMatchday();
            break;
          }
          if (closed === 'set') {
            g.openSetBreak();
            break;
          }
          continue;
        }
        // A set won while this view was away (it unmounted mid-pause) still
        // needs its break before another rally can be played.
        if (current.setBreakPending) {
          g.openSetBreak();
          break;
        }
        // The server goes to his spot behind the end line, and a ball kid gives him the ball, before
        // the referee waves him on — never a serve from inside the court, nor with a ball still on
        // it. (A court not being drawn holds nobody up.)
        for (let waited = 0; waited < 9000 && !cancelled.current && !document.hidden && !serverReadyOnCourt(); waited += 100) {
          await sleep(100);
        }
        if (cancelled.current) break;
        animatingRef.current = true;
        playWhistle();
        const logEntry = g.playNextRally();
        if (logEntry === null) { animatingRef.current = false; break; }
        await animateRally(logEntry, g.liveRoles(), nearTeam, current.speed, cancelled, setScene, triggerBigPlay, triggerRadar, (team) => {
          // The user's side defends as set now; the other as its club has it.
          const userTeam = current.userIsHome ? 0 : 1;
          if (team === userTeam) return defenceLayoutsOf(g.matchTactics() ?? undefined);
          const club = current.sides[team].clubId >= 0 ? world.clubs[current.sides[team].clubId] : undefined;
          return club !== undefined ? defenceLayoutsOf(club.tactics) : undefined;
        }, (entry) => {
          // The stands: the home side cheered, a run sung, the visitors' big points booed.
          const run = runRef.current;
          if (run.set !== entry.set) { run.set = entry.set; run.team = -1; run.n = 0; }
          if (run.team === entry.winner) run.n++;
          else { run.team = entry.winner; run.n = 1; }
          const after: [number, number] = [entry.scoreBefore[0], entry.scoreBefore[1]];
          after[entry.winner]++;
          const target = entry.set >= 5 ? 15 : 25;
          const big = after[entry.winner] >= target - 1 && after[entry.winner] > after[1 - entry.winner];
          playPointCrowd({ winner: entry.winner, home: current.fixture.neutralVenue ? null : 0, run: run.n, big });
        });
        animatingRef.current = false;
        if (cancelled.current) break;
        setRevealed(g.matchday?.log.length ?? 0);
        // Anyone hurt in that rally: the stoppage for him, played out on the court.
        if (g.matchday?.snapshot?.matchOver !== true) {
          for (let live = g.beginInjuryStoppage(); live !== null && !cancelled.current; live = g.beginInjuryStoppage()) {
            await playInjury(live, current.speed, cancelled);
          }
          if (cancelled.current) break;
        }
        // A close call that went against the other bench: they may ask for the video.
        g.aiConsidersChallenge();
        // The ball is dead: a timeout asked for during the rally is given now, the other bench makes its changes.
        g.deadBall();
        // The set's last point: the top of the loop closes the set once the window for the video is over.
        if (g.matchday?.setEnding === true) continue;
        // Everyone walks into position for the next serve — rotating on a
        // side-out — while the referee gives the point and waves the serve on:
        // a little longer after a close call against the user, for him to ask for the video.
        setScene(sceneFor(g.matchday?.snapshot ?? null, g.liveRoles(), nearTeam, store));
        const hot = g.lastCall()?.close === true && g.challengeError() === null;
        await sleep((hot ? 3600 : 1800) / current.speed);
      }
    };
    void run();
    return () => {
      cancelled.current = true;
      clearTimeout(bigPlayTimer.current);
      clearTimeout(subAnnounceTimer.current);
    };
  }, []);

  // The video: the point played again on this court — up to the decisive touch
  // at near full speed, the last of it in slow motion — then the referee's
  // verdict, held a moment before play goes on.
  const reviewSeq = md.videoReview?.seq;
  useEffect(() => {
    const review = g.matchday?.videoReview;
    if (review == null) return;
    const cancelled = { current: false };
    // Skipping to the verdict stops the video where it is.
    const stop = { get current(): boolean { return cancelled.current || g.matchday?.videoReview?.verdict != null; } };
    void (async () => {
      animatingRef.current = true;
      setBigPlay(null);
      setRadar(null);
      if (review.verdict === null) {
        await sleep(900);
        if (stop.current) { if (cancelled.current) return; } else {
          const { entry } = review.log;
          const roles = g.liveRoles();
          setScene(setupScene(review.log, entry.serveTeam, roles, nearTeam, (p) => (servesJump(store, p) ? 'jump' : 'float')));
          await sleep(900);
          const seed = entry.set * 1000 + entry.scoreBefore[0] * 31 + entry.scoreBefore[1];
          const beats = rallyBeats(review.log, entry.serveTeam, entry.contacts, roles, seed, nearTeam, entry.winner, defenceNow);
          const slow = Math.min(2, beats.length);
          if (!stop.current) await playBeats(beats.slice(0, beats.length - slow), 0.85, stop, setScene, () => undefined);
          // The decisive touch in slow motion — the camera in close on where it comes down.
          const landing = beats[beats.length - 1]?.ball;
          if (landing != null && landing.z < 0.6) setVarZoom({ x: landing.x, y: landing.y });
          if (!stop.current) await playBeats(beats.slice(beats.length - slow), 0.28, stop, setScene, () => undefined);
          if (cancelled.current) return;
          await sleep(900);
          if (cancelled.current) return;
        }
        playWhistle();
        setVarZoom(null);
        g.finishVideoReview();
      }
      await sleep(2800);
      if (cancelled.current) return;
      animatingRef.current = false;
      g.closeVideoReview();
      setScene(sceneFor(g.matchday?.snapshot ?? null, g.liveRoles(), nearTeam, store));
    })();
    return () => {
      cancelled.current = true;
      animatingRef.current = false;
      setVarZoom(null);
    };
  }, [reviewSeq]);

  // The newest point is at the top of the list: keep it in view.
  useEffect(() => {
    logRef.current?.scrollTo(0, 0);
  }, [revealed]);

  // A substitution or libero change between rallies redraws the set-up.
  useEffect(() => {
    if (!animatingRef.current) setScene(sceneFor(md.snapshot, g.liveRoles(), nearTeam, store));
  }, [md.snapshot]);

  const [homeClub, awayClub] = md.sides;
  const userTeamIdx: 0 | 1 = md.userIsHome ? 0 : 1;
  const kits = sideKits(world, homeClub, awayClub);
  const teamOf = (p: number): 0 | 1 => (homeClub.players.includes(p) ? 0 : 1);
  // What the scoreboard shows: the state before the rally still being
  // animated, or the live snapshot once every rally has been shown.
  const pending = revealed < md.log.length ? md.log[revealed] : null;
  const shownLog = pending === null ? md.log : md.log.slice(0, revealed);
  const view = pending !== null
    ? {
      homeScore: pending.entry.scoreBefore[0],
      awayScore: pending.entry.scoreBefore[1],
      homeSets: pending.setsBefore[0],
      awaySets: pending.setsBefore[1],
      set: pending.entry.set,
      serving: pending.entry.serveTeam,
      matchOver: false,
    }
    : {
      homeScore: snap?.homeScore ?? 0,
      awayScore: snap?.awayScore ?? 0,
      homeSets: snap?.homeSets ?? 0,
      awaySets: snap?.awaySets ?? 0,
      set: snap?.set ?? 0,
      serving: snap?.serving ?? 0,
      matchOver: snap?.matchOver ?? false,
    };
  const stats = liveStats(shownLog);
  const ratings = g.liveRatings();
  const setHistory = completedSets(shownLog, view.set, view.matchOver);
  const homeProb = shownLog.length > 0 ? shownLog[shownLog.length - 1].entry.homeWinProb : 0.5;
  const status = view.matchOver
    ? 'Full time'
    : md.injury != null
      ? 'Injury'
    : md.timeoutActive !== null
      ? 'Timeout'
      : md.videoReview != null
        ? 'Video check'
      : md.paused && md.pauseUntil !== null
        ? (md.videoCheck === true ? 'Video check' : 'Substitution')
        : md.paused ? 'Paused' : 'Live';
  const remaining = g.subsRemaining();
  const shoutWait = g.shoutWait();
  const last = shownLog[shownLog.length - 1]?.entry;
  const lastText = last !== undefined ? describeRallyHighlight(last, store) : null;
  const points = [...shownLog].reverse().map((l) => l.entry);
  const crowdFill = crowdFor(world, md.fixture.competitionId, md.fixture.importance, fixtureRivalry(world, md.fixture) !== null);

  return (
    <div className="lv" style={{ ["--lv-home" as string]: kits[0].shirt, ["--lv-away" as string]: kits[1].shirt } as CSSProperties}>
      <div className="lv-top">
        <div className="lv-score">
          <div className="lv-score-meta">
            <span className={`lv-live status-${status.toLowerCase().replace(' ', '-')}`}><i />{status}</span>
            <span className="faint">{md.title}</span>
          </div>
          <div className="lv-score-main">
            <span className="lv-kitbar" style={{ background: kits[0].shirt }} />
            <SideCrest side={homeClub} size={26} />
            <b className="lv-code">{homeClub.shortName}</b>
            <span className={`lv-serve-dot${view.serving === 0 ? ' on' : ''}`} />
            <span className="lv-points">{view.homeScore}</span>
            <span className="lv-dash">–</span>
            <span className="lv-points">{view.awayScore}</span>
            <span className={`lv-serve-dot${view.serving === 1 ? ' on' : ''}`} />
            <b className="lv-code">{awayClub.shortName}</b>
            <SideCrest side={awayClub} size={26} />
            <span className="lv-kitbar" style={{ background: kits[1].shirt }} />
          </div>
          <div className="lv-score-sets">
            <span>{view.matchOver ? 'Full time' : `Set ${view.set + 1}`} · Sets {view.homeSets}–{view.awaySets}</span>
            {setHistory.map(([h, a], i) => (
              <span key={i} className="lv-set-chip"><b className={h > a ? 'won' : ''}>{h}</b>-<b className={a > h ? 'won' : ''}>{a}</b></span>
            ))}
          </div>
        </div>
        <div className="lv-momentum" title="Win probability">
          <span>{homeClub.name}</span>
          <div className="lv-momentum-bar">
            <i style={{ width: `${homeProb * 100}%`, background: kits[0].shirt }} />
            <i style={{ width: `${(1 - homeProb) * 100}%`, background: kits[1].shirt }} />
          </div>
          <span>{awayClub.name}</span>
        </div>
      </div>

      <div className="lv-main">
        <div className="lv-col">
          <LiveTeamCard team={0} serving={view.serving === 0} ratings={ratings}
            onPick={userTeamIdx === 0 ? (p, row) => pickPlayer(p, row, 'left') : undefined} />
          <section className="card lv-points-card">
            <header className="lv-card-head">Point by point</header>
            <div className="lv-pbp" ref={logRef}>
              {points.length === 0 && <div className="lv-pbp-row dim">Kicking off…</div>}
              {points.map((r, i) => {
                const won = r.winner;
                const d = describeRallyHighlight(r, store);
                return (
                  <div key={points.length - i} className={`lv-pbp-row clickable ${won === 0 ? 'home' : 'away'}`}
                    title="Watch this point again" onClick={() => g.replayRally(points.length - 1 - i)}>
                    <span className="lv-pbp-score">{r.scoreBefore[0] + (won === 0 ? 1 : 0)}-{r.scoreBefore[1] + (won === 1 ? 1 : 0)}</span>
                    <span className="lv-pbp-text">
                      {d.before}{d.player !== '' && <strong>{d.player}</strong>}{d.after}
                      {r.overturned === true && <span className="lv-video-tag" title="Turned over on video: the point went the other way">Video: overturned</span>}
                    </span>
                    <span className="lv-pbp-watch"><Icon name="play" size={11} /></span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="lv-center">
          <div className={`card court-panel lv-court${md.videoReview != null && md.videoReview.verdict === null ? ' reviewing' : ''}`}>
            <LiveCourt
              scene={scene} store={store} roles={g.liveRoles()} kits={kits} teamOf={teamOf} ratings={ratings} labels={labels}
              injury={md.injury != null ? { p: md.injury.inj.p, team: md.injury.inj.team, phase: md.injury.phase } : null}
              sideline={g.liveSideline()}
              nearTeam={nearTeam}
              crowdFill={crowdFill}
              // The referee sees a stoppage — and signals a time-out — once
              // the rally it followed has been shown.
              timeout={pending === null ? md.timeoutActive : null}
              paused={pending === null && md.paused}
              speed={md.speed}
              teamNames={[homeClub.shortName, awayClub.shortName]}
              view={g.courtView}
              camera={g.courtCamera}
              numberOf={(p) => g.shirtNumber(p)}
              coachLookFor={(t, kit) => (t === userTeamIdx ? figureLook(world.manager.look ?? DEFAULT_LOOK, kit, world.manager.gender === 'female') : null)}
              zoom={varZoom}
              ceremony={ceremony}
              trophy={md.trophy ?? null}
            />
            {md.trophy != null && <TrophyBanner />}
            <div className={`lv-court-tools${md.trophy != null ? ' hidden' : ''}`}>
              {g.courtView === '3d' && <CameraPicker />}
              <Segmented<'3d' | '2d'> size="sm" options={[['3d', '3D'], ['2d', '2D']]} value={g.courtView} onChange={(v) => g.setCourtView(v)} />
              <Segmented<CourtLabels>
                size="sm"
                options={[['ratings', 'Ratings'], ['names', 'Names'], ['off', 'Off']]}
                value={labels}
                onChange={setLabels}
              />
            </div>

            {bigPlay !== null && <BigPlayCallout key={bigPlay.key} play={bigPlay} />}
            {radar !== null && <ServeRadar key={radar.key} radar={radar} store={store} kits={kits} />}
            {subAnnouncement !== null && (
              <div
                key={subAnnouncement.key}
                className={`big-play sub-announcement ${subAnnouncement.team === 0 ? 'home' : 'away'}`}
              >
                {subAnnouncement.text}
              </div>
            )}
            {md.injury != null && <InjuryPanel />}
            {md.videoReview != null && <VideoCheck review={md.videoReview} side={md.sides[md.videoReview.team]} kit={kits[md.videoReview.team]} />}
            {md.timeoutActive !== null && overlay !== 'subs' && (
              <TimeoutPanel
                secondsLeft={timeoutSecondsLeft}
                calledBy={md.timeoutActive === 0 ? homeClub.shortName : awayClub.shortName}
              />
            )}
            {overlay === 'subs' && (
              <div className="lv-overlay">
                <header className="lv-overlay-head">
                  <strong><Icon name="swap" size={16} /> Substitutions</strong>
                  <span className="faint">{remaining} left this set{md.timeoutActive !== null ? ` · timeout 0:${timeoutSecondsLeft.toString().padStart(2, '0')}` : ''}</span>
                  {md.timeoutActive !== null && (
                    <button className="primary sm" onClick={() => g.resumeFromTimeout()}><Icon name="play" size={13} /> Resume play</button>
                  )}
                  <button className="icon-btn" onClick={closeOverlay} title="Close"><Icon name="close" size={16} /></button>
                </header>
                <div className="lv-overlay-body"><Substitutions teamIdx={userTeamIdx} /></div>
              </div>
            )}
            {overlay === 'tactics' && <TacticsOverlay onClose={() => setOverlay(null)} />}
          </div>
          <div className="lv-caption">
            <span className="lv-caption-text">
              {lastText === null ? 'Waiting for the first serve' : <>{lastText.before}{lastText.player !== '' && <strong>{lastText.player}</strong>}{lastText.after}</>}
              {/* A close call, as everyone in the hall saw it — not what the video will show. */}
              {last?.doubt !== undefined && last.overturned !== true && <span className="lv-close-call">Close: {DOUBT_WORDS[last.doubt]}</span>}
            </span>
            <b>{view.homeScore}-{view.awayScore}</b>
          </div>
        </div>

        <div className="lv-col">
          <LiveTeamCard team={1} serving={view.serving === 1} ratings={ratings}
            onPick={userTeamIdx === 1 ? (p, row) => pickPlayer(p, row, 'right') : undefined} />
          {quick !== null && <QuickSub key={quick.p} at={quick} onClose={closeQuick} />}
          <section className="card lv-stats-card">
            <header className="lv-card-head lv-tabs">
              <button className={sideTab === 'stats' ? 'on' : ''} onClick={() => setSideTab('stats')}>Match stats</button>
              {md.around !== undefined && (
                <button className={sideTab === 'around' ? 'on' : ''} onClick={() => setSideTab('around')}>Around the league</button>
              )}
            </header>
            {sideTab === 'around' && md.around !== undefined ? (
              <AroundPanel around={md.around} progress={{ sets: setHistory.length, score: [view.homeScore, view.awayScore], over: view.matchOver }}
                own={{ home: md.fixture.home, away: md.fixture.away, homeSets: view.homeSets, awaySets: view.awaySets }} />
            ) : <>
            <div className="lv-stats-names">
              <span>{homeClub.shortName}</span>
              <span>{awayClub.shortName}</span>
            </div>
            {STAT_ROWS.map(([key, label]) => {
              const h = stats[0][key];
              const a = stats[1][key];
              const total = h + a;
              return (
                <div className="lv-stat" key={key}>
                  <div className="lv-stat-row"><b>{h}</b><span>{label}</span><b>{a}</b></div>
                  <div className="lv-stat-bar">
                    <i style={{ width: `${total > 0 ? (h / total) * 100 : 50}%`, background: kits[0].shirt }} />
                    <i style={{ width: `${total > 0 ? (a / total) * 100 : 50}%`, background: kits[1].shirt }} />
                  </div>
                </div>
              );
            })}
            </>}
          </section>
        </div>
      </div>

      <div className="lv-coachbar">
        <span className="lv-coach-label">Coach</span>
        <button
          data-tour="timeout"
          className={md.timeoutRequest === userTeamIdx ? 'asked' : ''}
          disabled={md.timeoutActive !== null || md.timeoutsUsed[userTeamIdx] >= 2 || md.setEnding === true || view.matchOver}
          onClick={() => g.callTimeout()}
          title={md.timeoutRequest === userTeamIdx
            ? 'Asked for — the referee gives it at the next dead ball. Click to withdraw it.'
            : md.ballInPlay === true ? 'The ball is in play: the timeout is given at the next dead ball' : 'Call a timeout'}
        >
          <Icon name="whistle" size={15} /> {md.timeoutRequest === userTeamIdx ? 'Timeout asked' : 'Timeout'}
          <span className="lv-badge">{2 - md.timeoutsUsed[userTeamIdx]}</span>
        </button>
        <ChallengeButton shown={revealed >= md.log.length} onOpen={setChallengeOpen} />
        <button data-tour="subs" className={overlay === 'subs' ? 'on' : ''} onClick={() => (overlay === 'subs' ? closeOverlay() : openSubs())}>
          <Icon name="swap" size={15} /> Substitution <span className={`lv-badge${remaining <= 0 ? ' bad' : ''}`}>{remaining}</span>
        </button>
        <div className="lv-shout" ref={shoutRef}>
          <button
            className={shoutOpen ? 'on' : ''}
            disabled={shoutWait > 0 || view.matchOver}
            title={shoutWait > 0 ? `You can shout again in ${shoutWait} rallies` : 'A word from the touchline'}
            onClick={() => setShoutOpen((o) => !o)}
          >
            <Icon name="press" size={15} /> Shout{shoutWait > 0 && <span className="lv-badge">{shoutWait}</span>}
          </button>
          {shoutOpen && (
            <div className="menu-pop lv-shout-menu">
              {(Object.keys(SHOUT_LINES) as ShoutKind[]).map((k) => (
                <button key={k} onClick={() => { g.shout(k); setShoutOpen(false); }}>
                  <span className="menu-pop-stack">
                    <span>{SHOUT_LINES[k].label}</span>
                    <span className="faint">{SHOUT_LINES[k].hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className={overlay === 'tactics' ? 'on' : ''} onClick={() => setOverlay((o) => (o === 'tactics' ? null : 'tactics'))}>
          <Icon name="tactics" size={15} /> Tactics
        </button>
        <span className="flex-spacer" />
        {md.paused
          ? (
            <button disabled={md.timeoutActive !== null || md.injury != null || md.videoReview != null} onClick={() => g.resume()}
              title={md.videoReview != null ? 'The referee is at the video screen' : undefined}>
              <Icon name="play" size={14} /> Resume
            </button>
          )
          : (
            <button disabled={md.timeoutActive !== null || md.injury != null} onClick={() => g.pause()}>
              <Icon name="pause" size={14} /> Pause
            </button>
          )}
        <SoundToggle />
        <Segmented
          size="sm"
          options={[[1, '1×'], [1.5, '1.5×'], [2, '2×']] as const}
          value={md.speed}
          onChange={(sp) => g.setSpeed(sp)}
        />
        <button className="lv-skip" onClick={() => g.finishMatchdayNow()} title="Skip to the result" data-tour="skip-result">
          Skip to result <Icon name="arrowRight" size={14} />
        </button>
      </div>
    </div>
  );
}

/** A clickable, draggable player row for the substitution picker. Dragging one
 *  onto another (in either direction — bench-to-court or court-to-bench) subs
 *  them in one motion; clicking both, then confirming, does the same thing. */
function SubCard({
  playerIdx, store, role, rating, selected, isDragOver, onClick, onDropPlayer, onDragOverCard, onDragLeaveCard, warm,
}: {
  playerIdx: number;
  store: PlayerStore;
  /** What he plays in this match — a libero down to play in the six is no libero here. */
  role?: Position;
  /** Live match rating, if the player has played yet. */
  rating?: number;
  /** A substitute's warm-up: how warm he is, whether he is warming up, and the button to send him. */
  warm?: { level: number; warming: boolean; onToggle: () => void };
  selected: boolean;
  isDragOver: boolean;
  onClick: () => void;
  onDropPlayer: (draggedPlayerIdx: number) => void;
  onDragOverCard: () => void;
  onDragLeaveCard: () => void;
}): JSX.Element {
  const pos = role ?? (store.position[playerIdx] as Position);
  return (
    <div
      className={`bench-token sub-token draggable${selected ? ' selected' : ''}${isDragOver ? ' drag-over' : ''}`}
      style={{ '--token-accent': POSITION_ACCENT[pos] } as CSSProperties}
      onClick={onClick}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(playerIdx))}
      onDragOver={(e) => { e.preventDefault(); onDragOverCard(); }}
      onDragLeave={onDragLeaveCard}
      onDrop={(e) => {
        e.preventDefault();
        onDragLeaveCard();
        const dragged = Number(e.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(dragged)) onDropPlayer(dragged);
      }}
    >
      <span className="bench-token-grip" aria-hidden="true">⋮⋮</span>
      <PlayerFace playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} size={26} />
      <span className="bench-token-name">
        <span className="sub-name-line">
          {store.shortName(playerIdx)}
          {rating !== undefined && <RatingBadge value={rating} size="sm" />}
        </span>
        {warm !== undefined && (
          <span className={`sub-warm ${warm.level >= WARM_READY ? 'ready' : warm.warming ? 'warming' : 'cold'}`}>
            <span className="sub-warm-bar"><i style={{ width: `${Math.round(warm.level * 100)}%` }} /></span>
            <span className="sub-warm-text">{warm.level >= WARM_READY ? 'Ready' : warm.warming ? 'Warming up' : 'Cold'}</span>
            <button
              className="sm ghost sub-warm-btn"
              onClick={(e) => { e.stopPropagation(); warm.onToggle(); }}
              title={warm.warming ? 'Back to stand in the warm-up area' : 'Send him to warm up — on cold, he risks a strain'}
            >
              {warm.warming ? 'Stop' : 'Warm up'}
            </button>
          </span>
        )}
      </span>
      <Pos pos={pos} />
      <span className="bench-token-ability">{store.currentAbility[playerIdx]}</span>
      <Bar value={store.condition[playerIdx]} />
    </div>
  );
}

/** One libero role in the substitutions panel: whoever holds it, as a drop target. */
function LiberoSlot({
  label, note, playerIdx, rating, store, isDragOver, onDropPlayer, onDragOver, onDragLeave, action,
}: {
  label: string;
  note: string;
  playerIdx: number;
  rating?: number;
  store: PlayerStore;
  isDragOver: boolean;
  onDropPlayer: (dragged: number) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <div
      className={`libero-slot${isDragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDragLeave();
        const dragged = Number(e.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(dragged)) onDropPlayer(dragged);
      }}
    >
      <div className="libero-slot-head">
        <span className="libero-slot-label">{label}</span>
        <span className="faint">{note}</span>
        {action}
      </div>
      {playerIdx >= 0 ? (
        <div className="bench-token libero-token" style={{ '--token-accent': 'var(--pos-l)' } as CSSProperties}>
          <PlayerFace playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} size={26} />
          <span className="bench-token-name">
            {store.shortName(playerIdx)}
            {rating !== undefined && <RatingBadge value={rating} size="sm" />}
          </span>
          <Pos pos={store.position[playerIdx] as Position} />
          <span className="bench-token-ability">{store.currentAbility[playerIdx]}</span>
          <Bar value={store.condition[playerIdx]} />
        </div>
      ) : (
        <div className="libero-slot-empty">Drop a libero here</div>
      )}
    </div>
  );
}

function Substitutions({ teamIdx }: { teamIdx: 0 | 1 }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  // Only the fourteen named for the match.
  const squad = g.matchSquadOf(teamIdx);
  const named = new Set(g.matchLiberosOf(teamIdx));
  const store = world.players;
  const [outPlayer, setOutPlayer] = useState<number | null>(null);
  const [inPlayer, setInPlayer] = useState<number | null>(null);
  const [dragOverPlayer, setDragOverPlayer] = useState<number | null>(null);

  const onCourt = (teamIdx === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  // The liberos named for the match are changed in their own section below —
  // they can never take an ordinary rotation spot, so they never appear on
  // this bench. A libero beyond the two is in the squad to play in the six.
  const bench = squad.filter((p) => !onCourt.includes(p) && g.matchAvailable(p) && !named.has(p));
  const ratings = g.liveRatings();
  const roles = g.liveRoles();
  const liberos = g.liveLiberos();
  const spareLiberos = squad.filter((p) =>
    named.has(p) && g.matchAvailable(p) && !onCourt.includes(p) && p !== liberos.reception && p !== liberos.defence);
  const [liberoDragOver, setLiberoDragOver] = useState<'reception' | 'defence' | null>(null);
  const [mode, setMode] = useState<'now' | 'planned'>('now');
  // Reads the engine's own per-set counter — it resets every set, unlike a
  // UI-tracked total would (that used to be the bug here: it never reset).
  const remaining = g.subsRemaining();
  // The warm-up is the user's own side's.
  const userSide = teamIdx === (md.userIsHome ? 0 : 1);
  const coldIn = inPlayer !== null && userSide && g.warmthOf(inPlayer) < WARM_READY;

  const makeSub = (): void => {
    if (outPlayer === null || inPlayer === null) return;
    g.substitute(outPlayer, inPlayer);
    setOutPlayer(null);
    setInPlayer(null);
  };

  // Dropping either card onto the other works the same regardless of which
  // one was dragged — whichever of the pair is on court is the one going off.
  const dropPair = (targetIdx: number, draggedIdx: number): void => {
    if (targetIdx === draggedIdx) return;
    const targetIsOnCourt = onCourt.includes(targetIdx);
    const draggedIsOnCourt = onCourt.includes(draggedIdx);
    if (targetIsOnCourt === draggedIsOnCourt) return; // need one of each
    g.substitute(targetIsOnCourt ? targetIdx : draggedIdx, targetIsOnCourt ? draggedIdx : targetIdx);
    setOutPlayer(null);
    setInPlayer(null);
  };

  const dragProps = (p: number): {
    isDragOver: boolean; onDropPlayer: (d: number) => void;
    onDragOverCard: () => void; onDragLeaveCard: () => void;
  } => ({
    isDragOver: dragOverPlayer === p,
    onDropPlayer: (dragged) => dropPair(p, dragged),
    onDragOverCard: () => setDragOverPlayer(p),
    onDragLeaveCard: () => setDragOverPlayer((cur) => (cur === p ? null : cur)),
  });

  return (
    <div className="subs">
      <div className="subs-scroll">
        <div className="subs-top">
          <span className={`count-chip${remaining <= 0 ? ' bad' : ''}`}>{remaining} left this set</span>
          {userSide && (
            <span className="subs-mode">
              <button className={mode === 'now' ? 'on' : ''} onClick={() => setMode('now')}>Now</button>
              <button className={mode === 'planned' ? 'on' : ''} onClick={() => setMode('planned')}>
                Planned{plannedCount(md) > 0 && <span className="subs-mode-count">{plannedCount(md)}</span>}
              </button>
            </span>
          )}
          <p className="field-hint">
            {mode === 'planned'
              ? 'Set a change up once — it is made by itself the moment its rotation comes round.'
              : 'Drag a bench player onto someone on court, or pick both and confirm. A player who comes off can only return for whoever replaced them.'}
          </p>
        </div>

        {mode === 'planned' && userSide ? <PlannedSubs bench={bench} roles={roles} /> : (<>
        <div className="sub-cols">
          <div className="sub-col">
            <div className="section-label">On court — pick who comes off</div>
            <div className="sub-list">
              {onCourt.map((p) => (
                <SubCard
                  key={p}
                  playerIdx={p}
                  store={store}
                  role={roles[p] as Position}
                  rating={ratings.get(p)}
                  selected={outPlayer === p}
                  onClick={() => setOutPlayer(outPlayer === p ? null : p)}
                  {...dragProps(p)}
                />
              ))}
            </div>
          </div>
          <div className="sub-col">
            <div className="section-label">Bench — pick who comes on</div>
            <div className="sub-list">
              {bench.length === 0 && <p className="empty">No fit players available.</p>}
              {bench.map((p) => (
                <SubCard
                  key={p}
                  playerIdx={p}
                  store={store}
                  role={roles[p] as Position}
                  rating={ratings.get(p)}
                  selected={inPlayer === p}
                  onClick={() => setInPlayer(inPlayer === p ? null : p)}
                  warm={userSide ? { level: g.warmthOf(p), warming: g.isWarming(p), onToggle: () => g.toggleWarmup(p) } : undefined}
                  {...dragProps(p)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="libero-panel">
          <div className="section-label">Liberos — changes are unlimited and never use a substitution</div>
          <div className="libero-slots">
            <LiberoSlot
              label={liberos.defence >= 0 ? 'Reception libero' : 'Libero'}
              note={liberos.defence >= 0 ? 'on court while you receive' : 'plays every back-row rally'}
              playerIdx={liberos.reception}
              rating={ratings.get(liberos.reception)}
              store={store}
              isDragOver={liberoDragOver === 'reception'}
              onDragOver={() => setLiberoDragOver('reception')}
              onDragLeave={() => setLiberoDragOver((c) => (c === 'reception' ? null : c))}
              onDropPlayer={(d) => g.changeLibero('reception', d)}
              action={liberos.defence >= 0 ? (
                <button className="sm ghost" onClick={() => g.changeLibero('reception', liberos.defence)}>
                  <Icon name="swap" size={13} /> Swap roles
                </button>
              ) : undefined}
            />
            <LiberoSlot
              label="Defensive libero"
              note="on court while you serve"
              playerIdx={liberos.defence}
              rating={ratings.get(liberos.defence)}
              store={store}
              isDragOver={liberoDragOver === 'defence'}
              onDragOver={() => setLiberoDragOver('defence')}
              onDragLeave={() => setLiberoDragOver((c) => (c === 'defence' ? null : c))}
              onDropPlayer={(d) => g.changeLibero('defence', d)}
              action={liberos.defence >= 0 ? (
                <button className="sm ghost" onClick={() => g.changeLibero('defence', -1)}>Remove</button>
              ) : undefined}
            />
          </div>
          {spareLiberos.length > 0 ? (
            <div className="libero-spares">
              {spareLiberos.map((p) => (
                <div
                  key={p}
                  className="bench-token libero-token draggable"
                  style={{ '--token-accent': 'var(--pos-l)' } as CSSProperties}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(p))}
                >
                  <span className="bench-token-grip" aria-hidden="true">⋮⋮</span>
                  <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={26} />
                  <span className="bench-token-name">{store.shortName(p)}</span>
                  <span className="bench-token-ability">{store.currentAbility[p]}</span>
                  <span className="libero-spare-actions">
                    <button className="sm" onClick={() => g.changeLibero('reception', p)}>Reception</button>
                    <button className="sm" onClick={() => g.changeLibero('defence', p)}>Defence</button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="field-hint">No other libero available on the bench.</p>
          )}
        </div>
        </>)}
      </div>

      {mode === 'now' && <div className="sub-confirm">
        <span className="sub-summary">
          {outPlayer !== null
            ? <><span className="bad">▼ {store.shortName(outPlayer)}</span> off</>
            : <span className="faint">Pick who comes off</span>}
          <span className="faint">·</span>
          {inPlayer !== null
            ? <><span className="good">▲ {store.shortName(inPlayer)}</span> on</>
            : <span className="faint">Pick who comes on</span>}
          {coldIn && <span className="sub-cold-warning"><Icon name="alert" size={13} /> Not warmed up — he risks a strain</span>}
        </span>
        <button
          className="primary"
          disabled={outPlayer === null || inPlayer === null || remaining <= 0}
          onClick={makeSub}
        >
          Confirm
        </button>
      </div>}
    </div>
  );
}

/** How many planned substitutions are set up, armed or on. */
function plannedCount(md: { subPlans?: { doubleSwitch: unknown; serveSub: unknown } }): number {
  return Number(md.subPlans?.doubleSwitch != null) + Number(md.subPlans?.serveSub != null);
}

/** A bench player's serve, 1-20: his best kind of serve, with its accuracy and power. */
function serveRating(store: PlayerStore, p: number): number {
  const best = Math.max(store.getAttr(p, 'floatServe'), store.getAttr(p, 'jumpServe'), store.getAttr(p, 'powerServe'));
  return Math.round((best * 2 + store.getAttr(p, 'servingAccuracy') + store.getAttr(p, 'servingPower')) / 4);
}

/**
 * The planned substitutions: a double switch, and a serving specialist for the middles — each picked
 * once, and made by itself when its moment comes, as a coach has them ready on his clipboard.
 */
function PlannedSubs({ bench, roles }: { bench: number[]; roles: Uint8Array }): JSX.Element {
  const g = useGame();
  const md = g.matchday!;
  const store = g.world!.players;
  const ds = md.subPlans?.doubleSwitch ?? null;
  const ss = md.subPlans?.serveSub ?? null;
  // A player can be in one plan only: each leaves out whoever the other has planned.
  const inSwitch = new Set(ds !== null ? [ds.setter, ds.opposite] : []);
  const setters = bench.filter((p) => roles[p] === Position.Setter && p !== ss?.server);
  const opposites = bench.filter((p) => roles[p] === Position.Opposite && p !== ss?.server);
  const [setter, setSetter] = useState<number | null>(ds?.setter ?? setters[0] ?? null);
  const [opposite, setOpposite] = useState<number | null>(ds?.opposite ?? opposites[0] ?? null);
  const picked = new Set(ds !== null ? inSwitch : [setter, opposite]);
  const servers = bench.filter((p) => !picked.has(p) || p === ss?.server).sort((a, b) => serveRating(store, b) - serveRating(store, a));
  const [server, setServer] = useState<number | null>(ss?.server ?? null);
  const serverPick = server !== null && servers.includes(server) ? server : servers[0] ?? null;
  const who = (p: number, extra?: string): { value: number; label: string } => ({
    value: p, label: `${store.shortName(p)} · ${POSITION_SHORT[roles[p] as Position]}${extra ?? ''}`,
  });
  const state = (plan: { armed: boolean; on: unknown } | null): JSX.Element => (
    <span className={`subplan-state${plan === null ? '' : plan.on !== null ? ' on' : ' armed'}`}>
      {plan === null ? 'Off' : plan.on !== null ? 'On court' : 'Armed'}
    </span>
  );
  return (
    <div className="subplans">
      <section className="subplan-card" title="Setter in zone 4, opposite in zone 1: a bench setter on for the opposite, a bench opposite on for the setter — back three rotations later.">
        <header className="subplan-head">
          <Icon name="swap" size={15} /> <b>Double switch</b>{state(ds)}
          {ds?.armed === true
            ? <button className="sm" onClick={() => g.planDoubleSwitch(null, null)}>Call off</button>
            : <button className="sm primary" disabled={setter === null || opposite === null} onClick={() => g.planDoubleSwitch(setter, opposite)}>
              <Icon name="check" size={13} /> Plan it
            </button>}
        </header>
        <p className="field-hint" title="Three hitters at the net, the new setter setting from the back row; three rotations later the two who went off come back.">
          Setter in zone 4, opposite in zone 1: a bench setter on for the opposite, a bench opposite on for the setter — back
          three rotations later. Four substitutions.
        </p>
        <div className="subplan-picks">
          <label className="subplan-pick">
            <span>Setter on</span>
            {setters.length === 0 ? <span className="faint">No setter on the bench</span> : (
              <Dropdown size="sm" value={setter} onChange={setSetter} disabled={ds?.armed === true} options={setters.map((p) => who(p))} />
            )}
          </label>
          <label className="subplan-pick">
            <span>Opposite on</span>
            {opposites.length === 0 ? <span className="faint">No opposite on the bench</span> : (
              <Dropdown size="sm" value={opposite} onChange={setOpposite} disabled={ds?.armed === true} options={opposites.map((p) => who(p))} />
            )}
          </label>
        </div>
        <footer className="subplan-foot faint">{g.subPlanStatus('doubleSwitch')}</footer>
      </section>

      <section className="subplan-card" title="A middle blocker goes back to serve: a serving specialist on for him, the middle back once the serve is lost.">
        <header className="subplan-head">
          <Icon name="ball" size={15} /> <b>Serving sub for the middles</b>{state(ss)}
          {ss?.armed === true
            ? <button className="sm" onClick={() => g.planServeSub(null)}>Call off</button>
            : <button className="sm primary" disabled={serverPick === null} onClick={() => g.planServeSub(serverPick)}>
              <Icon name="check" size={13} /> Plan it
            </button>}
        </header>
        <p className="field-hint" title="Two substitutions each time.">
          A middle blocker goes back to serve: a serving specialist on for him, the middle back once the serve is lost. Two
          substitutions each time.
        </p>
        <div className="subplan-picks">
          <label className="subplan-pick">
            <span>Server on</span>
            {servers.length === 0 ? <span className="faint">Nobody on the bench</span> : (
              <Dropdown size="sm" value={serverPick} onChange={setServer} disabled={ss?.armed === true}
                options={servers.map((p) => who(p, ` · serve ${serveRating(store, p)}`))} />
            )}
          </label>
        </div>
        <footer className="subplan-foot faint">{g.subPlanStatus('serveSub')}</footer>
      </section>
    </div>
  );
}

/** Which camera the 3D court is watched through — the broadcast's, or one of the others. */
export function CameraPicker(): JSX.Element {
  const g = useGame();
  return (
    <Dropdown<CameraMode>
      size="sm"
      className="lv-camera"
      title="Camera"
      menuWidth={300}
      value={g.courtCamera}
      onChange={(c) => g.setCourtCamera(c)}
      options={CAMERA_MODES.map((c) => ({ value: c.mode, label: c.name, icon: <Icon name="camera" size={13} />, hint: c.hint }))}
    />
  );
}

/**
 * A final won: over the court as the winners lift the trophy, whose it is and in what — and the way
 * on to the report. The crowd's roar comes up as it goes over the captain's head.
 */
function TrophyBanner(): JSX.Element | null {
  const g = useGame();
  const md = g.matchday;
  const trophy = md?.trophy ?? null;
  useEffect(() => {
    if (trophy === null) return;
    // A roar as they celebrate, and another as it goes up.
    const at = [300, 1600, 2900, ...[0, 1, 2, 3, 4, 5].map((k) => TROPHY_LIFT_AT + k * 1300)];
    const timers = at.map((ms) => setTimeout(() => playCrowd(1), ms));
    return () => timers.forEach(clearTimeout);
  }, [trophy?.team]);
  if (md == null || trophy === null) return null;
  const winner = md.sides[trophy.team];
  const ours = trophy.team === (md.userIsHome ? 0 : 1);
  return (
    <div className={`trophy-banner${ours ? ' ours' : ''}`} role="status" style={{ animationDelay: `${TROPHY_LIFT_AT - 200}ms` }}>
      <span className="trophy-banner-cup"><Icon name="trophy" size={28} /></span>
      <div className="trophy-banner-text">
        <small>{md.final}</small>
        <b>{ours ? 'Champions!' : `${winner.shortName} are champions`}</b>
        <span><SideCrest side={winner} size={16} /> {winner.name} lift the trophy</span>
      </div>
      <button className="primary" onClick={() => g.completeMatchday()}>Continue <Icon name="arrowRight" size={14} /></button>
    </div>
  );
}
