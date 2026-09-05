import { useEffect, useRef, useState, type JSX } from 'react';
import { Position, POSITION_SHORT } from '../../engine/model/positions.ts';
import type { PlayerStore } from '../../engine/model/players.ts';
import type { RallyContact } from '../../engine/match/engine.ts';
import {
  ClubLink, Flag, PlayerFace, POSITION_ACCENT,
} from '../components.tsx';
import { RallyTicker } from './Match.tsx';
import { useGame, type MatchdayLogEntry } from '../state.ts';

const ZONE_ORDER = [3, 2, 1, 4, 5, 0]; // front row first: 4,3,2 then back row 5,6,1
const ZONE_LABELS = ['1', '2', '3', '4', '5', '6'];

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
    const attackerZone = attackerCourt.indexOf(active.player);
    if (attackerZone !== -1) {
      const attackerX = zonePercent(attackerZone, actingSide).x;
      x += (attackerX - x) * 0.5; // blockers shift to match the hitter
    }
    y += towardNet(side, 6);
  }

  return { x: clampPct(x), y: clampPct(y) };
}

/** Move the ball through one rally's contacts, one at a time. */
async function animateRally(
  logEntry: MatchdayLogEntry,
  speed: number,
  cancelled: { current: boolean },
  setBall: (pos: BallPos | null) => void,
  setActive: (c: ActiveContact | null) => void,
): Promise<void> {
  const perContact = 260 / speed;
  for (const c of logEntry.entry.contacts) {
    if (cancelled.current) return;
    const side: 'home' | 'away' = c.team === 0 ? 'home' : 'away';
    const court = c.team === 0 ? logEntry.homeCourt : logEntry.awayCourt;
    const zone = court.indexOf(c.player);
    if (zone !== -1) setBall({ side, ...zonePercent(zone, side) });
    setActive({ kind: c.kind, team: c.team, player: c.player });
    await sleep(perContact);
  }
}

/** A player's dot on the 2D court: their photo, ringed in their role's colour. */
function PlayerMarker({
  playerIdx, zone, side, store, active, homeCourt, awayCourt,
}: {
  playerIdx: number;
  zone: number;
  side: 'home' | 'away';
  store: PlayerStore;
  active: ActiveContact | null;
  homeCourt: number[];
  awayCourt: number[];
}): JSX.Element {
  const { x, y } = formationPosition(zone, side, playerIdx, store, active, homeCourt, awayCourt);
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
    </div>
  );
}

/** The court itself: a two-team pitch with every starter's photo in their zone. */
function Court2D({
  homeCourt, awayCourt, store, ball, active,
}: {
  homeCourt: number[];
  awayCourt: number[];
  store: PlayerStore;
  ball: BallPos | null;
  active: ActiveContact | null;
}): JSX.Element {
  return (
    <div className="court2d">
      <div className="court2d-attack-line away" />
      <div className="court2d-net" />
      <div className="court2d-attack-line home" />
      {[0, 1, 2, 3, 4, 5].map((z) => {
        const p = homeCourt[z];
        return p === undefined ? null : (
          <PlayerMarker
            key={`h${z}`} playerIdx={p} zone={z} side="home" store={store}
            active={active} homeCourt={homeCourt} awayCourt={awayCourt}
          />
        );
      })}
      {[0, 1, 2, 3, 4, 5].map((z) => {
        const p = awayCourt[z];
        return p === undefined ? null : (
          <PlayerMarker
            key={`a${z}`} playerIdx={p} zone={z} side="away" store={store}
            active={active} homeCourt={homeCourt} awayCourt={awayCourt}
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

function LineupSetup(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const md = g.matchday!;
  const store = world.players;

  const opponent = world.clubs[md.userIsHome ? md.fixture.away : md.fixture.home];
  const available = club.players.filter((p) => store.isAvailable(p));
  const bench = available.filter((p) => !md.homeLineup.includes(p));

  return (
    <>
      <h1>Team Sheet</h1>
      <p className="subtitle">
        {md.userIsHome ? 'vs' : 'at'} {opponent !== undefined ? <ClubLink id={opponent.id} /> : '—'}
      </p>

      <div className="panels">
        <div className="panel">
          <h3>Starting six</h3>
          <div className="court">
            {ZONE_ORDER.map((z) => {
              const p = md.homeLineup[z];
              if (p === undefined) return <div className="zone" key={z} />;
              const pos = store.position[p] as Position;
              const isSetter = POSITION_SHORT[pos] === 'S';
              return (
                <div className={`zone${isSetter ? ' setter' : ''}`} key={z}>
                  <div className="z">Zone {ZONE_LABELS[z]}</div>
                  <div>{store.shortName(p)}</div>
                  <div className="faint">{POSITION_SHORT[pos]}</div>
                  <select
                    value={p}
                    onChange={(e) => g.setMatchdayPlayer(z, Number(e.target.value))}
                    style={{ marginTop: 4, width: '100%' }}
                  >
                    <option value={p}>{store.shortName(p)}</option>
                    {bench.map((b) => (
                      <option key={b} value={b}>
                        {store.shortName(b)} ({POSITION_SHORT[store.position[b] as Position]})
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            Libero: {md.homeLibero >= 0 ? store.shortName(md.homeLibero) : 'None available'}
          </p>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <button className="primary" onClick={() => g.kickOff()}>Kick off</button>
      </div>
    </>
  );
}

function LiveMatchView(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;
  const snap = md.snapshot;
  const logRef = useRef<HTMLDivElement>(null);
  const [ball, setBall] = useState<BallPos | null>(null);
  const [active, setActive] = useState<ActiveContact | null>(null);
  const cancelledRef = useRef(false);

  // Drives the match forward itself: play a rally, animate it, repeat.
  // No timer in state.ts — pacing is entirely a presentation concern here.
  useEffect(() => {
    cancelledRef.current = false;
    const run = async (): Promise<void> => {
      while (!cancelledRef.current) {
        const current = g.matchday;
        if (current === null) break;
        if (current.paused) {
          await sleep(150);
          continue;
        }
        const logEntry = g.playNextRally();
        if (logEntry === null) break;
        await animateRally(logEntry, current.speed, cancelledRef, setBall, setActive);
        if (cancelledRef.current) break;
        setActive(null); // reset to base rotation positions between points
        await sleep(280 / current.speed);
      }
    };
    void run();
    return () => { cancelledRef.current = true; };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [md.log.length]);

  const homeClub = world.clubs[md.fixture.home];
  const awayClub = world.clubs[md.fixture.away];
  const userTeamIdx: 0 | 1 = md.userIsHome ? 0 : 1;

  return (
    <>
      <div className="scoreline">
        <span className="team">
          {homeClub !== undefined && <Flag nation={homeClub.nation} />} {homeClub?.shortName ?? '—'}
        </span>
        <span className="sets">{snap?.homeSets ?? 0} — {snap?.awaySets ?? 0}</span>
        <span className="team">
          {awayClub !== undefined && <Flag nation={awayClub.nation} />} {awayClub?.shortName ?? '—'}
        </span>
        {snap !== null && (
          <span className="mono faint">Set {snap.set + 1} · {snap.homeScore}-{snap.awayScore}</span>
        )}
      </div>

      <div className="toolbar">
        {([1, 1.25, 1.75] as const).map((s) => (
          <button key={s} className={md.speed === s ? 'primary' : ''} onClick={() => g.setSpeed(s)}>
            {s}x
          </button>
        ))}
        {md.paused
          ? <button onClick={() => g.resume()}>Resume</button>
          : <button onClick={() => g.pause()}>Pause</button>}
        <button onClick={() => g.finishMatchdayNow()}>Finish match</button>
      </div>

      <div className="live-match-layout">
        <div className="panel court-panel">
          <div className="team-strip">
            <span className="team-strip-name">
              {awayClub !== undefined && <Flag nation={awayClub.nation} />} {awayClub?.name ?? '—'}
            </span>
            <span className="pill">Sets: {snap?.awaySets ?? 0}</span>
          </div>
          <Court2D
            homeCourt={snap?.homeCourt ?? []}
            awayCourt={snap?.awayCourt ?? []}
            store={store}
            ball={ball}
            active={active}
          />
          <div className="team-strip">
            <span className="pill">Sets: {snap?.homeSets ?? 0}</span>
            <span className="team-strip-name">
              {homeClub !== undefined && <Flag nation={homeClub.nation} />} {homeClub?.name ?? '—'}
            </span>
          </div>
        </div>

        <div className="panel ticker-panel">
          <h3 style={{ marginTop: 0 }}>Live ticker</h3>
          <div className="ticker-scroll" ref={logRef}>
            <RallyTicker
              entries={md.log.map((l) => l.entry)}
              store={store}
              homeCode={homeClub?.shortName ?? '—'}
              awayCode={awayClub?.shortName ?? '—'}
            />
            {md.log.length === 0 && <div className="ticker-entry dim">Kicking off…</div>}
          </div>
        </div>
      </div>

      <Substitutions teamIdx={userTeamIdx} />
    </>
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

  const onCourt = (teamIdx === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  const bench = club.players.filter((p) => !onCourt.includes(p) && store.isAvailable(p));
  const remaining = 6 - md.subsUsed;

  const makeSub = (): void => {
    if (outPlayer === null || inPlayer === null) return;
    g.substitute(outPlayer, inPlayer);
    setOutPlayer(null);
    setInPlayer(null);
  };

  return (
    <div className="panel" style={{ marginTop: 16, maxWidth: 480 }}>
      <h3>Substitutions ({remaining} left this set)</h3>
      <div className="kv">
        <span className="k">Off</span>
        <select value={outPlayer ?? ''} onChange={(e) => setOutPlayer(Number(e.target.value))}>
          <option value="" disabled>Choose a player</option>
          {onCourt.map((p) => <option key={p} value={p}>{store.shortName(p)}</option>)}
        </select>
      </div>
      <div className="kv">
        <span className="k">On</span>
        <select value={inPlayer ?? ''} onChange={(e) => setInPlayer(Number(e.target.value))}>
          <option value="" disabled>Choose a replacement</option>
          {bench.map((p) => <option key={p} value={p}>{store.shortName(p)}</option>)}
        </select>
      </div>
      <button
        style={{ marginTop: 8 }}
        disabled={outPlayer === null || inPlayer === null || remaining <= 0}
        onClick={makeSub}
      >
        Make substitution
      </button>
    </div>
  );
}
