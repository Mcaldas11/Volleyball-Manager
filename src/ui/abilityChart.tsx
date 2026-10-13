/**
 * How a player came on, season by season: his ability as each season closed,
 * and where it stands now. One series, so no legend — the card names it; the
 * first, the best and the latest are labelled on the line, and any season
 * under the pointer says its number.
 */

import { useState, type JSX } from 'react';
import { abilityTimeline } from '../engine/world/abilityHistory.ts';
import { seasonLabel } from './screens/Squad.tsx';
import { useSize } from './screens/Analysis.tsx';
import { useGame } from './state.ts';

export function AbilityChart({ p, potential }: { p: number; potential?: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, box] = useSize<HTMLDivElement>();
  const points = abilityTimeline(world, p).map((x) => ({ ...x, label: x.now === true ? 'Now' : seasonLabel(world, x.season) }));
  // A first season: where he started it, so there is a line to see.
  const start = g.ctx.seasonStartAbility.get(p);
  if (points.length === 1 && start !== undefined) points.unshift({ season: world.season, ability: start, label: 'Summer' });

  const W = Math.max(220, box.w);
  const H = Math.max(120, box.h);
  const pad = { l: 40, r: 18, t: 16, b: 24 };
  const values = [...points.map((x) => x.ability), ...(potential !== undefined ? [potential] : [])];
  const lo = Math.max(0, Math.floor((Math.min(...values) - 40) / 50) * 50);
  const hi = Math.ceil((Math.max(...values) + 40) / 50) * 50;
  const x = (i: number): number => pad.l + (points.length <= 1 ? (W - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number): number => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const path = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pt.ability).toFixed(1)}`).join(' ');
  const best = points.reduce((b, pt, i) => (pt.ability > points[b].ability ? i : b), 0);
  const last = points.length - 1;
  const step = Math.max(50, Math.round((hi - lo) / 4 / 50) * 50);
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  const labelled = new Set([0, best, last]);
  // Season names along the bottom, as many as fit.
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor((W - pad.l - pad.r) / 56))));
  const h = hover !== null ? points[hover] : null;
  const change = points.length > 1 ? points[last].ability - points[0].ability : 0;

  return (
    <div className="ab-chart">
      <div className="ab-svg-box" ref={boxRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="an-svg"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            let near = 0;
            for (let i = 0; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(near) - px)) near = i;
            setHover(near);
          }}
          onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="an-gridline" />
              <text x={pad.l - 6} y={y(v) + 3} className="an-tick" textAnchor="end">{v}</text>
            </g>
          ))}
          {potential !== undefined && (
            <g>
              <line x1={pad.l} x2={W - pad.r} y1={y(potential)} y2={y(potential)} className="ab-potential" />
              <text x={W - pad.r} y={y(potential) - 4} className="an-tick" textAnchor="end">Potential {potential}</text>
            </g>
          )}
          {points.map((pt, i) => i % every === 0 || i === last ? (
            <text key={i} x={x(i)} y={H - 6} className="an-tick" textAnchor={i === 0 && points.length > 1 ? 'start' : i === last && points.length > 1 ? 'end' : 'middle'}>{pt.label}</text>
          ) : null)}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="an-cross" />}
          <path d={path} className="an-line" style={{ stroke: 'var(--ab-series)' }} />
          {points.map((pt, i) => (
            <circle key={i} cx={x(i)} cy={y(pt.ability)} r={hover === i ? 5 : 4} className="ab-dot" />
          ))}
          {points.map((pt, i) => labelled.has(i) && hover === null ? (
            <text key={`l${i}`} x={x(i)} y={y(pt.ability) - 9} className="an-direct" textAnchor={i === 0 && points.length > 1 ? 'start' : i === last && points.length > 1 ? 'end' : 'middle'}>
              {pt.ability}
            </text>
          ) : null)}
        </svg>
      </div>
      <div className="an-chart-note">
        {h !== null
          ? <>{h.label === 'Now' ? 'This season so far' : h.label === 'Summer' ? 'At the start of this season' : `End of ${h.label}`}: ability {h.ability}</>
          : points.length > 1
            ? <>{change >= 0 ? '+' : ''}{change} since {points[0].label === 'Summer' ? 'the summer' : points[0].label} · best {points[best].ability} ({points[best].label})</>
            : <>Each season&apos;s ability shows here as it ends.</>}
      </div>
    </div>
  );
}
