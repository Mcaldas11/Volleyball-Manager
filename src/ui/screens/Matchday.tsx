import { useEffect, useRef, useState, type JSX } from 'react';
import { POSITION_SHORT, type Position } from '../../engine/model/positions.ts';
import type { PlayerStore } from '../../engine/model/players.ts';
import { ClubLink } from '../components.tsx';
import { describeRally } from './Match.tsx';
import { useGame, type MatchdayLogEntry } from '../state.ts';

const ZONE_ORDER = [3, 2, 1, 4, 5, 0]; // front row first: 4,3,2 then back row 5,6,1
const ZONE_ORDER_MIRRORED = [4, 5, 0, 3, 2, 1]; // back row first, so front row sits by the net
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

/** Screen position (% of the combined court-pair box) for a zone on a given side. */
function zonePercent(zone: number, side: 'home' | 'away'): { x: number; y: number } {
  const grid = ZONE_GRID[zone];
  if (grid === undefined) return { x: 50, y: 50 };
  const x = ((grid.col + 0.5) / 3) * 100;
  const isFront = grid.row === 0;
  // Both teams' front rows sit adjacent to the shared net line at y=50.
  const rowFrac = side === 'home' ? (isFront ? 0.75 : 0.25) : (isFront ? 0.25 : 0.75);
  const halfTop = side === 'home' ? 0 : 50;
  return { x, y: halfTop + rowFrac * 50 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Move the ball through one rally's contacts, one at a time. */
async function animateRally(
  logEntry: MatchdayLogEntry,
  speed: number,
  cancelled: { current: boolean },
  setBall: (pos: BallPos | null) => void,
): Promise<void> {
  const perContact = 260 / speed;
  for (const c of logEntry.entry.contacts) {
    if (cancelled.current) return;
    const side: 'home' | 'away' = c.team === 0 ? 'home' : 'away';
    const court = c.team === 0 ? logEntry.homeCourt : logEntry.awayCourt;
    const zone = court.indexOf(c.player);
    if (zone !== -1) setBall({ side, ...zonePercent(zone, side) });
    await sleep(perContact);
  }
}

function renderZone(z: number, court: number[], store: PlayerStore): JSX.Element {
  const p = court[z];
  if (p === undefined) return <div className="zone" key={z} />;
  const pos = store.position[p] as Position;
  const isSetter = POSITION_SHORT[pos] === 'S';
  return (
    <div className={`zone${isSetter ? ' setter' : ''}`} key={z}>
      <div className="z">Zone {ZONE_LABELS[z]}</div>
      <div>{store.shortName(p)}</div>
      <div className="faint">{POSITION_SHORT[pos]}</div>
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
        await animateRally(logEntry, current.speed, cancelledRef, setBall);
        if (cancelledRef.current) break;
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
        <span className="team">{homeClub?.shortName ?? '—'}</span>
        <span className="sets">{snap?.homeSets ?? 0} — {snap?.awaySets ?? 0}</span>
        <span className="team">{awayClub?.shortName ?? '—'}</span>
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

      <div className="panel">
        <h3>{homeClub?.name ?? '—'} <span className="faint">vs</span> {awayClub?.name ?? '—'}</h3>
        <div className="court-pair">
          <div className="court">
            {ZONE_ORDER_MIRRORED.map((z) => renderZone(z, snap?.homeCourt ?? [], store))}
          </div>
          <div className="net-line" />
          <div className="court">
            {ZONE_ORDER.map((z) => renderZone(z, snap?.awayCourt ?? [], store))}
          </div>
          {ball !== null && (
            <span className="ball" style={{ left: `${ball.x}%`, top: `${ball.y}%` }} />
          )}
        </div>
      </div>

      <h3 style={{ marginTop: 16 }}>Commentary</h3>
      <div className="rally-log" ref={logRef}>
        {md.log.map((l, i) => (
          <div key={i} className={`rally ${l.entry.winner === 0 ? 'home-point' : 'away-point'}`}>
            <span className="score mono">{l.entry.scoreBefore[0]}-{l.entry.scoreBefore[1]}</span>
            <span className="desc">{describeRally(l.entry, store)}</span>
          </div>
        ))}
        {md.log.length === 0 && <div className="rally dim">Kicking off…</div>}
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
