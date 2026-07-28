import { useEffect, useRef, useState, type JSX } from 'react';
import { POSITION_SHORT, type Position } from '../../engine/model/positions.ts';
import { ClubLink } from '../components.tsx';
import { describeRally } from './Match.tsx';
import { useGame } from '../state.ts';

const ZONE_ORDER = [3, 2, 1, 4, 5, 0]; // display order: 4,3,2 front then 5,6,1 back
const ZONE_LABELS = ['1', '2', '3', '4', '5', '6'];

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

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [md.log.length]);

  const homeClub = world.clubs[md.fixture.home];
  const awayClub = world.clubs[md.fixture.away];
  const userTeamIdx: 0 | 1 = md.userIsHome ? 0 : 1;

  const renderCourt = (court: number[], clubName: string): JSX.Element => (
    <div className="panel" style={{ flex: 1 }}>
      <h3>{clubName}</h3>
      <div className="court">
        {ZONE_ORDER.map((z) => {
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
        })}
      </div>
    </div>
  );

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

      <div className="panels" style={{ marginTop: 12 }}>
        {renderCourt(snap?.homeCourt ?? [], homeClub?.shortName ?? '—')}
        {renderCourt(snap?.awayCourt ?? [], awayClub?.shortName ?? '—')}
      </div>

      <h3 style={{ marginTop: 16 }}>Commentary</h3>
      <div className="rally-log" ref={logRef}>
        {md.log.map((r, i) => (
          <div key={i} className={`rally ${r.winner === 0 ? 'home-point' : 'away-point'}`}>
            <span className="score mono">{r.scoreBefore[0]}-{r.scoreBefore[1]}</span>
            <span className="desc">{describeRally(r, store)}</span>
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
