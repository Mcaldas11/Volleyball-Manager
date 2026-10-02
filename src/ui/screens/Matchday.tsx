import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { Position } from '../../engine/model/positions.ts';
import type { PlayerStore } from '../../engine/model/players.ts';
import type { RallyContact } from '../../engine/match/engine.ts';
import {
  abilityClass, Bar, Card, ChoiceField, ClubCrest, clubHue, Flag, PlayerFace, Pos, POSITION_ACCENT, RatingBadge,
  Segmented, StarMeter,
} from '../components.tsx';
import { NATIONS } from '../../engine/world/nations.ts';
import type { World } from '../../engine/world/world.ts';
import { Icon } from '../icons.tsx';
import { kitsFor, LiveCourt, type CourtLabels } from '../LiveCourt.tsx';
import { rallyBeats, setupScene, type Scene } from '../matchCourt.ts';
import { TeamSheet } from '../teamSheet.tsx';
import { DEFENSE_OPTIONS, OFFENSE_OPTIONS, SERVE_OPTIONS, TEMPO_OPTIONS } from './Manage.tsx';
import { Formation, FORMATION_NAMES, formationOf } from '../../engine/match/tactics.ts';
import { RallyTicker } from './Match.tsx';
import { useGame, type MatchdayLogEntry, type MatchdaySnapshot, type MatchSide } from '../state.ts';

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

/** A side's badge: the club's crest, or the nation's flag. */
function SideCrest({ side, size }: { side: MatchSide; size: number }): JSX.Element | null {
  const g = useGame();
  if (side.clubId < 0) {
    return <span className="side-flag" style={{ width: size * 1.3, height: size * 0.88 }}><Flag nation={side.nation} /></span>;
  }
  const club = g.world?.clubs[side.clubId];
  return club !== undefined ? <ClubCrest club={club} size={size} /> : null;
}

/** Beat counter shared by every rally, so each flight gets a fresh animation. */
let beatSeq = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Punchy callouts for the moments worth flashing on screen, not every touch of the ball. */
const BIG_PLAY_CALLOUTS: Partial<Record<RallyContact['kind'], readonly string[]>> = {
  kill: ['MONSTER SPIKE!', 'KILL!', 'CRUSHED!', 'UNSTOPPABLE!'],
  blocked: ['HUGE BLOCK!', 'STUFFED!', 'DENIED!', 'REJECTED!'],
  ace: ['ACE!', 'UNTOUCHABLE SERVE!'],
  attackError: ['OUT!', 'WIDE!'],
  serveError: ['OUT!', 'INTO THE NET!'],
};

function pickBigPlay(kind: RallyContact['kind']): string | null {
  const options = BIG_PLAY_CALLOUTS[kind];
  if (options === undefined) return null;
  return options[Math.floor(Math.random() * options.length)];
}

/** Both sides set up for the next serve, from the live snapshot. */
function sceneFor(snap: MatchdaySnapshot | null, store: PlayerStore, nearTeam: 0 | 1): Scene {
  if (snap === null) return { positions: new Map(), poses: new Map(), ball: null, arc: 0, actor: null, ms: 400 };
  return setupScene(snap, snap.serving, store.position, nearTeam);
}

/**
 * Play one rally out on the court: every beat moves the players into where
 * they would really be — serve receive, the switch, the setter running to
 * the target, hitters approaching, the block closing — and sends the ball to
 * whoever touches it next.
 */
async function animateRally(
  logEntry: MatchdayLogEntry,
  store: PlayerStore,
  nearTeam: 0 | 1,
  speed: number,
  cancelled: { current: boolean },
  setScene: (scene: Scene) => void,
  onBigPlay: (text: string, team: 0 | 1) => void,
): Promise<void> {
  const { entry } = logEntry;
  const seed = entry.set * 1000 + entry.scoreBefore[0] * 31 + entry.scoreBefore[1];
  const beats = rallyBeats(logEntry, entry.serveTeam, entry.contacts, store.position, seed, nearTeam, entry.winner);
  for (const beat of beats) {
    if (cancelled.current) return;
    // Beat timings are tuned for 1x — slower speeds stretch them, faster squeeze.
    const ms = (beat.ms * 1.15) / speed;
    setScene({ ...beat, ms, seq: ++beatSeq });
    if (beat.callout !== null) {
      const text = pickBigPlay(beat.callout.kind);
      if (text !== null) onBigPlay(text, beat.callout.team);
    }
    await sleep(ms);
  }
}

/** Whether a CSS media query matches, kept in step as the window resizes. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function MatchdayScreen(): JSX.Element | null {
  const g = useGame();
  const md = g.matchday;
  if (md === null) return null;
  if (md.stage === 'lineup') return <LineupSetup />;
  return md.stage === 'setBreak' ? <SetBreak /> : <LiveMatchView />;
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
  const mine = md.sides[md.userIsHome ? 0 : 1];
  const opponent = md.sides[md.userIsHome ? 1 : 0];
  const available = mine.players.filter((p) => g.matchAvailable(p));
  const bench = available.filter((p) =>
    !md.homeLineup.includes(p) && p !== md.homeLibero && p !== md.homeDefensiveLibero);

  const starters = md.homeLineup.filter((p): p is number => p !== undefined);
  const teamAvg = starters.length > 0
    ? Math.round(starters.reduce((s, p) => s + store.currentAbility[p], 0) / starters.length)
    : 0;
  const oppAvg = bestSixAverage(opponent.players, store, (p) => g.matchAvailable(p));

  return (
    <div className="md-setup">
      <div className="md-banner">
        <div className="md-banner-team">
          <SideCrest side={home} size={46} />
          <div className="md-banner-team-text">
            <span className="md-banner-name">{home.name}</span>
            <span className="md-banner-tag">Home{md.userIsHome ? ' · Your team' : ''}</span>
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
          <div className="md-formation" title="5-1: one setter and an opposite. 4-2: two setters, diagonal — the one in the back row sets, the one at the net attacks.">
            <span className="faint">Formation</span>
            <Segmented<Formation>
              size="sm"
              options={[[Formation.FiveOne, FORMATION_NAMES[Formation.FiveOne]], [Formation.FourTwo, FORMATION_NAMES[Formation.FourTwo]]]}
              value={formationOf(g.matchTactics() ?? undefined)}
              onChange={(f) => g.setMatchdayFormation(f)}
            />
          </div>
          <button className="primary lg" onClick={() => g.kickOff()}>
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
      />
    </div>
  );
}

/** The saved tactic to play today — loading another picks the six again for it. */
function MatchdayTacticSelect(): JSX.Element | null {
  const g = useGame();
  const saved = g.savedTactics();
  if (saved === null || saved.slots.length < 2) return null;
  return (
    <div className="md-formation">
      <span className="faint">Tactic</span>
      <select className="md-tactic-select" value={saved.active} onChange={(e) => g.loadTactic(Number(e.target.value))}>
        {saved.slots.map((t, i) => <option key={i} value={i}>{i + 1}. {t.name}</option>)}
      </select>
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
  const bench = md.sides[md.userIsHome ? 0 : 1].players.filter((p) =>
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
      />
    </div>
  );
}

const TIMEOUT_SECONDS = 30;

/** The compact tactics editor shown while a timeout is active — the same club.tactics
 *  object the rally engine reads live, so a change here applies from the next rally on. */
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
          <span className="faint">Adjust your tactics here, or make changes in the Subs tab — they apply from the next rally.</span>
        </div>
        <span className="timeout-countdown">0:{secondsLeft.toString().padStart(2, '0')}</span>
        <button className="primary" onClick={() => g.resumeFromTimeout()}>
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

/** The tabs of the live side panel; 'stats' only on screens too narrow for the stats column. */
type LivePanelTab = 'commentary' | 'subs' | 'stats';

const STAT_ROWS: ReadonlyArray<[keyof TeamLiveStats, string]> = [
  ['points', 'Points won'],
  ['kills', 'Kills'],
  ['aces', 'Aces'],
  ['blocks', 'Blocks'],
  ['errors', 'Errors'],
];

function LiveMatchView(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;
  const snap = md.snapshot;
  const logRef = useRef<HTMLDivElement>(null);
  // The user's side plays in the half nearest the camera.
  const nearTeam: 0 | 1 = md.userIsHome ? 0 : 1;
  const [scene, setScene] = useState<Scene>(() => sceneFor(md.snapshot, store, nearTeam));
  const [labels, setLabels] = useState<CourtLabels>('ratings');
  const [panelTab, setPanelTab] = useState<LivePanelTab>('commentary');
  // On a narrow screen the stats column folds into the side panel as a tab.
  const compact = useMediaQuery('(max-width: 1100px)');
  const tab: LivePanelTab = !compact && panelTab === 'stats' ? 'commentary' : panelTab;
  /** True while a rally is being played out, so snapshot changes don't yank the court mid-rally. */
  const animatingRef = useRef(false);
  const [bigPlay, setBigPlay] = useState<{ text: string; team: 0 | 1; key: number } | null>(null);
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

  const triggerBigPlay = (text: string, team: 0 | 1): void => {
    setBigPlay({ text, team, key: Date.now() });
    if (bigPlayTimer.current !== undefined) clearTimeout(bigPlayTimer.current);
    bigPlayTimer.current = setTimeout(() => setBigPlay(null), 1100);
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
      : `${teamName}: ${store.shortName(sub.inPlayerIdx)} ON for ${store.shortName(sub.outPlayerIdx)}${
        sub.reason === 'fatigue' ? ' (tired)' : sub.reason === 'form' ? ' (struggling)' : ''}`;
    setSubAnnouncement({ text, team: sub.team, key: sub.seq });
    if (subAnnounceTimer.current !== undefined) clearTimeout(subAnnounceTimer.current);
    subAnnounceTimer.current = setTimeout(() => setSubAnnouncement(null), 3000);
  }, [lastSubSeq]);

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
      let stopped = false;
      while (!cancelled.current) {
        const current = g.matchday;
        if (current === null) break;
        if (current.paused) {
          stopped = true;
          // A substitution stoppage ends by itself once its wall-clock time is
          // up — but never while a timeout is open, which only the clock or
          // the Resume button may close.
          if (current.pauseUntil !== null && current.timeoutActive === null && Date.now() >= current.pauseUntil) {
            g.resume();
            continue;
          }
          await sleep(150);
          continue;
        }
        if (stopped) {
          // Play back on: a moment for the referee to wave the serve on.
          stopped = false;
          await sleep(1100 / current.speed);
          continue;
        }
        // A set won while this view was away (it unmounted mid-pause) still
        // needs its break before another rally can be played.
        if (current.setBreakPending) {
          g.openSetBreak();
          break;
        }
        animatingRef.current = true;
        const logEntry = g.playNextRally();
        if (logEntry === null) { animatingRef.current = false; break; }
        await animateRally(logEntry, store, nearTeam, current.speed, cancelled, setScene, triggerBigPlay);
        animatingRef.current = false;
        if (cancelled.current) break;
        setRevealed(g.matchday?.log.length ?? 0);
        if (g.matchday?.snapshot?.matchOver === true) {
          // Full time: let the last point sink in, then on to the report.
          await sleep(2200 / current.speed);
          if (!cancelled.current) g.completeMatchday();
          break;
        }
        if (g.matchday?.setBreakPending === true) {
          // Set over: same pause, then the set break's team sheet takes the
          // screen. Coming back from it mounts this view, and its loop, afresh.
          await sleep(2200 / current.speed);
          if (!cancelled.current) g.openSetBreak();
          break;
        }
        // Everyone walks into position for the next serve — rotating on a
        // side-out — while the referee gives the point and waves the serve on.
        setScene(sceneFor(g.matchday?.snapshot ?? null, store, nearTeam));
        await sleep(1800 / current.speed);
      }
    };
    void run();
    return () => {
      cancelled.current = true;
      clearTimeout(bigPlayTimer.current);
      clearTimeout(subAnnounceTimer.current);
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [revealed, tab]);

  // A timeout is the moment for changes — open the substitutions.
  useEffect(() => {
    if (md.timeoutActive !== null) setPanelTab('subs');
  }, [md.timeoutActive]);

  // A substitution or libero change between rallies redraws the set-up.
  useEffect(() => {
    if (!animatingRef.current) setScene(sceneFor(md.snapshot, store, nearTeam));
  }, [md.snapshot]);

  const [homeClub, awayClub] = md.sides;
  const userTeamIdx: 0 | 1 = md.userIsHome ? 0 : 1;
  const kits = kitsFor(sideHue(world, homeClub), sideHue(world, awayClub));
  const teamOf = (p: number): 0 | 1 => (homeClub.players.includes(p) ? 0 : 1);
  const farClub = nearTeam === 0 ? awayClub : homeClub;
  const nearClub = nearTeam === 0 ? homeClub : awayClub;
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
  const farSets = nearTeam === 0 ? view.awaySets : view.homeSets;
  const nearSets = nearTeam === 0 ? view.homeSets : view.awaySets;
  const stats = liveStats(shownLog);
  const ratings = g.liveRatings();
  const setHistory = completedSets(shownLog, view.set, view.matchOver);
  const homeProb = shownLog.length > 0 ? shownLog[shownLog.length - 1].entry.homeWinProb : 0.5;
  const status = view.matchOver
    ? 'Full time'
    : md.timeoutActive !== null
      ? 'Timeout'
      : md.paused && md.pauseUntil !== null
        ? 'Substitution'
        : md.paused ? 'Paused' : 'Live';

  const remaining = g.subsRemaining();
  const sideCards = (
    <>
      <Card title="Match Stats" icon="stats" className="live-stats-card">
        <div className="cmp-head">
          <span>{homeClub.shortName}</span>
          <span>{awayClub.shortName}</span>
        </div>
        {STAT_ROWS.map(([key, label]) => {
          const h = stats[0][key];
          const a = stats[1][key];
          const total = h + a;
          return (
            <div className="cmp" key={key}>
              <div className="cmp-row">
                <span className="cmp-val">{h}</span>
                <span className="cmp-label">{label}</span>
                <span className="cmp-val">{a}</span>
              </div>
              <div className="cmp-bar">
                <span className="cmp-home" style={{ width: `${total > 0 ? (h / total) * 100 : 50}%` }} />
                <span className="cmp-away" style={{ width: `${total > 0 ? (a / total) * 100 : 50}%` }} />
              </div>
            </div>
          );
        })}
        <div className="prob-block">
          <span className="prob-label">Win probability</span>
          <div className="prob">
            <span className="prob-val">{(homeProb * 100).toFixed(0)}%</span>
            <div className="prob-bar">
              <span className="cmp-home" style={{ width: `${homeProb * 100}%` }} />
              <span className="cmp-away" style={{ width: `${(1 - homeProb) * 100}%` }} />
            </div>
            <span className="prob-val">{((1 - homeProb) * 100).toFixed(0)}%</span>
          </div>
        </div>
      </Card>
      <LiveRatingsCard ratings={ratings} defaultTeam={userTeamIdx} />
    </>
  );

  return (
    <div className="live">
      <div className="scoreboard">
        <div className={`sb-team${view.serving === 0 ? ' serving' : ''}`}>
          <SideCrest side={homeClub} size={42} />
          <div className="sb-team-text">
            <span className="sb-name">{homeClub.name}</span>
            <span className="sb-tag">Home{userTeamIdx === 0 ? ' · You' : ''}</span>
          </div>
          <span className="sb-serve" title="Serving"><Icon name="ball" size={17} /></span>
        </div>
        <div className="sb-center">
          <div className="sb-sets">
            <span>{view.homeSets}</span>
            <span className="sb-colon">:</span>
            <span>{view.awaySets}</span>
          </div>
          <div className="sb-live">
            <span className="sb-set-label">{view.matchOver ? 'Full time' : `Set ${view.set + 1}`}</span>
            <span className="sb-points">{view.homeScore} – {view.awayScore}</span>
            {setHistory.length > 0 && (
              <span className="set-chips">
                {setHistory.map(([h, a], i) => (
                  <span key={i} className="set-chip">
                    <span className={h > a ? 'won' : ''}>{h}</span>
                    <span className={a > h ? 'won' : ''}>{a}</span>
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className={`sb-team right${view.serving === 1 ? ' serving' : ''}`}>
          <span className="sb-serve" title="Serving"><Icon name="ball" size={17} /></span>
          <div className="sb-team-text">
            <span className="sb-name">{awayClub.name}</span>
            <span className="sb-tag">Away{userTeamIdx === 1 ? ' · You' : ''}</span>
          </div>
          <SideCrest side={awayClub} size={42} />
        </div>
      </div>

      <div className={`live-grid${compact ? ' compact' : ''}`}>
        {!compact && <div className="live-side">{sideCards}</div>}

        <div className="court-col">
          <div className="card court-panel">
            <LiveCourt
              scene={scene} store={store} kits={kits} teamOf={teamOf} ratings={ratings} labels={labels}
              // The referee sees a stoppage — and signals a time-out — once
              // the rally it followed has been shown.
              timeout={pending === null ? md.timeoutActive : null}
              paused={pending === null && md.paused}
              speed={md.speed}
              teamNames={[homeClub.shortName, awayClub.shortName]}
            />

            {/* Who plays which half — the user's side is always on the left. */}
            <span className="court-tag far">
              <SideCrest side={farClub} size={16} />
              <span className="court-tag-name">{farClub.shortName}</span>
              <span className="court-tag-sets">{farSets}</span>
            </span>
            <span className="court-tag near">
              <SideCrest side={nearClub} size={16} />
              <span className="court-tag-name">{nearClub.shortName}</span>
              <span className="court-tag-sets">{nearSets}</span>
            </span>
            <div className="court-labels" title="What to show beside each player">
              <Segmented<CourtLabels>
                size="sm"
                options={[['ratings', 'Ratings'], ['names', 'Names'], ['off', 'Off']]}
                value={labels}
                onChange={setLabels}
              />
            </div>

            {bigPlay !== null && (
              <div key={bigPlay.key} className={`big-play ${bigPlay.team === 0 ? 'home' : 'away'}`}>
                {bigPlay.text}
              </div>
            )}
            {subAnnouncement !== null && (
              <div
                key={subAnnouncement.key}
                className={`big-play sub-announcement ${subAnnouncement.team === 0 ? 'home' : 'away'}`}
              >
                {subAnnouncement.text}
              </div>
            )}
            {md.timeoutActive !== null && (
              <TimeoutPanel
                secondsLeft={timeoutSecondsLeft}
                calledBy={md.timeoutActive === 0 ? homeClub.shortName : awayClub.shortName}
              />
            )}
          </div>

          <div className="match-bar">
            <span className={`live-status status-${status.toLowerCase().replace(' ', '-')}`}>
              <span className="live-dot" />{status}
            </span>
            <Segmented
              size="sm"
              options={[[0.75, '0.75×'], [1, '1×'], [1.5, '1.5×']] as const}
              value={md.speed}
              onChange={(sp) => g.setSpeed(sp)}
            />
            {md.paused
              ? (
                <button className="sm" disabled={md.timeoutActive !== null} onClick={() => g.resume()} title="Resume">
                  <Icon name="play" size={14} /><span className="mb-text">Resume</span>
                </button>
              )
              : (
                <button className="sm" disabled={md.timeoutActive !== null} onClick={() => g.pause()} title="Pause">
                  <Icon name="pause" size={14} /><span className="mb-text">Pause</span>
                </button>
              )}
            <button
              className="sm"
              disabled={md.timeoutActive !== null || md.timeoutsUsed[userTeamIdx] >= 2}
              onClick={() => g.callTimeout()}
              title="Call a timeout"
            >
              <Icon name="whistle" size={14} /><span className="mb-text">Timeout</span>
              <span className="count-chip">{2 - md.timeoutsUsed[userTeamIdx]}</span>
            </button>
            <span className="flex-spacer" />
            <button className="sm danger" onClick={() => g.finishMatchdayNow()} title="Skip to the result">
              <Icon name="fastForward" size={14} /><span className="mb-text">Finish match</span>
            </button>
          </div>
        </div>

        <section className="card live-panel">
          <div className="panel-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'commentary'}
              className={`panel-tab${tab === 'commentary' ? ' active' : ''}`}
              onClick={() => setPanelTab('commentary')}
            >
              <Icon name="press" size={14} /> Commentary
            </button>
            <button
              role="tab"
              aria-selected={tab === 'subs'}
              className={`panel-tab${tab === 'subs' ? ' active' : ''}`}
              onClick={() => setPanelTab('subs')}
            >
              <Icon name="swap" size={14} /> Subs
              <span className={`panel-tab-count${remaining <= 0 ? ' bad' : ''}`}>{remaining}</span>
            </button>
            {compact && (
              <button
                role="tab"
                aria-selected={tab === 'stats'}
                className={`panel-tab${tab === 'stats' ? ' active' : ''}`}
                onClick={() => setPanelTab('stats')}
              >
                <Icon name="stats" size={14} /> Stats
              </button>
            )}
          </div>
          {tab === 'commentary' && (
            <div className="ticker-scroll" ref={logRef}>
              {shownLog.length > 0
                ? (
                  <RallyTicker
                    entries={shownLog.map((l) => l.entry)}
                    store={store}
                    homeCode={homeClub.shortName}
                    awayCode={awayClub.shortName}
                  />
                )
                : <div className="ticker-entry dim">Kicking off…</div>}
            </div>
          )}
          {tab === 'subs' && <Substitutions teamIdx={userTeamIdx} />}
          {tab === 'stats' && <div className="live-panel-stats">{sideCards}</div>}
        </section>
      </div>
    </div>
  );
}

/** A clickable, draggable player row for the substitution picker. Dragging one
 *  onto another (in either direction — bench-to-court or court-to-bench) subs
 *  them in one motion; clicking both, then confirming, does the same thing. */
function SubCard({
  playerIdx, store, rating, selected, isDragOver, onClick, onDropPlayer, onDragOverCard, onDragLeaveCard,
}: {
  playerIdx: number;
  store: PlayerStore;
  /** Live match rating, if the player has played yet. */
  rating?: number;
  selected: boolean;
  isDragOver: boolean;
  onClick: () => void;
  onDropPlayer: (draggedPlayerIdx: number) => void;
  onDragOverCard: () => void;
  onDragLeaveCard: () => void;
}): JSX.Element {
  const pos = store.position[playerIdx] as Position;
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
        {store.shortName(playerIdx)}
        {rating !== undefined && <RatingBadge value={rating} size="sm" />}
      </span>
      <Pos pos={pos} />
      <span className="bench-token-ability">{store.currentAbility[playerIdx]}</span>
      <Bar value={store.condition[playerIdx]} />
    </div>
  );
}

/**
 * Every player's live rating, one side at a time, best first. Players still
 * on court are marked; substitutes appear once they have played a rally.
 */
function LiveRatingsCard({
  ratings, defaultTeam,
}: {
  ratings: Map<number, number>;
  defaultTeam: 0 | 1;
}): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;
  const [team, setTeam] = useState<0 | 1>(defaultTeam);
  const players = md.sides[team].players;
  const court = (team === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  const libero = (team === 0 ? md.snapshot?.homeLibero : md.snapshot?.awayLibero) ?? -1;
  const rows = [...ratings.entries()]
    .filter(([p]) => players.includes(p))
    .sort((a, b) => b[1] - a[1]);
  const homeName = md.sides[0].shortName;
  const awayName = md.sides[1].shortName;

  return (
    <Card
      title="Ratings"
      icon="star"
      className="live-ratings-card"
      flush
      actions={(
        <Segmented<0 | 1>
          size="sm"
          options={[[0, homeName], [1, awayName]]}
          value={team}
          onChange={setTeam}
        />
      )}
    >
      <div className="live-ratings">
        {rows.length === 0 && <p className="empty">Ratings appear after the first rally.</p>}
        {rows.map(([p, r]) => {
          const onCourt = court.includes(p) || p === libero;
          return (
            <div className={`live-rating-row${onCourt ? '' : ' off'}`} key={p} title={store.fullName(p)}>
              <Pos pos={store.position[p] as Position} />
              <span className="live-rating-name">{store.shortName(p)}</span>
              <RatingBadge value={r} size="sm" />
            </div>
          );
        })}
      </div>
    </Card>
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
  const squad = md.sides[teamIdx].players;
  const store = world.players;
  const [outPlayer, setOutPlayer] = useState<number | null>(null);
  const [inPlayer, setInPlayer] = useState<number | null>(null);
  const [dragOverPlayer, setDragOverPlayer] = useState<number | null>(null);

  const onCourt = (teamIdx === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  // Liberos are changed in their own section below — they can never take an
  // ordinary rotation spot, so they never appear on this bench.
  const bench = squad.filter((p) =>
    !onCourt.includes(p) && g.matchAvailable(p) && store.position[p] !== Position.Libero);
  const ratings = g.liveRatings();
  const liberos = g.liveLiberos();
  const spareLiberos = squad.filter((p) =>
    store.position[p] === Position.Libero && g.matchAvailable(p) && !onCourt.includes(p)
    && p !== liberos.reception && p !== liberos.defence);
  const [liberoDragOver, setLiberoDragOver] = useState<'reception' | 'defence' | null>(null);
  // Reads the engine's own per-set counter — it resets every set, unlike a
  // UI-tracked total would (that used to be the bug here: it never reset).
  const remaining = g.subsRemaining();

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
          <p className="field-hint">
            Drag a bench player onto someone on court, or pick both and confirm. A player who comes off can
            only return for whoever replaced them.
          </p>
        </div>

        <div className="sub-cols">
          <div className="sub-col">
            <div className="section-label">On court — pick who comes off</div>
            <div className="sub-list">
              {onCourt.map((p) => (
                <SubCard
                  key={p}
                  playerIdx={p}
                  store={store}
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
                  rating={ratings.get(p)}
                  selected={inPlayer === p}
                  onClick={() => setInPlayer(inPlayer === p ? null : p)}
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
      </div>

      <div className="sub-confirm">
        <span className="sub-summary">
          {outPlayer !== null
            ? <><span className="bad">▼ {store.shortName(outPlayer)}</span> off</>
            : <span className="faint">Pick who comes off</span>}
          <span className="faint">·</span>
          {inPlayer !== null
            ? <><span className="good">▲ {store.shortName(inPlayer)}</span> on</>
            : <span className="faint">Pick who comes on</span>}
        </span>
        <button
          className="primary"
          disabled={outPlayer === null || inPlayer === null || remaining <= 0}
          onClick={makeSub}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
