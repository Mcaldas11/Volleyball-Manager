/**
 * The other clubs' coaches set their sides up for the players they have, as
 * the manager does his: the attack run through whoever hits it best, the serve
 * as hard as the servers can take it and aimed at the weakest passer — rather
 * than every side in the world playing the same default, there for the
 * manager's tactics to beat.
 *
 * Once a season, as it starts, for every club but the manager's.
 */

import type { Club } from '../model/club.ts';
import type { PlayerStore } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { computeRatings } from '../match/ratings.ts';
import {
  defaultTactics, formationOf, lineupSlotPositions, OffensiveSystem, ServeStrategy, ServeTarget, type TeamTactics,
} from '../match/tactics.ts';
import type { World } from './world.ts';

/** How much better one way of attacking has to look than the rest before a coach builds his side around it. */
const LEAN = 1.06;
/** Share of coaches who have their servers aim at the weakest passer. */
const AIM_SHARE = 0.7;

/** What a side's six are good at, by the numbers a coach would look at. */
interface SideProfile {
  opposite: number;
  outside: number;
  middle: number;
  backRow: number;
  servePower: number;
  serveAccuracy: number;
}

function profileOf(store: PlayerStore, lineup: readonly number[], tactics: TeamTactics): SideProfile | null {
  const slots = lineupSlotPositions(formationOf(tactics));
  const at = (pos: Position) => lineup.filter((_, i) => slots[i] === pos).map((p) => computeRatings(store, p, pos));
  const opp = at(Position.Opposite);
  const ohs = at(Position.OutsideHitter);
  const mbs = at(Position.MiddleBlocker);
  if (opp.length === 0 || ohs.length === 0 || mbs.length === 0) return null;
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const hit = (r: { attackPower: number; attackControl: number }): number => r.attackPower * 0.62 + r.attackControl * 0.38;
  const six = lineup.map((p, i) => computeRatings(store, p, slots[i]));
  return {
    opposite: mean(opp.map(hit)),
    outside: mean(ohs.map(hit)),
    middle: mean(mbs.map((r) => r.quickAttack)),
    backRow: mean([...opp.map((r) => r.backRowAttack), Math.max(...ohs.map((r) => r.pipeAttack))]),
    servePower: mean(six.map((r) => Math.max(r.serveJump * 1.06, r.serveFloat * 0.97))),
    serveAccuracy: mean(six.map((r) => r.serveAccuracy)),
  };
}

/**
 * The attack a coach builds around his hitters — each as strong as he is
 * against what is usual at his position (`s` is relative to the world's sides,
 * 1 typical): whichever stands out by a margin, or a balanced attack.
 */
function offenseFor(s: SideProfile): OffensiveSystem {
  const pins = (s.opposite + s.outside) / 2;
  const best = Math.max(s.opposite, s.outside, s.middle, s.backRow);
  if (best < pins * LEAN && best < LEAN) return OffensiveSystem.Balanced;
  if (best === s.opposite) return OffensiveSystem.OppositeFocused;
  if (best === s.outside) return OffensiveSystem.OutsideFocused;
  if (best === s.middle) return OffensiveSystem.MiddleFocused;
  return OffensiveSystem.BackRowHeavy;
}

/** How hard his servers go: hard if they have the power for it, safe if they lack the touch. */
function serveFor(s: SideProfile): ServeStrategy {
  if (s.servePower >= s.serveAccuracy * LEAN) return ServeStrategy.Risky;
  if (s.serveAccuracy >= s.servePower * LEAN) return ServeStrategy.Conservative;
  return ServeStrategy.Balanced;
}

/** A club's coach's tactics for a side as strong as `s` against the usual, from the defaults. */
function coachTactics(club: Club, s: SideProfile | null): TeamTactics {
  const t = defaultTactics();
  if (s === null) return t;
  t.offense = offenseFor(s);
  t.serve = serveFor(s);
  // Most coaches have their servers go after the weakest passer; some leave it to them.
  if (((club.id * 2654435761) >>> 0) % 1000 < AIM_SHARE * 1000) {
    for (const r of t.rotations) r.serveTarget = ServeTarget.WeakestPasser;
  }
  return t;
}

/** Every club but the manager's sets up for the season ahead. */
export function coachesSetUp(world: World, lineupOf: (club: Club) => readonly number[]): void {
  const clubs = world.clubs.filter((c) => c.id !== world.userClubId && c.players.length >= 7);
  const profiles = new Map(clubs.map((c) => [c.id, profileOf(world.players, lineupOf(c), defaultTactics())]));
  // What is usual at each, the world over: each side is judged against it.
  const known = [...profiles.values()].filter((p): p is SideProfile => p !== null);
  const keys = ['opposite', 'outside', 'middle', 'backRow', 'servePower', 'serveAccuracy'] as const;
  const usual = Object.fromEntries(keys.map((k) => [k, known.reduce((s, p) => s + p[k], 0) / Math.max(1, known.length)])) as Record<
    (typeof keys)[number], number>;
  for (const club of clubs) {
    const p = profiles.get(club.id) ?? null;
    const rel = p === null ? null : Object.fromEntries(keys.map((k) => [k, p[k] / Math.max(1, usual[k])])) as unknown as SideProfile;
    club.tactics = coachTactics(club, rel);
  }
  world.coachedSides = true;
}
