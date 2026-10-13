/**
 * The analyst's room: a season of the club's volleyball in numbers.
 *
 * Where our attacks come down and where the opposition hurt us, cell by cell;
 * how each rotation sides out and breaks; which of our attackers does what
 * from each lane; and the attack and side-out, match by match.
 */

import { useLayoutEffect, useRef, useState, type JSX, type RefObject } from 'react';
import { breakPointPct, sideOutPct } from '../../engine/match/stats.ts';
import { analysisFor, GRID, seasonFromReports, type AttackMap, type MatchLine } from '../../engine/world/analysis.ts';
import { Card, ClubLink, Empty, PlayerLink, StatTile } from '../components.tsx';
import { Dropdown } from '../dropdown.tsx';
import { useGame } from '../state.ts';
import { seasonLabel } from './Squad.tsx';

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** An element's size in CSS pixels, kept up to date as the layout moves. */
export function useSize<T extends HTMLElement>(): [RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const read = (): void => setSize((s) => (Math.abs(s.w - el.clientWidth) < 1 && Math.abs(s.h - el.clientHeight) < 1 ? s : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** The court seen from the hitter, cell by cell: how many points came from each — or were conceded in it. */
function AttackGrid({ map, what }: { map: AttackMap; what: 'ours' | 'theirs' }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, box] = useSize<HTMLDivElement>();
  // Square, as the court is: as big as the room allows.
  const side = Math.max(56, Math.floor(Math.min(box.w, box.h, 320)));
  // Too small for the numbers: the colours tell it, and the cell under the pointer its numbers.
  const numbers = side >= 132;
  const most = Math.max(1, ...map.kills);
  const total = map.attacks.reduce((s, x) => s + x, 0) + map.long + map.wide;
  const metres = (i: number): string => `${(i * 9 / GRID).toFixed(1)}–${((i + 1) * 9 / GRID).toFixed(1)} m`;
  const cell = hover !== null ? { a: map.attacks[hover], k: map.kills[hover], deep: Math.floor(hover / GRID), across: hover % GRID } : null;
  return (
    <div className="an-grid-wrap">
      <div className="an-grid-axis" style={{ width: side }}><span>Line</span><b>Net</b><span>Cross</span></div>
      <div className="an-grid-box" ref={boxRef}>
        <div className="an-grid" style={{ width: side, height: side }} onMouseLeave={() => setHover(null)}>
          {map.kills.map((k, i) => (
            <div key={i} className={`an-cell${hover === i ? ' on' : ''}`} onMouseEnter={() => setHover(i)}
              style={{ background: k === 0 ? undefined : `rgba(57, 135, 229, ${(0.12 + 0.78 * (k / most)).toFixed(2)})` }}>
              {k > 0 && numbers ? k : ''}
            </div>
          ))}
        </div>
      </div>
      <div className="an-grid-axis an-bottom" style={{ width: side }}><b>End line</b></div>
      <div className="an-grid-note">
        {cell !== null
          ? <>{metres(cell.deep)} from the net · {cell.across < 2 ? 'line side' : cell.across > 3 ? 'cross side' : 'middle'} — {cell.a} attack{cell.a === 1 ? '' : 's'}, {cell.k} {what === 'ours' ? 'kills' : 'conceded'}{cell.a > 0 ? ` (${pct(cell.k / cell.a)})` : ''}</>
          : <>{total} attacks · hit long {map.long} · wide {map.wide} · off the block and out {map.blockout}</>}
      </div>
    </div>
  );
}

/** Kill rate and side-out, match by match: one scale, two lines, the match under the pointer told in full. */
function MatchChart({ matches }: { matches: MatchLine[] }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, box] = useSize<HTMLDivElement>();
  // Drawn at the size it is shown, so the text is never stretched.
  const W = Math.max(240, box.w);
  const H = Math.max(110, box.h);
  const pad = { l: 34, r: 74, t: 10, b: 22 };
  const x = (i: number): number => pad.l + (matches.length <= 1 ? 0 : (i / (matches.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number): number => pad.t + (1 - Math.min(1, v) / 0.8) * (H - pad.t - pad.b);
  const path = (get: (m: MatchLine) => number): string => matches.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(get(m)).toFixed(1)}`).join(' ');
  const last = matches.length - 1;
  const h = hover !== null ? matches[hover] : null;
  return (
    <div className="an-chart">
      <div className="an-legend">
        <span><i style={{ background: 'var(--an-series-1)' }} /> Kill rate</span>
        <span><i style={{ background: 'var(--an-series-2)' }} /> Side-out</span>
      </div>
      <div className="an-svg-box" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="an-svg"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          for (let i = 0; i < matches.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}>
        {[0.2, 0.4, 0.6, 0.8].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="an-gridline" />
            <text x={pad.l - 6} y={y(v) + 3} className="an-tick" textAnchor="end">{pct(v)}</text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="an-baseline" />
        {h !== null && <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={y(0)} className="an-cross" />}
        <path d={path((m) => m.killRate)} className="an-line" style={{ stroke: 'var(--an-series-1)' }} />
        <path d={path((m) => m.sideOut)} className="an-line" style={{ stroke: 'var(--an-series-2)' }} />
        {h !== null && (
          <>
            <circle cx={x(hover!)} cy={y(h.killRate)} r={4.5} className="an-dot" style={{ fill: 'var(--an-series-1)' }} />
            <circle cx={x(hover!)} cy={y(h.sideOut)} r={4.5} className="an-dot" style={{ fill: 'var(--an-series-2)' }} />
          </>
        )}
        {last >= 0 && (
          <>
            <text x={x(last) + 8} y={y(matches[last].killRate) + 4} className="an-direct">Kill {pct(matches[last].killRate)}</text>
            <text x={x(last) + 8} y={y(matches[last].sideOut) + 4} className="an-direct">Side-out {pct(matches[last].sideOut)}</text>
          </>
        )}
      </svg>
      </div>
      <div className="an-chart-note">
        {h !== null
          ? <>{g.dateLabelForDay(h.fixture.day)} · {h.won ? 'W' : 'L'} {h.fixture.home === h.opponent ? `${h.fixture.awaySets}-${h.fixture.homeSets}` : `${h.fixture.homeSets}-${h.fixture.awaySets}`} vs {world.clubs[h.opponent]?.shortName ?? '?'} — kill rate {pct(h.killRate)}, side-out {pct(h.sideOut)}, break point {pct(h.breakPoint)}</>
          : <>{matches.length} matches · hover a match for its numbers</>}
      </div>
    </div>
  );
}

export function AnalysisScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club;
  const [season, setSeason] = useState(world.season);
  if (club === null) return <Empty>No club.</Empty>;
  const store = world.players;
  const seasons = [...new Set([world.season, ...(world.analysis ?? []).filter((a) => a.clubId === club.id).map((a) => a.season)])].sort((a, b) => b - a);
  const a = analysisFor(world, club.id, season);
  const r = seasonFromReports(world, club.id, season);
  const t = r.totals;
  const received = r.rotations.reduce((s, x) => s + x.receiveRallies, 0);
  const sidedOut = r.rotations.reduce((s, x) => s + x.sideOutsWon, 0);
  const served = r.rotations.reduce((s, x) => s + x.serveRallies, 0);
  const broke = r.rotations.reduce((s, x) => s + x.servePointsWon, 0);
  const lanes = Object.entries(a?.lanes ?? {})
    .map(([key, [att, k, err]]) => ({ p: Number(key.split('|')[0]), lane: key.split('|')[1], att, k, err }))
    .filter((l) => l.att >= 5)
    .sort((x, y) => y.att - x.att);

  return (
    <div className="an">
      <div className="an-bar">
        <span className="faint an-intro">Every competitive match played in full this season{a !== undefined ? ` — ${a.matches} so far` : ''}.</span>
        <Dropdown<number> size="sm" value={season} onChange={setSeason} title="Season"
          options={seasons.map((s) => ({ value: s, label: s === world.season ? `${seasonLabel(world, s)} · this season` : seasonLabel(world, s) }))} />
      </div>
      <div className="tiles">
        <StatTile label="Kill rate" value={t.attacks > 0 ? pct(t.kills / t.attacks) : '—'} sub={`${t.kills} kills from ${t.attacks} attacks`} />
        <StatTile label="Attack efficiency" value={t.attacks > 0 ? ((t.kills - t.errors) / t.attacks).toFixed(3) : '—'} sub="kills less errors and blocks, per attack" />
        <StatTile label="Side-out" value={received > 0 ? pct(sidedOut / received) : '—'} sub="points won receiving" />
        <StatTile label="Break point" value={served > 0 ? pct(broke / served) : '—'} sub="points won serving" />
        <StatTile label="Aces a set" value={t.sets > 0 ? (t.aces / t.sets).toFixed(2) : '—'} sub={`${t.serveErrors} serve errors`} />
        <StatTile label="Blocks a set" value={t.sets > 0 ? (t.blocks / t.sets).toFixed(2) : '—'} sub={`${t.blocks} stuff blocks`} />
      </div>
      <div className="an-row an-row-1">
        <Card title="Where we score" icon="stats">
          {a !== undefined ? <AttackGrid map={a.ours} what="ours" /> : <Empty>No matches yet this season.</Empty>}
        </Card>
        <Card title="Where they hurt us" icon="stats">
          {a !== undefined ? <AttackGrid map={a.theirs} what="theirs" /> : <Empty>No matches yet this season.</Empty>}
        </Card>
        <Card title="Rotation by rotation" icon="tactics" flush>
          <div className="table-wrap an-rot">
            <table className="data-table">
              <thead><tr><th>Rot.</th><th className="num">Received</th><th className="num">Side-out</th><th className="num">Served</th><th className="num">Break</th></tr></thead>
              <tbody>
                {r.rotations.map((x, i) => {
                  const so = sideOutPct(x);
                  const bp = breakPointPct(x);
                  return (
                    <tr key={i}>
                      <td className="strong">P{i + 1}</td>
                      <td className="num dim">{x.receiveRallies}</td>
                      <td className={`num ${x.receiveRallies === 0 ? '' : so >= 0.66 ? 'good' : so < 0.55 ? 'bad' : ''}`}>{x.receiveRallies > 0 ? pct(so) : '—'}</td>
                      <td className="num dim">{x.serveRallies}</td>
                      <td className={`num ${x.serveRallies === 0 ? '' : bp >= 0.42 ? 'good' : bp < 0.3 ? 'bad' : ''}`}>{x.serveRallies > 0 ? pct(bp) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <div className="an-row an-row-2">
        <Card title="Our attackers, lane by lane" icon="squad" flush>
          {lanes.length === 0 ? <Empty>Five attacks from a lane before it shows here.</Empty> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Player</th><th>Lane</th><th className="num">Att</th><th className="num">Kills</th><th className="num">Err</th><th className="num">Kill %</th><th className="num">Eff</th></tr></thead>
                <tbody>
                  {lanes.map((l) => {
                    const eff = (l.k - l.err) / l.att;
                    return (
                      <tr key={`${l.p}|${l.lane}`}>
                        <td>{store.isActive(l.p) ? <PlayerLink idx={l.p} /> : store.fullName(l.p)}</td>
                        <td className="dim">{l.lane}</td>
                        <td className="num">{l.att}</td>
                        <td className="num">{l.k}</td>
                        <td className="num dim">{l.err}</td>
                        <td className="num">{pct(l.k / l.att)}</td>
                        <td className={`num ${eff >= 0.3 ? 'good' : eff < 0.1 ? 'bad' : ''}`}>{eff.toFixed(3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Match by match" icon="schedule">
          {r.matches.length > 0 ? <MatchChart matches={r.matches} /> : <Empty>No matches yet this season.</Empty>}
        </Card>
      </div>
      <p className="footnote an-foot">Grids are drawn from the hitter's side: his own sideline — the line — on the left, the far one on the right. <ClubLink id={club.id} short /> only.</p>
    </div>
  );
}
