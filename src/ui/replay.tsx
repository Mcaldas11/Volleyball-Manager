/**
 * A point shown again: the Point or Play of the Month — a spike, a stuff
 * block, an ace, a long rally — played out on the live court exactly as it
 * happened, the court as it stood, every contact as it was made. It runs
 * once at full speed and then again in slow motion, the way television
 * shows it, and can be watched as often as you like after that.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import type { Highlight } from '../engine/match/highlights.ts';
import { describeHighlight } from '../engine/world/monthAwards.ts';
import { ClubCrest, clubHue, Segmented } from './components.tsx';
import { Icon } from './icons.tsx';
import { kitsFor, LiveCourt, type CourtLabels } from './LiveCourt.tsx';
import { rallyBeats, setupScene, type CourtState, type Scene } from './matchCourt.ts';
import { bigPlayMs, playBeats, sleep, type BigPlay } from './rallyPlayer.ts';
import { BigPlayCallout, crowdFor } from './screens/Matchday.tsx';
import { useGame } from './state.ts';

export function ReplayViewer(): JSX.Element | null {
  const g = useGame();
  if (g.world === null || g.replay === null) return null;
  return <Replay highlight={g.replay.highlight} title={g.replay.title} />;
}

/** Full speed, then slow motion. */
type Pace = 1 | 0.45;

function Replay({ highlight: h, title }: { highlight: Highlight; title: string }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const home = h.home !== undefined ? world.clubs[h.home] : undefined;
  const away = h.away !== undefined ? world.clubs[h.away] : undefined;
  const kits = kitsFor(home !== undefined ? clubHue(home) : 210, away !== undefined ? clubHue(away) : 20);
  // The side that made it plays in the near half, closest to the camera.
  const nearTeam = h.starTeam;

  const court: CourtState = useMemo(
    () => ({ homeCourt: h.homeCourt, awayCourt: h.awayCourt, homeLibero: h.homeLibero, awayLibero: h.awayLibero }),
    [h],
  );
  const roles = useMemo(() => {
    const r = store.position.slice(0, store.count);
    for (const [p, pos] of h.roles) r[p] = pos;
    return r;
  }, [h]);
  const homeSide = useMemo(() => new Set([...h.homeCourt, h.homeLibero]), [h]);
  const teamOf = (p: number): 0 | 1 => (homeSide.has(p) ? 0 : 1);
  const serve = h.contacts.find((c) => c.kind === 'serve' || c.kind === 'serveError');
  const kindOf = (p: number): 'jump' | 'float' | undefined =>
    serve !== undefined && serve.player === p && (serve.detail === 'jump' || serve.detail === 'float') ? serve.detail : undefined;
  const opening = (): Scene => setupScene(court, h.serveTeam, roles, nearTeam, kindOf);

  const [scene, setScene] = useState<Scene>(opening);
  /** Each showing remounts the court, so it starts from the serve. */
  const [run, setRun] = useState(0);
  const [pace, setPace] = useState<Pace>(1);
  const [scored, setScored] = useState(false);
  const [done, setDone] = useState(false);
  const [labels, setLabels] = useState<CourtLabels>('names');
  const [bigPlay, setBigPlay] = useState<(BigPlay & { key: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [view, setView] = useState<'3d' | '2d'>(g.courtView);

  /** From the serve again, at `p` — the court back where it stood before the
   *  new showing mounts, so it never starts on the last one's point. */
  const again = (p: Pace): void => {
    setScene(opening());
    setScored(false);
    setDone(false);
    setPace(p);
    setRun((r) => r + 1);
  };

  useEffect(() => {
    const cancelled = { current: false };
    void (async () => {
      await sleep(1300 / pace);
      if (cancelled.current) return;
      const seed = h.set * 1000 + h.scoreBefore[0] * 31 + h.scoreBefore[1];
      const beats = rallyBeats(court, h.serveTeam, h.contacts, roles, seed, nearTeam, h.winner);
      await playBeats(beats, pace, cancelled, setScene, (play) => {
        setBigPlay({ ...play, key: Date.now() });
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setBigPlay(null), bigPlayMs(play));
      });
      if (cancelled.current) return;
      setScored(true);
      await sleep(2200);
      if (cancelled.current) return;
      // Once at full speed, then again in slow motion — then it waits for you.
      if (pace === 1 && run === 0) again(0.45);
      else setDone(true);
    })();
    return () => {
      cancelled.current = true;
      clearTimeout(timer.current);
    };
  }, [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') g.closeReplay();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const after: [number, number] = [h.scoreBefore[0] + (h.winner === 0 ? 1 : 0), h.scoreBefore[1] + (h.winner === 1 ? 1 : 0)];
  const shown = scored ? after : h.scoreBefore;
  const starClub = h.starTeam === 0 ? home : away;
  const what = h.what === 'spike' ? 'Spike' : h.what === 'block' ? 'Block' : h.what === 'ace' ? 'Ace' : 'Rally';
  const day = h.day !== undefined ? g.longDateLabel(h.day) : null;

  return (
    <div className="hol-overlay rp-overlay" onClick={() => g.closeReplay()}>
      <div
        className="hol-card rp-card"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ '--lv-home': kits[0].shirt, '--lv-away': kits[1].shirt } as CSSProperties}
      >
        <header className="hol-top">
          <span className="hol-crumbs"><Icon name="star" size={12} /> <b>{title}</b>{day !== null && <> · {day}</>}</span>
          <button className="icon-btn" onClick={() => g.closeReplay()} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="rp-head">
          <div className="rp-star">
            <span className="rp-what">{what}{h.speed !== undefined && h.what !== 'block' ? ` · ${h.speed} km/h` : ''}</span>
            <strong className="player-link" onClick={() => { g.closeReplay(); g.select(h.star); }}>{store.fullName(h.star)}</strong>
            <span className="faint">{describeHighlight(world, h)}</span>
          </div>
          <div className="rp-score">
            <span className="rp-team">{home !== undefined && <ClubCrest club={home} size={22} />}{home?.shortName ?? 'Home'}</span>
            <span className="rp-sets">{h.setsBefore[0]}</span>
            <span className={`rp-points${scored && h.winner === 0 ? ' won' : ''}`}>{shown[0]}</span>
            <span className="rp-dash">–</span>
            <span className={`rp-points${scored && h.winner === 1 ? ' won' : ''}`}>{shown[1]}</span>
            <span className="rp-sets">{h.setsBefore[1]}</span>
            <span className="rp-team right">{away?.shortName ?? 'Away'}{away !== undefined && <ClubCrest club={away} size={22} />}</span>
          </div>
        </div>
        <div className="rp-court">
          <LiveCourt
            key={run}
            scene={scene}
            store={store}
            roles={roles}
            kits={kits}
            teamOf={teamOf}
            ratings={new Map()}
            labels={labels}
            speed={pace}
            nearTeam={nearTeam}
            teamNames={[home?.shortName ?? 'Home', away?.shortName ?? 'Away']}
            view={view}
            crowdFill={crowdFor(world, h.competitionId ?? -1, 0.6)}
          />
          {pace !== 1 && !done && <span className="rp-slowmo"><Icon name="clock" size={12} /> Slow motion</span>}
          {bigPlay !== null && <BigPlayCallout key={bigPlay.key} play={bigPlay} />}
          {done && (
            <div className="rp-again">
              <button className="primary" onClick={() => again(1)}><Icon name="play" size={14} /> Watch again</button>
              <button onClick={() => again(0.45)}><Icon name="clock" size={14} /> In slow motion</button>
            </div>
          )}
        </div>
        <footer className="rp-foot">
          <span className="faint">
            {starClub !== undefined ? <>{starClub.name} · </> : null}
            {h.setTarget === 15 ? 'Tie-break' : `Set ${h.set + 1}`}
          </span>
          <div className="rp-tools">
            <Segmented<'3d' | '2d'> size="sm" options={[['3d', '3D'], ['2d', '2D']]} value={view} onChange={setView} />
            <Segmented<CourtLabels> size="sm" options={[['names', 'Names'], ['off', 'Off']]} value={labels} onChange={setLabels} />
            <button className="sm" onClick={() => again(pace)} title="Play it from the serve again">
              <Icon name="back" size={13} /> Restart
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
