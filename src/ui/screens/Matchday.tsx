import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { Position } from '../../engine/model/positions.ts';
import type { PlayerStore } from '../../engine/model/players.ts';
import type { RallyContact } from '../../engine/match/engine.ts';
import { effectivePlayerAt } from '../../engine/match/court.ts';
import {
  abilityClass, Bar, Card, ChoiceField, ClubCrest, PlayerFace, Pos, POSITION_ACCENT, RatingBadge, Segmented,
  StarMeter,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { TeamSheet, ZONE_LABELS, ZONE_ORDER } from '../teamSheet.tsx';
import { DEFENSE_OPTIONS, OFFENSE_OPTIONS, SERVE_OPTIONS, TEMPO_OPTIONS } from './Manage.tsx';
import { RallyTicker } from './Match.tsx';
import { useGame, type MatchdayLogEntry } from '../state.ts';

/** Column/row of each zone within the 3x2 grid, derived once from ZONE_ORDER. */
const ZONE_GRID: Record<number, { row: 0 | 1; col: 0 | 1 | 2 }> = {};
ZONE_ORDER.forEach((z, i) => {
  ZONE_GRID[z] = { row: i < 3 ? 0 : 1, col: (i % 3) as 0 | 1 | 2 };
});

interface BallPos {
  side: 'home' | 'away';
  x: number;
  y: number;
}

/**
 * Screen position (% of the combined court2d box) for a zone on a given side.
 *
 * Columns are inset to 20/50/80 rather than spanning the full 0-100 width:
 * .court2d's clip-path tapers the court toward each baseline, so a column at
 * the true edge would fall outside the shape at the back row. Insetting
 * keeps every marker inside the taper at every row.
 */
function zonePercent(zone: number, side: 'home' | 'away'): { x: number; y: number } {
  const grid = ZONE_GRID[zone];
  if (grid === undefined) return { x: 50, y: 50 };
  const x = 20 + grid.col * 30;
  const isFront = grid.row === 0;
  // Both teams' front rows sit adjacent to the shared net line at y=50.
  const rowFrac = side === 'home' ? (isFront ? 0.75 : 0.25) : (isFront ? 0.25 : 0.75);
  const halfTop = side === 'home' ? 0 : 50;
  return { x, y: halfTop + rowFrac * 50 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Which broad phase of the rally a contact belongs to, for formation purposes. */
type Phase = 'serve' | 'receive' | 'set' | 'attack' | 'react';

function phaseFromKind(kind: RallyContact['kind']): Phase {
  switch (kind) {
    case 'serve': case 'serveError': return 'serve';
    case 'reception': case 'receptionError': case 'freeball':
    case 'dig': case 'digError': return 'receive';
    case 'set': case 'setError': return 'set';
    case 'attack': case 'kill': case 'attackError':
    case 'blocked': case 'blockTouch': case 'ace': return 'attack';
    default: return 'react';
  }
}

interface ActiveContact { kind: RallyContact['kind']; team: 0 | 1; player: number; }

/** Which zone (0-5) a resolved on-court player is standing in, accounting for
 *  the libero substitution — the inverse of `effectivePlayerAt`. Used to place
 *  the ball and to read a player's true role (libero, not the middle blocker
 *  they replaced) wherever the raw court array would otherwise be searched
 *  directly for a player index. */
function zoneOf(court: number[], store: PlayerStore, liberoIdx: number, playerIdx: number): number {
  for (let z = 0; z < 6; z++) {
    if (effectivePlayerAt(court, z, store.position, liberoIdx) === playerIdx) return z;
  }
  return -1;
}

/** Positive `amount` always means "toward the shared net," on either half. */
function towardNet(side: 'home' | 'away', amount: number): number {
  return side === 'home' ? amount : -amount;
}

function clampPct(v: number): number {
  return Math.max(6, Math.min(94, v));
}

/**
 * A player's position for the instant the rally is currently animating —
 * not just their static rotation zone. Everyone drifts toward what they'd
 * actually be doing: a setter releases to the net the moment their side
 * takes the serve (whatever zone the rotation has them standing in), hitters
 * press forward to attack, and blockers shift to match the hitter.
 */
function formationPosition(
  zone: number,
  side: 'home' | 'away',
  playerIdx: number,
  store: PlayerStore,
  active: ActiveContact | null,
  homeCourt: number[],
  awayCourt: number[],
  homeLibero: number,
  awayLibero: number,
): { x: number; y: number } {
  const base = zonePercent(zone, side);
  if (active === null) return base;

  const phase = phaseFromKind(active.kind);
  if (phase === 'serve' || phase === 'react') return base;

  const actingSide: 'home' | 'away' = active.team === 0 ? 'home' : 'away';
  const isActingTeam = actingSide === side;
  const grid = ZONE_GRID[zone];
  const isFrontRow = grid?.row === 0;
  const isActor = active.player === playerIdx;
  const role = store.position[playerIdx] as Position;

  let { x, y } = base;

  if (isActingTeam) {
    if (role === Position.Setter && (phase === 'receive' || phase === 'set')) {
      // Releases toward the net-side target area regardless of their zone —
      // this is the cue that makes a P1 (setter back row) reception read
      // correctly instead of leaving them stuck at the back.
      const pull = phase === 'set' ? 0.75 : 0.4;
      const targetY = side === 'home' ? 38 : 62;
      x += (68 - x) * pull;
      y += (targetY - y) * pull;
    } else if (phase === 'receive') {
      y += towardNet(side, isFrontRow ? 3 : -4);
      if (isActor) x += (50 - x) * 0.15;
    } else if (phase === 'attack') {
      if (isActor) y += towardNet(side, 8);
      else if (isFrontRow) y += towardNet(side, 4);
      else y += towardNet(side, -2);
    }
  } else if (phase === 'set' && isFrontRow) {
    y += towardNet(side, 3); // blockers start reading the set
  } else if (phase === 'attack' && isFrontRow) {
    const attackerCourt = actingSide === 'home' ? homeCourt : awayCourt;
    const attackerLibero = actingSide === 'home' ? homeLibero : awayLibero;
    const attackerZone = zoneOf(attackerCourt, store, attackerLibero, active.player);
    if (attackerZone !== -1) {
      const attackerX = zonePercent(attackerZone, actingSide).x;
      x += (attackerX - x) * 0.5; // blockers shift to match the hitter
    }
    y += towardNet(side, 6);
  }

  return { x: clampPct(x), y: clampPct(y) };
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

/**
 * Which team the callout should be coloured for. For a kill or an ace that's
 * simply whoever made the contact — but a block or an error is logged
 * against the player who lost the point, so the credit flips to the other side.
 */
function creditTeamFor(kind: RallyContact['kind'], actingTeam: 0 | 1): 0 | 1 {
  if (kind === 'blocked' || kind === 'attackError' || kind === 'serveError') {
    return (1 - actingTeam) as 0 | 1;
  }
  return actingTeam;
}

/** Move the ball through one rally's contacts, one at a time. */
async function animateRally(
  logEntry: MatchdayLogEntry,
  store: PlayerStore,
  speed: number,
  cancelled: { current: boolean },
  setBall: (pos: BallPos | null) => void,
  setActive: (c: ActiveContact | null) => void,
  onBigPlay: (text: string, team: 0 | 1) => void,
): Promise<void> {
  // Baseline tuned so 1x plays at what used to be 0.75x — that read better.
  const perContact = 560 / speed;
  for (const c of logEntry.entry.contacts) {
    if (cancelled.current) return;
    const side: 'home' | 'away' = c.team === 0 ? 'home' : 'away';
    const court = c.team === 0 ? logEntry.homeCourt : logEntry.awayCourt;
    const libero = c.team === 0 ? logEntry.homeLibero : logEntry.awayLibero;
    const zone = zoneOf(court, store, libero, c.player);
    if (zone !== -1) setBall({ side, ...zonePercent(zone, side) });
    setActive({ kind: c.kind, team: c.team, player: c.player });
    const callout = pickBigPlay(c.kind);
    if (callout !== null) onBigPlay(callout, creditTeamFor(c.kind, c.team));
    await sleep(perContact);
  }
}

/** A player's dot on the 2D court: their photo, ringed in their role's colour. */
function PlayerMarker({
  playerIdx, zone, side, store, active, homeCourt, awayCourt, homeLibero, awayLibero, rating,
}: {
  playerIdx: number;
  zone: number;
  side: 'home' | 'away';
  store: PlayerStore;
  active: ActiveContact | null;
  homeCourt: number[];
  awayCourt: number[];
  homeLibero: number;
  awayLibero: number;
  /** Live match rating, once the player has one. */
  rating?: number;
}): JSX.Element {
  const { x, y } = formationPosition(
    zone, side, playerIdx, store, active, homeCourt, awayCourt, homeLibero, awayLibero,
  );
  const pos = store.position[playerIdx] as Position;
  const isActor = active !== null && active.player === playerIdx;
  return (
    <div
      className={`player-marker${isActor ? ' is-active' : ''}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      title={`${store.fullName(playerIdx)} · Zone ${ZONE_LABELS[zone]}`}
    >
      <PlayerFace playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} size={38} />
      <span className="player-marker-ring" style={{ boxShadow: `0 0 0 2px ${POSITION_ACCENT[pos]}` }} />
      <span className="player-marker-label">{store.shortName(playerIdx)}</span>
      {rating !== undefined && (
        <span className="player-marker-rating"><RatingBadge value={rating} size="sm" /></span>
      )}
    </div>
  );
}

/** The court itself: a two-team pitch with every starter's photo in their zone. */
function Court2D({
  homeCourt, awayCourt, homeLibero, awayLibero, store, ball, active, ratings,
}: {
  homeCourt: number[];
  awayCourt: number[];
  homeLibero: number;
  awayLibero: number;
  store: PlayerStore;
  ball: BallPos | null;
  active: ActiveContact | null;
  ratings: Map<number, number>;
}): JSX.Element {
  return (
    <div className="court2d">
      <div className="court2d-attack-line away" />
      <div className="court2d-net" />
      <div className="court2d-attack-line home" />
      {[0, 1, 2, 3, 4, 5].map((z) => {
        // Resolved through the libero substitution, so the back-row middle
        // blocker's zone shows the libero who actually replaced them out
        // there rather than the middle blocker they came off for.
        const p = effectivePlayerAt(homeCourt, z, store.position, homeLibero);
        return p === undefined ? null : (
          <PlayerMarker
            key={`h${z}`} playerIdx={p} zone={z} side="home" store={store}
            active={active} homeCourt={homeCourt} awayCourt={awayCourt}
            homeLibero={homeLibero} awayLibero={awayLibero} rating={ratings.get(p)}
          />
        );
      })}
      {[0, 1, 2, 3, 4, 5].map((z) => {
        const p = effectivePlayerAt(awayCourt, z, store.position, awayLibero);
        return p === undefined ? null : (
          <PlayerMarker
            key={`a${z}`} playerIdx={p} zone={z} side="away" store={store}
            active={active} homeCourt={homeCourt} awayCourt={awayCourt}
            homeLibero={homeLibero} awayLibero={awayLibero} rating={ratings.get(p)}
          />
        );
      })}
      {ball !== null && (
        <span className="ball" style={{ left: `${ball.x}%`, top: `${ball.y}%` }} />
      )}
    </div>
  );
}

export function MatchdayScreen(): JSX.Element | null {
  const g = useGame();
  const md = g.matchday;
  if (md === null) return null;
  return md.stage === 'lineup' ? <LineupSetup /> : <LiveMatchView />;
}

/** Average current ability of a squad's best six — a quick read of how strong a side is. */
function bestSixAverage(players: readonly number[], store: PlayerStore): number {
  const top = [...players]
    .filter((p) => store.isAvailable(p))
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])
    .slice(0, 6);
  return top.length > 0 ? Math.round(top.reduce((s, p) => s + store.currentAbility[p], 0) / top.length) : 0;
}

function LineupSetup(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const md = g.matchday!;
  const store = world.players;

  const opponent = world.clubs[md.userIsHome ? md.fixture.away : md.fixture.home];
  const home = world.clubs[md.fixture.home];
  const away = world.clubs[md.fixture.away];
  const comp = world.competitions[md.fixture.competitionId];
  const available = club.players.filter((p) => store.isAvailable(p));
  const bench = available.filter((p) =>
    !md.homeLineup.includes(p) && p !== md.homeLibero && p !== md.homeDefensiveLibero);

  const starters = md.homeLineup.filter((p): p is number => p !== undefined);
  const teamAvg = starters.length > 0
    ? Math.round(starters.reduce((s, p) => s + store.currentAbility[p], 0) / starters.length)
    : 0;
  const oppAvg = opponent !== undefined ? bestSixAverage(opponent.players, store) : 0;

  return (
    <div className="md-setup">
      <div className="md-banner">
        <div className="md-banner-team">
          {home !== undefined && <ClubCrest club={home} size={60} />}
          <div className="md-banner-team-text">
            <span className="md-banner-name">{home?.name ?? '—'}</span>
            <span className="md-banner-tag">Home{md.userIsHome ? ' · Your team' : ''}</span>
          </div>
        </div>
        <div className="md-banner-mid">
          <span className="md-banner-comp">{comp?.name ?? 'Match'}</span>
          <span className="md-banner-vs">VS</span>
          <span className="md-banner-date">{g.weekdayLabelForDay(md.fixture.day)} {g.dateLabelForDay(md.fixture.day)}</span>
        </div>
        <div className="md-banner-team right">
          <div className="md-banner-team-text">
            <span className="md-banner-name">{away?.name ?? '—'}</span>
            <span className="md-banner-tag">Away{!md.userIsHome ? ' · Your team' : ''}</span>
          </div>
          {away !== undefined && <ClubCrest club={away} size={60} />}
        </div>
      </div>

      <div className="md-setup-bar">
        <div className="lineup-bar-rating">
          <span className="faint">Your starting six</span>
          <StarMeter value={teamAvg} size={16} />
          <strong className={abilityClass(teamAvg)}>{teamAvg}</strong>
        </div>
        {opponent !== undefined && (
          <div className="lineup-bar-rating">
            <span className="faint">{opponent.shortName} best six</span>
            <StarMeter value={oppAvg} size={16} />
            <strong className={abilityClass(oppAvg)}>{oppAvg}</strong>
          </div>
        )}
        <span className="flex-spacer" />
        <button className="primary lg" onClick={() => g.kickOff()}>
          <Icon name="whistle" size={18} /> Kick off
        </button>
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
}): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const t = club.tactics;
  return (
    <div className="timeout-panel">
      <div className="timeout-head">
        <span className="timeout-icon"><Icon name="whistle" size={22} /></span>
        <div className="timeout-title">
          <strong>Timeout{calledBy !== undefined ? ` — ${calledBy}` : ''}</strong>
          <span className="faint">Adjust your tactics or make substitutions below — changes apply from the next rally.</span>
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
  const [ball, setBall] = useState<BallPos | null>(null);
  const [active, setActive] = useState<ActiveContact | null>(null);
  const [bigPlay, setBigPlay] = useState<{ text: string; team: 0 | 1; key: number } | null>(null);
  const [subAnnouncement, setSubAnnouncement] = useState<{ text: string; team: 0 | 1; key: number } | null>(null);
  const [timeoutSecondsLeft, setTimeoutSecondsLeft] = useState(TIMEOUT_SECONDS);
  const cancelledRef = useRef(false);
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
    const teamName = (sub.team === 0 ? world.clubs[md.fixture.home] : world.clubs[md.fixture.away])
      ?.shortName ?? '';
    const text = sub.libero !== undefined
      ? `${teamName}: ${store.shortName(sub.inPlayerIdx)} in as ${sub.libero === 'reception' ? 'reception' : 'defensive'} libero`
      : `${teamName}: ${store.shortName(sub.inPlayerIdx)} ON for ${store.shortName(sub.outPlayerIdx)}`;
    setSubAnnouncement({ text, team: sub.team, key: sub.seq });
    if (subAnnounceTimer.current !== undefined) clearTimeout(subAnnounceTimer.current);
    subAnnounceTimer.current = setTimeout(() => setSubAnnouncement(null), 3000);
  }, [lastSubSeq]);

  // Drives the match forward itself: play a rally, animate it, repeat.
  // No timer in state.ts — pacing is entirely a presentation concern here.
  useEffect(() => {
    cancelledRef.current = false;
    const run = async (): Promise<void> => {
      while (!cancelledRef.current) {
        const current = g.matchday;
        if (current === null) break;
        if (current.paused) {
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
        const logEntry = g.playNextRally();
        if (logEntry === null) break;
        await animateRally(logEntry, store, current.speed, cancelledRef, setBall, setActive, triggerBigPlay);
        if (cancelledRef.current) break;
        setActive(null); // reset to base rotation positions between points
        await sleep(733 / current.speed);
      }
    };
    void run();
    return () => {
      cancelledRef.current = true;
      clearTimeout(bigPlayTimer.current);
      clearTimeout(subAnnounceTimer.current);
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [md.log.length]);

  const homeClub = world.clubs[md.fixture.home];
  const awayClub = world.clubs[md.fixture.away];
  const userTeamIdx: 0 | 1 = md.userIsHome ? 0 : 1;
  const stats = liveStats(md.log);
  const ratings = g.liveRatings();
  const setHistory = completedSets(md.log, snap?.set ?? 0, snap?.matchOver ?? false);
  const homeProb = md.log.length > 0 ? md.log[md.log.length - 1].entry.homeWinProb : 0.5;
  const status = md.timeoutActive !== null
    ? 'Timeout'
    : md.paused && md.pauseUntil !== null
      ? 'Substitution'
      : md.paused ? 'Paused' : 'Live';

  return (
    <div className="live">
      <div className="scoreboard">
        <div className={`sb-team${snap?.serving === 0 ? ' serving' : ''}`}>
          {homeClub !== undefined && <ClubCrest club={homeClub} size={54} />}
          <div className="sb-team-text">
            <span className="sb-name">{homeClub?.name ?? '—'}</span>
            <span className="sb-tag">Home{userTeamIdx === 0 ? ' · You' : ''}</span>
          </div>
          <span className="sb-serve" title="Serving"><Icon name="ball" size={18} /></span>
        </div>
        <div className="sb-center">
          <div className="sb-sets">
            <span>{snap?.homeSets ?? 0}</span>
            <span className="sb-colon">:</span>
            <span>{snap?.awaySets ?? 0}</span>
          </div>
          <div className="sb-live">
            <span className="sb-set-label">Set {(snap?.set ?? 0) + 1}</span>
            <span className="sb-points">{snap?.homeScore ?? 0} – {snap?.awayScore ?? 0}</span>
          </div>
          {setHistory.length > 0 && (
            <div className="set-chips">
              {setHistory.map(([h, a], i) => (
                <span key={i} className="set-chip">
                  <span className={h > a ? 'won' : ''}>{h}</span>
                  <span className={a > h ? 'won' : ''}>{a}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={`sb-team right${snap?.serving === 1 ? ' serving' : ''}`}>
          <span className="sb-serve" title="Serving"><Icon name="ball" size={18} /></span>
          <div className="sb-team-text">
            <span className="sb-name">{awayClub?.name ?? '—'}</span>
            <span className="sb-tag">Away{userTeamIdx === 1 ? ' · You' : ''}</span>
          </div>
          {awayClub !== undefined && <ClubCrest club={awayClub} size={54} />}
        </div>
      </div>

      <div className="live-controls">
        <div className="live-controls-group">
          <span className="faint">Speed</span>
          <Segmented
            size="sm"
            options={[[0.75, '0.75×'], [1, '1×'], [1.5, '1.5×']] as const}
            value={md.speed}
            onChange={(s) => g.setSpeed(s)}
          />
        </div>
        {md.paused
          ? (
            <button disabled={md.timeoutActive !== null} onClick={() => g.resume()}>
              <Icon name="play" size={14} /> Resume
            </button>
          )
          : (
            <button disabled={md.timeoutActive !== null} onClick={() => g.pause()}>
              <Icon name="pause" size={14} /> Pause
            </button>
          )}
        <button
          disabled={md.timeoutActive !== null || md.timeoutsUsed[userTeamIdx] >= 2}
          onClick={() => g.callTimeout()}
        >
          <Icon name="whistle" size={14} /> Timeout
          <span className="count-chip">{2 - md.timeoutsUsed[userTeamIdx]} left</span>
        </button>
        <span className="flex-spacer" />
        <span className={`live-status status-${status.toLowerCase()}`}>
          <span className="live-dot" />{status}
        </span>
        <button className="danger" onClick={() => g.finishMatchdayNow()}>
          <Icon name="fastForward" size={14} /> Finish match
        </button>
      </div>

      {md.timeoutActive !== null && (
        <TimeoutPanel
          secondsLeft={timeoutSecondsLeft}
          calledBy={md.timeoutActive === 0 ? homeClub?.shortName : awayClub?.shortName}
        />
      )}

      <div className="live-grid">
        <div className="live-side">
          <Card title="Match Stats" icon="stats">
            <div className="cmp-head">
              <span>{homeClub?.shortName ?? 'Home'}</span>
              <span>{awayClub?.shortName ?? 'Away'}</span>
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
          </Card>
          <LiveRatingsCard ratings={ratings} defaultTeam={userTeamIdx} />
          <Card title="Win Probability" icon="stats">
            <div className="prob">
              <span className="prob-val">{(homeProb * 100).toFixed(0)}%</span>
              <div className="prob-bar">
                <span className="cmp-home" style={{ width: `${homeProb * 100}%` }} />
                <span className="cmp-away" style={{ width: `${(1 - homeProb) * 100}%` }} />
              </div>
              <span className="prob-val">{((1 - homeProb) * 100).toFixed(0)}%</span>
            </div>
            <div className="cmp-head">
              <span>{homeClub?.shortName ?? 'Home'}</span>
              <span>{awayClub?.shortName ?? 'Away'}</span>
            </div>
          </Card>
        </div>

        <div className="card court-panel">
          {/* Court2D always draws the fixture's home club in the top half and
              away in the bottom half (see zonePercent) — these strips must
              match that or a team's label ends up over the other team's players. */}
          <div className="team-strip">
            <span className="team-strip-name">
              {homeClub !== undefined && <ClubCrest club={homeClub} size={18} />} {homeClub?.name ?? '—'}
            </span>
            <span className="team-strip-sets">Sets {snap?.homeSets ?? 0}</span>
          </div>

          <Court2D
            homeCourt={snap?.homeCourt ?? []}
            awayCourt={snap?.awayCourt ?? []}
            homeLibero={snap?.homeLibero ?? -1}
            awayLibero={snap?.awayLibero ?? -1}
            store={store}
            ball={ball}
            active={active}
            ratings={ratings}
          />
          <div className="team-strip">
            <span className="team-strip-sets">Sets {snap?.awaySets ?? 0}</span>
            <span className="team-strip-name">
              {awayClub !== undefined && <ClubCrest club={awayClub} size={18} />} {awayClub?.name ?? '—'}
            </span>
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
        </div>

        <Card className="ticker-panel" title="Commentary" icon="press" flush>
          <div className="ticker-scroll" ref={logRef}>
            <RallyTicker
              entries={md.log.map((l) => l.entry)}
              store={store}
              homeCode={homeClub?.shortName ?? '—'}
              awayCode={awayClub?.shortName ?? '—'}
            />
            {md.log.length === 0 && <div className="ticker-entry dim">Kicking off…</div>}
          </div>
        </Card>
      </div>

      <Substitutions teamIdx={userTeamIdx} />
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
      <PlayerFace playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} size={30} />
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
  const clubId = team === 0 ? md.fixture.home : md.fixture.away;
  const court = (team === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  const libero = (team === 0 ? md.snapshot?.homeLibero : md.snapshot?.awayLibero) ?? -1;
  const rows = [...ratings.entries()]
    .filter(([p]) => store.clubId[p] === clubId)
    .sort((a, b) => b[1] - a[1]);
  const homeName = world.clubs[md.fixture.home]?.shortName ?? 'Home';
  const awayName = world.clubs[md.fixture.away]?.shortName ?? 'Away';

  return (
    <Card
      title="Ratings"
      icon="star"
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
          <PlayerFace playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} size={30} />
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
  const club = g.club!;
  const store = world.players;
  const [outPlayer, setOutPlayer] = useState<number | null>(null);
  const [inPlayer, setInPlayer] = useState<number | null>(null);
  const [dragOverPlayer, setDragOverPlayer] = useState<number | null>(null);

  const onCourt = (teamIdx === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  // Liberos are changed in their own section below — they can never take an
  // ordinary rotation spot, so they never appear on this bench.
  const bench = club.players.filter((p) =>
    !onCourt.includes(p) && store.isAvailable(p) && store.position[p] !== Position.Libero);
  const ratings = g.liveRatings();
  const liberos = g.liveLiberos();
  const spareLiberos = club.players.filter((p) =>
    store.position[p] === Position.Libero && store.isAvailable(p) && !onCourt.includes(p)
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
    <Card
      className="sub-panel"
      title="Substitutions"
      icon="swap"
      actions={<span className={`count-chip${remaining <= 0 ? ' bad' : ''}`}>{remaining} left this set</span>}
    >
      <p className="field-hint">
        Drag a bench player onto someone on court to bring them on — or pick both and confirm. A player
        who comes off can only return for whoever replaced them.
      </p>

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
        <div className="sub-arrow"><Icon name="swap" size={22} /></div>
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
                <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={30} />
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
          Confirm substitution
        </button>
      </div>
    </Card>
  );
}
