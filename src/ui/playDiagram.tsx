/**
 * A combination play, drawn: the side in its rotation, seen from behind its own end line with the net at
 * the top, and arrows for where the setter, the middle (the decoy) and the hitter go — the coach's
 * clipboard, as the Rotations screen shows it.
 */

import type { JSX } from 'react';
import { Position } from '../engine/model/positions.ts';
import type { PipeBall, RotationPlay } from '../engine/match/tactics.ts';

/** Where each zone (index 0 for zone 1) stands on the drawing. */
const ZONE_AT: ReadonlyArray<readonly [number, number]> = [
  [160, 100], [160, 42], [100, 42], [40, 42], [40, 100], [100, 100],
];
const NET_Y = 12;
const ATTACK_Y = 22;
/** Along the net: where the setter sets from, the 1 — the quick at his head — and the 31 out in front. */
const SETTER_X = 128;
const HEAD_X = 116;
const GAP_X = 76;
/** Behind the 3 m line: where each of the pipe's balls is hit. */
const PIPE_X: Readonly<Record<PipeBall, number>> = { left: 58, middle: 100, back: 146 };
const PIPE_Y = 62;

const LETTER: Readonly<Record<number, string>> = {
  [Position.Setter]: 'S', [Position.OutsideHitter]: 'OH', [Position.MiddleBlocker]: 'M', [Position.Opposite]: 'O', [Position.Libero]: 'L',
};

/** The men a play needs, in a rotation: who is where. */
export interface PlayCast {
  /** Each zone's man's position (index 0 for zone 1), the libero in for the back-row middle. */
  roles: readonly Position[];
}

/** The zone (index) of the first of `role` in the front row, or the back row, or -1. */
function zoneOf(cast: PlayCast, role: Position, front: boolean): number {
  // The back row looked at as the engine does: zone 6, then 5, then 1.
  const order = front ? [1, 2, 3] : [5, 4, 0];
  for (const z of order) if (cast.roles[z] === role) return z;
  return -1;
}

/**
 * Who attacks on the right at the net, for the scissors: with the setter in zone 1 and an outside in zone 2 the
 * front row keeps its places, so it is that outside; otherwise the opposite — while the setter is in the back row.
 */
function rightHitter(cast: PlayCast): number {
  if (cast.roles[0] === Position.Setter && cast.roles[1] === Position.OutsideHitter) return 1;
  const setter = cast.roles.findIndex((r) => r === Position.Setter);
  if (setter >= 1 && setter <= 3) return -1;
  return zoneOf(cast, Position.Opposite, true);
}

/** Why a play can't be run in this rotation, or null if it can. */
export function playUnavailable(play: RotationPlay, cast: PlayCast): string | null {
  if (play === 'auto') return null;
  if (zoneOf(cast, Position.MiddleBlocker, true) < 0) return 'Needs a middle at the net to jump as the decoy.';
  if (play === 'scissors') return rightHitter(cast) < 0 ? 'Needs a hitter on the right at the net — the setter in the back row (P1, P6, P5).' : null;
  if (play === 'pipe') return zoneOf(cast, Position.OutsideHitter, false) < 0 ? 'Needs an outside in the back row, behind the middle at the net.' : null;
  return zoneOf(cast, Position.OutsideHitter, true) < 0 ? 'Needs an outside at the net.' : null;
}

/** What a play is, in a sentence. */
export function playDescription(play: RotationPlay, pipe: PipeBall): string {
  switch (play) {
    case 'auto': return "Left to the setter: he runs the side's usual combinations, as often as the team instructions say.";
    case 'between': return "The middle runs the 31 out in front; the outside comes in to hit at the setter's head, in between them.";
    case 'upDown': return "The middle hits the quick at the setter's head; the outside comes in just to his left for a half-ball.";
    case 'scissors': return "The middle runs the 31 out in front; the hitter on the right comes in to hit a half-ball at the setter's head.";
    case 'pipe': return pipe === 'left'
      ? 'The middle jumps for the quick; the outside in the back row hits the pipe to the left, from behind the 3 m line.'
      : pipe === 'back'
        ? 'The middle jumps for the quick; the outside in the back row hits the pipe behind the setter, from behind the 3 m line.'
        : 'The middle jumps for the quick; the outside in the back row hits the pipe in the middle, from behind the 3 m line.';
  }
}

interface Arrow { from: readonly [number, number]; to: readonly [number, number]; kind: 'setter' | 'decoy' | 'hitter' }

/** The arrows of a play in a rotation. */
function arrowsFor(play: RotationPlay, pipe: PipeBall, cast: PlayCast): Arrow[] {
  const out: Arrow[] = [];
  const setter = cast.roles.findIndex((r) => r === Position.Setter);
  if (setter >= 0) out.push({ from: ZONE_AT[setter], to: [SETTER_X, ATTACK_Y + 2], kind: 'setter' });
  if (play === 'auto' || playUnavailable(play, cast) !== null) return out;
  const middle = zoneOf(cast, Position.MiddleBlocker, true);
  // The 1 at the setter's head in the up and down and the pipe; the 31, out in front, in the between and the scissors.
  const runX = play === 'upDown' || play === 'pipe' ? HEAD_X : GAP_X;
  out.push({ from: ZONE_AT[middle], to: [runX, ATTACK_Y], kind: 'decoy' });
  if (play === 'pipe') {
    out.push({ from: ZONE_AT[zoneOf(cast, Position.OutsideHitter, false)], to: [PIPE_X[pipe], PIPE_Y], kind: 'hitter' });
  } else if (play === 'scissors') {
    out.push({ from: ZONE_AT[rightHitter(cast)], to: [HEAD_X, ATTACK_Y + 4], kind: 'hitter' });
  } else {
    const oh = zoneOf(cast, Position.OutsideHitter, true);
    out.push({ from: ZONE_AT[oh], to: play === 'upDown' ? [HEAD_X - 22, ATTACK_Y + 2] : [HEAD_X - 8, ATTACK_Y + 6], kind: 'hitter' });
  }
  return out;
}

/** An arrow from a player's circle to where he goes, stopping short of both ends. */
function arrowPath(a: Arrow): string {
  const [x1, y1] = a.from;
  const [x2, y2] = a.to;
  const d = Math.hypot(x2 - x1, y2 - y1) || 1;
  const sx = x1 + ((x2 - x1) / d) * 10;
  const sy = y1 + ((y2 - y1) / d) * 10;
  // A gentle bend, so crossing runs read apart.
  const mx = (sx + x2) / 2 + ((y2 - sy) / d) * 8;
  const my = (sy + y2) / 2 - ((x2 - sx) / d) * 8;
  return `M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

export function PlayDiagram({ play, pipe, cast, small }: {
  play: RotationPlay; pipe: PipeBall; cast: PlayCast; small?: boolean;
}): JSX.Element {
  const arrows = arrowsFor(play, pipe, cast);
  const off = playUnavailable(play, cast) !== null;
  return (
    <svg className={`play-diagram${small === true ? ' small' : ''}${off ? ' off' : ''}`} viewBox="0 0 200 124" role="img"
      aria-label={`${play} play`}>
      <defs>
        {(['setter', 'decoy', 'hitter'] as const).map((k) => (
          <marker key={k} id={`pd-head-${k}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={`pd-head ${k}`} />
          </marker>
        ))}
      </defs>
      <rect className="pd-court" x="4" y={NET_Y} width="192" height={124 - NET_Y - 4} rx="3" />
      <line className="pd-net" x1="0" y1={NET_Y} x2="200" y2={NET_Y} />
      <line className="pd-attack" x1="4" y1="52" x2="196" y2="52" />
      {arrows.map((a, i) => (
        <path key={i} className={`pd-arrow ${a.kind}`} d={arrowPath(a)} markerEnd={`url(#pd-head-${a.kind})`} />
      ))}
      {cast.roles.map((r, z) => {
        const [x, y] = ZONE_AT[z];
        const moving = arrows.some((a) => a.from === ZONE_AT[z] && a.kind !== 'setter');
        return (
          <g key={z} className={`pd-player${r === Position.Setter ? ' setter' : ''}${moving ? ' moving' : ''}`}>
            <circle cx={x} cy={y} r="9" />
            <text x={x} y={y + 3.5} textAnchor="middle">{LETTER[r] ?? '?'}</text>
          </g>
        );
      })}
    </svg>
  );
}
