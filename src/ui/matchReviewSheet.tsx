/**
 * The assistant's match review, drawn: how the score moved rally by rally,
 * how each side won its points, the numbers side by side, every rotation's
 * side-out, and who hit and passed well — with what he made of it alongside.
 */

import { useId, type JSX } from 'react';
import { aggregateTeam, type PlayerMatchStats, type TeamMatchStats } from '../engine/match/stats.ts';
import type { MatchReviewNote } from '../engine/world/postMatchReview.ts';
import { reportResult, type PointHow } from '../engine/world/matchReports.ts';
import { useGame } from './state.ts';

const HOW_NAMES: Readonly<Record<PointHow, string>> = { k: 'kill', a: 'ace', b: 'block', e: 'error' };

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function attackEff(s: { attackKills: number; attackErrors: number; attackBlocked: number; attacksTotal: number }): number {
  return s.attacksTotal > 0 ? (s.attackKills - s.attackErrors - s.attackBlocked) / s.attacksTotal : 0;
}

function goodPasses(s: { receptionPerfect: number; receptionPositive: number; receptionsTotal: number }): number {
  return s.receptionsTotal > 0 ? (s.receptionPerfect + s.receptionPositive) / s.receptionsTotal : 0;
}

/** Which side won a rally of the flow, and how. */
function rallyOf(ch: string): { side: 0 | 1; how: PointHow } {
  const low = ch.toLowerCase();
  return { side: ch === low ? 0 : 1, how: (low in HOW_NAMES ? low : 'e') as PointHow };
}

/** The score, rally by rally: above the line we lead the set, below it they do. */
function ScoreFlow({ flow, side, names }: { flow: string[]; side: 0 | 1; names: [string, string] }): JSX.Element {
  const id = useId();
  // Drawn to a 1000 x 100 box stretched to the panel; the words are laid over it in HTML, so they keep their size.
  const W = 1000;
  const H = 100;
  const gap = 18;
  const mid = H / 2;
  const sets = flow.filter((s) => s.length > 0);
  const diffs = sets.map((s) => {
    let d = 0;
    const out = [0];
    for (const ch of s) {
      d += rallyOf(ch).side === side ? 1 : -1;
      out.push(d);
    }
    return out;
  });
  const maxAbs = Math.max(4, ...diffs.flat().map(Math.abs));
  const rallies = sets.reduce((n, s) => n + s.length, 0);
  const unit = (W - gap * (sets.length - 1)) / Math.max(1, rallies);
  const y = (d: number): number => mid - (d / maxAbs) * (mid - 3);
  const starts: number[] = [];
  let x0 = 0;
  for (const s of sets) {
    starts.push(x0);
    x0 += s.length * unit + gap;
  }
  return (
    <div className="mrv-flow">
      <div className="mrv-flow-sets">
        {sets.map((s, i) => {
          let a = 0;
          for (const ch of s) if (rallyOf(ch).side === side) a++;
          const b = s.length - a;
          return (
            <span key={i} style={{ left: `${(starts[i] / W) * 100}%`, width: `${((s.length * unit) / W) * 100}%` }}>
              Set {i + 1} <b className={a > b ? 'won' : 'lost'}>{a}–{b}</b>
            </span>
          );
        })}
      </div>
      <div className="mrv-flow-plot">
        <span className="mrv-flow-axis up">{names[0]} +{maxAbs}</span>
        <span className="mrv-flow-axis down">{names[1]} +{maxAbs}</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Score flow, set by set">
          <defs>
            <clipPath id={`${id}-up`}><rect x={0} y={0} width={W} height={mid} /></clipPath>
            <clipPath id={`${id}-down`}><rect x={0} y={mid} width={W} height={H - mid} /></clipPath>
          </defs>
          {sets.map((s, i) => {
            const start = starts[i];
            const end = start + s.length * unit;
            const pts = diffs[i].map((d, j) => `${(start + j * unit).toFixed(1)},${y(d).toFixed(1)}`);
            const area = `M${start.toFixed(1)},${mid} L${pts.join(' L')} L${end.toFixed(1)},${mid} Z`;
            let sa = 0;
            let sb = 0;
            return (
              <g key={i}>
                <line x1={start} y1={mid} x2={end} y2={mid} className="mrv-zero" />
                <path d={area} className="mrv-area-ours" clipPath={`url(#${id}-up)`} />
                <path d={area} className="mrv-area-theirs" clipPath={`url(#${id}-down)`} />
                <polyline points={pts.join(' ')} className="mrv-line" />
                {[...s].map((ch, j) => {
                  const r = rallyOf(ch);
                  if (r.side === side) sa++;
                  else sb++;
                  const who = r.side === side ? 0 : 1;
                  return (
                    <rect key={j} x={start + j * unit} y={0} width={unit} height={H} className="mrv-hit">
                      <title>{`Set ${i + 1}, ${sa}–${sb}: point ${names[who]}, ${r.how === 'e' ? `${names[1 - who]} error` : HOW_NAMES[r.how]}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Two sides' numbers, one row each: ours to the left of the label, theirs to the right. */
function Duel({ rows }: { rows: Array<[label: string, ours: number, theirs: number, show?: (v: number) => string]> }): JSX.Element {
  return (
    <div className="mrv-duel">
      {rows.map(([label, a, b, show]) => {
        const max = Math.max(1e-9, Math.abs(a), Math.abs(b));
        const f = show ?? String;
        return (
          <div key={label} className="mrv-duel-row" title={`${label}: ${f(a)} – ${f(b)}`}>
            <b>{f(a)}</b>
            <span className="mrv-duel-track left"><span className="ours" style={{ width: `${(Math.max(0, a) / max) * 100}%` }} /></span>
            <span className="mrv-duel-label">{label}</span>
            <span className="mrv-duel-track"><span className="theirs" style={{ width: `${(Math.max(0, b) / max) * 100}%` }} /></span>
            <b>{f(b)}</b>
          </div>
        );
      })}
    </div>
  );
}

/** Each rotation's side-out — how often it won the point when receiving — ours beside theirs. */
function Rotations({ ours, theirs }: { ours: TeamMatchStats; theirs: TeamMatchStats }): JSX.Element {
  const rate = (r: { receiveRallies: number; sideOutsWon: number }): number | null => (r.receiveRallies > 0 ? r.sideOutsWon / r.receiveRallies : null);
  return (
    <div className="mrv-rot">
      <div className="mrv-rot-grid">
        {[100, 75, 50, 25].map((v) => <span key={v} style={{ bottom: `${v}%` }}>{v}%</span>)}
      </div>
      {ours.rotations.map((r, i) => {
        const a = rate(r);
        const t = theirs.rotations[i];
        const b = rate(t);
        return (
          <div key={i} className="mrv-rot-group">
            <div className="mrv-rot-bars">
              <span className="ours" style={{ height: `${(a ?? 0) * 100}%` }} title={a === null ? `Our P${i + 1}: never received` : `Our P${i + 1}: won ${r.sideOutsWon} of ${r.receiveRallies} receiving (${pct(a)})`}>
                {a !== null && <b>{Math.round(a * 100)}</b>}
              </span>
              <span className="theirs" style={{ height: `${(b ?? 0) * 100}%` }} title={b === null ? `Their P${i + 1}: never received` : `Their P${i + 1}: won ${t.sideOutsWon} of ${t.receiveRallies} (${pct(b)})`} />
            </div>
            <span className="mrv-rot-label">P{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Our players' lines as bars: a value from `lo` to `hi`, zero marked when the range crosses it. */
function PlayerBars({ rows, lo, hi }: { rows: Array<{ p: number; label: string; value: number; tip: string }>; lo: number; hi: number }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  const at = (v: number): number => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100;
  const zero = at(0);
  return (
    <div className="mrv-players">
      {rows.map((r) => {
        const x = at(r.value);
        return (
          <div key={r.p} className="mrv-player" title={r.tip}>
            <span className="mrv-player-name player-link" onClick={() => g.select(r.p)}>{store.shortName(r.p)}</span>
            <span className="mrv-player-track">
              {lo < 0 && <i className="mrv-player-zero" style={{ left: `${zero}%` }} />}
              <span
                className={r.value < 0 ? 'neg' : 'pos'}
                style={{ left: `${Math.min(zero, x)}%`, width: `${Math.abs(x - zero)}%` }}
              />
            </span>
            <span className="mrv-player-num">{r.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Panel({ title, legend, children }: { title: string; legend?: boolean; children: JSX.Element }): JSX.Element {
  return (
    <section className="mrv-panel">
      <header className="mrv-panel-head">
        <span>{title}</span>
        {legend === true && <Legend />}
      </header>
      {children}
    </section>
  );
}

function Legend(): JSX.Element {
  return (
    <span className="mrv-legend">
      <span><i className="ours" /> Us</span>
      <span><i className="theirs" /> Them</span>
    </span>
  );
}

export function MatchReviewSheet({ note }: { note: MatchReviewNote }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const f = world.fixtures[note.fixtureId];
  const report = f !== undefined ? world.matchReports?.get(f.id) : undefined;
  const notes = (
    <div className="mrv-notes">
      {([['worked', 'What worked', note.worked], ['failed', 'What went wrong', note.failed], ['change', 'What I would change', note.change]] as const).map(([cls, title, items]) => (
        <section key={cls} className={`mrv-note ${cls}`}>
          <h4>{title}</h4>
          <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </section>
      ))}
    </div>
  );
  if (f === undefined || report === undefined) return notes;

  const side = note.side;
  const result = reportResult(f, report);
  const ours = side === 0 ? result.stats.home : result.stats.away;
  const theirs = side === 0 ? result.stats.away : result.stats.home;
  const club = (id: number): string => world.clubs[id]?.shortName ?? '—';
  const names: [string, string] = side === 0 ? [club(f.home), club(f.away)] : [club(f.away), club(f.home)];
  const a = aggregateTeam(ours);
  const b = aggregateTeam(theirs);

  // How each side won its points: from the rallies when they were kept, else from the box score.
  const how = { k: [0, 0], a: [0, 0], b: [0, 0], e: [0, 0] } as Record<PointHow, [number, number]>;
  if (report.flow !== undefined) {
    for (const ch of report.flow.join('')) {
      const r = rallyOf(ch);
      how[r.how][r.side === side ? 0 : 1]++;
    }
  } else {
    how.k = [a.attackKills, b.attackKills];
    how.a = [a.serveAces, b.serveAces];
    how.b = [a.blockPoints, b.blockPoints];
    how.e = [ours.opponentErrors, theirs.opponentErrors];
  }

  const players = [...ours.players.values()];
  const hitters = players.filter((s) => s.attacksTotal >= 5).sort((x, y) => attackEff(y) - attackEff(x));
  const passers = players.filter((s) => s.receptionsTotal >= 5).sort((x, y) => goodPasses(y) - goodPasses(x));
  const line = (s: PlayerMatchStats): string => `${s.attackKills} kills, ${s.attackErrors} errors, ${s.attackBlocked} blocked from ${s.attacksTotal} swings`;

  return (
    <div className="mrv">
      {report.flow !== undefined && report.flow.some((s) => s.length > 0) && (
        <Panel title="How the score moved" legend>
          <ScoreFlow flow={report.flow} side={side} names={names} />
        </Panel>
      )}
      {notes}
      <div className="mrv-grid">
        <Panel title="How the points were won" legend>
          <Duel rows={[['Kills', how.k[0], how.k[1]], ['Aces', how.a[0], how.a[1]], ['Blocks', how.b[0], how.b[1]], ['From errors', how.e[0], how.e[1]]]} />
        </Panel>
        <Panel title="Head to head" legend>
          <Duel rows={[
            ['Attack eff.', attackEff(a), attackEff(b), pct],
            ['Good passes', goodPasses(a), goodPasses(b), pct],
            ['Serve errors', a.serveErrors, b.serveErrors],
            ['Digs', a.digsTotal, b.digsTotal],
            ['Longest run', ours.longestRun, theirs.longestRun],
          ]} />
        </Panel>
        <Panel title="Side-out by rotation" legend>
          <Rotations ours={ours} theirs={theirs} />
        </Panel>
        <Panel title="Our attackers · efficiency">
          {hitters.length === 0 ? <p className="mrv-empty">Nobody swung often enough to judge.</p> : (
            <PlayerBars
              lo={-0.3}
              hi={0.7}
              rows={hitters.slice(0, 7).map((s) => ({ p: s.playerIdx, value: attackEff(s), label: `${s.attackKills}/${s.attacksTotal} · ${pct(attackEff(s))}`, tip: line(s) }))}
            />
          )}
        </Panel>
        {passers.length > 0 && (
          <Panel title="Our passers · good passes">
            <PlayerBars
              lo={0}
              hi={1}
              rows={passers.slice(0, 5).map((s) => ({ p: s.playerIdx, value: goodPasses(s), label: `${s.receptionPerfect + s.receptionPositive}/${s.receptionsTotal} · ${pct(goodPasses(s))}`, tip: `${s.receptionPerfect} perfect, ${s.receptionPositive} good, ${s.receptionErrors} aced or shanked from ${s.receptionsTotal} passes` }))}
            />
          </Panel>
        )}
      </div>
    </div>
  );
}
