/**
 * A plan for one opponent, from the scouts' report: where to serve, how
 * hard, how to block their offence, how to defend their hitters.
 *
 * Serve their weakest passer when one stands out; serve aggressively at a
 * side that passes well — only pressure hurts it — and keep it in against
 * one that passes badly. Commit on the middle against a quick-heavy offence,
 * spread the block against one that lives on its pins. Dig deep against
 * hitters who hit hard; cover the short court against ones who tip and roll.
 * Applied, it goes into every rotation's instructions — and can be taken
 * back.
 */

import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { computeRatings } from '../match/ratings.ts';
import { BlockAssignment, DefensiveShape, OffensiveSystem, ServeStrategy, ServeTarget, type TeamTactics } from '../match/tactics.ts';
import type { World } from './world.ts';

/** One instruction of a plan, and why. */
export interface PlanPart {
  what: 'serve' | 'serveTarget' | 'block' | 'shape';
  value: number;
  why: string;
}

export interface GamePlan {
  opponentId: number;
  parts: PlanPart[];
}

/** Who a club fields: its team sheet, or its best players by position. */
function likelySix(world: World, club: Club): number[] {
  const store = world.players;
  const sheet = club.preferredLineup.filter((p) => club.players.includes(p) && store.isActive(p));
  if (sheet.length >= 6) return sheet;
  return club.players.filter((p) => !store.hasFlag(p, PlayerFlag.Youth))
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 8);
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);

/** The scouts' plan for a match against `opp`. */
export function suggestPlan(world: World, club: Club, opp: Club): GamePlan {
  const store = world.players;
  const theirs = likelySix(world, opp);
  const ours = likelySix(world, club);
  const parts: PlanPart[] = [];
  const receivers = (six: number[]): number[] => six.filter((p) => store.position[p] === Position.OutsideHitter || store.position[p] === Position.Libero);
  const pass = (p: number): number => computeRatings(store, p, store.position[p] as Position).reception;

  // Where to serve.
  const rx = receivers(theirs);
  if (rx.length >= 2) {
    const sorted = [...rx].sort((a, b) => pass(a) - pass(b));
    const weakest = sorted[0];
    const gap = mean(rx.map(pass)) - pass(weakest);
    if (gap >= 4) {
      parts.push({ what: 'serveTarget', value: ServeTarget.WeakestPasser, why: `${store.fullName(weakest)} is their weakest passer — make him take the serve.` });
    } else {
      parts.push({ what: 'serveTarget', value: ServeTarget.DeepCorner, why: 'Their passers are much of a muchness: serve them deep, into the corners.' });
    }
  }
  // How hard.
  const theirPass = mean(rx.map(pass));
  const ourPass = mean(receivers(ours).map(pass));
  if (theirPass >= ourPass + 3) {
    parts.push({ what: 'serve', value: ServeStrategy.Risky, why: 'They pass well: only pressure from the line will hurt them.' });
  } else if (theirPass <= ourPass - 3) {
    parts.push({ what: 'serve', value: ServeStrategy.Conservative, why: 'They pass badly: keep the serve in and let them struggle.' });
  } else {
    parts.push({ what: 'serve', value: ServeStrategy.Balanced, why: 'Their passing is like ours: mix the serves.' });
  }
  // How to block.
  const o = opp.tactics.offense;
  if (o === OffensiveSystem.MiddleFocused || o === OffensiveSystem.Fast) {
    parts.push({ what: 'block', value: BlockAssignment.CommitMiddle, why: 'Their offence runs through the quick: commit the middle blocker on it.' });
  } else if (o === OffensiveSystem.Balanced) {
    parts.push({ what: 'block', value: BlockAssignment.ReadBlock, why: 'A balanced offence: read the setter and go with the ball.' });
  } else {
    parts.push({ what: 'block', value: BlockAssignment.SpreadBlock, why: 'They live on their pins: spread the block to the antennae.' });
  }
  // How to defend.
  const hitters = theirs.filter((p) => store.position[p] === Position.OutsideHitter || store.position[p] === Position.Opposite);
  const style = mean(hitters.map((p) => {
    const r = computeRatings(store, p, store.position[p] as Position);
    return r.attackControl - r.attackPower;
  }));
  if (style >= 3) {
    parts.push({ what: 'shape', value: DefensiveShape.RotationDefense, why: 'Their hitters place it — tips and rolls: rotate up to cover the short court.' });
  } else if (style <= -3) {
    parts.push({ what: 'shape', value: DefensiveShape.PerimeterDefense, why: 'Their hitters hit hard: stay deep on the perimeter.' });
  } else {
    parts.push({ what: 'shape', value: DefensiveShape.PerimeterDefense, why: 'Mixed hitters: the perimeter is the safe base.' });
  }
  return { opponentId: opp.id, parts };
}

/** Whether a club's instructions already follow a plan. */
export function followsPlan(t: TeamTactics, plan: GamePlan): boolean {
  return plan.parts.every((part) => {
    if (part.what === 'serve') return t.serve === part.value;
    const key = part.what === 'serveTarget' ? 'serveTarget' : part.what === 'block' ? 'blockAssignment' : 'defensiveShape';
    return t.rotations.every((r) => r[key] === part.value);
  });
}

/** Put a plan into a club's instructions — every rotation — keeping what was there to put back. */
export function applyPlan(world: World, club: Club, plan: GamePlan, fixtureId: number): void {
  world.planUndo = { clubId: club.id, fixtureId, before: JSON.stringify(club.tactics) };
  const t = club.tactics;
  for (const part of plan.parts) {
    if (part.what === 'serve') t.serve = part.value as ServeStrategy;
    for (const r of t.rotations) {
      if (part.what === 'serveTarget') r.serveTarget = part.value as ServeTarget;
      if (part.what === 'block') r.blockAssignment = part.value as BlockAssignment;
      if (part.what === 'shape') r.defensiveShape = part.value as DefensiveShape;
    }
  }
}

/** Take a plan back: the instructions as they were before it. */
export function undoPlan(world: World, club: Club): boolean {
  const u = world.planUndo;
  if (u === undefined || u.clubId !== club.id) return false;
  // Back into the same object: a saved tactic slot may be holding it.
  const before = JSON.parse(u.before) as TeamTactics;
  const t = club.tactics as unknown as Record<string, unknown>;
  for (const k of Object.keys(t)) delete t[k];
  Object.assign(club.tactics, before);
  world.planUndo = undefined;
  return true;
}
