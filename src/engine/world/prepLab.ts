/**
 * The tactical preparation lab: the next opponent as the scouts and the
 * analyst have him — not as he is: the better the staff, the surer the read —
 * and practice matches against that picture, the side as it stands against
 * the side with one thing changed, to see which comes out better.
 *
 * The practice matches are the full engine, played against the opponent the
 * staff believe in: a wrong read makes for a wrong lesson. The same seeds for
 * both, so the difference is the change and not the dice; and still, forty
 * matches is a sample — the lab says how sure it is.
 */

import { Rng } from '../core/rng.ts';
import { MatchFormat, MatchSimulator, type MatchResult } from '../match/engine.ts';
import {
  BlockAssignment, BlockFocus, BlockNumbers, blockPlansOf, OffensiveSystem, ServeStrategy, ServeTarget, Tempo,
  type TeamTactics,
} from '../match/tactics.ts';
import type { Club } from '../model/club.ts';
import { Position } from '../model/positions.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import type { World } from './world.ts';

export const OFFENSE_NAMES: Readonly<Record<OffensiveSystem, string>> = {
  [OffensiveSystem.Fast]: 'Fast', [OffensiveSystem.Balanced]: 'Balanced', [OffensiveSystem.OutsideFocused]: 'Through the outsides',
  [OffensiveSystem.OppositeFocused]: 'Through the opposite', [OffensiveSystem.MiddleFocused]: 'Through the middle',
  [OffensiveSystem.PipeHeavy]: 'Pipe-heavy', [OffensiveSystem.BackRowHeavy]: 'Back-row heavy',
};
export const SERVE_NAMES: Readonly<Record<ServeStrategy, string>> = {
  [ServeStrategy.Risky]: 'Aggressive', [ServeStrategy.Balanced]: 'Balanced', [ServeStrategy.Conservative]: 'Safe',
};
export const TEMPO_NAMES: Readonly<Record<Tempo, string>> = {
  [Tempo.VeryFast]: 'Very fast', [Tempo.Fast]: 'Fast', [Tempo.Balanced]: 'Balanced', [Tempo.Slow]: 'Slow',
};

/** The next opponent, as the staff read him: each thing they believe, and whether they are sure of it. */
export interface ScoutedOpponent {
  clubId: number;
  /** How good the read is, 0-1. */
  accuracy: number;
  offense: OffensiveSystem;
  offenseSure: boolean;
  serve: ServeStrategy;
  serveSure: boolean;
  tempo: Tempo;
  tempoSure: boolean;
  /** Their main threat this season, and the passer they think weakest — -1 when none. */
  danger: number;
  weakPasser: number;
  weakSure: boolean;
}

/** What the staff can make of the next opponent: the surer, the better they are. */
export function scoutOpponent(world: World, opp: Club, accuracy: number, seed: number): ScoutedOpponent {
  const store = world.players;
  const rng = new Rng(seed);
  const t = opp.tactics;
  const guess = <T extends number>(truth: T, options: readonly T[]): [T, boolean] => {
    const sure = rng.chance(0.35 + accuracy * 0.6);
    if (sure) return [truth, true];
    const others = options.filter((o) => o !== truth);
    // Not sure: often right anyway, sometimes not.
    return rng.chance(0.5) ? [truth, false] : [rng.pick(others), false];
  };
  const [offense, offenseSure] = guess(t.offense, [0, 1, 2, 3, 4, 5, 6] as OffensiveSystem[]);
  const [serve, serveSure] = guess(t.serve, [0, 1, 2] as ServeStrategy[]);
  const [tempo, tempoSure] = guess(t.tempo, [0, 1, 2, 3] as Tempo[]);
  // Their danger man: the most points this season — that much is in the papers.
  let danger = -1;
  let best = -1;
  for (const p of opp.players) {
    const pts = (world.competitionRecords.get(p) ?? []).filter((r) => r.season === world.season).reduce((n, r) => n + r.points, 0);
    if (pts > best) { best = pts; danger = p; }
  }
  if (best <= 0) danger = [...opp.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[0] ?? -1;
  // Their weakest passer among the outsides and the libero: the truth to a good eye, a guess to a poor one.
  const passers = opp.players.filter((p) => store.position[p] === Position.OutsideHitter || store.position[p] === Position.Libero)
    .sort((a, b) => store.getAttr(a, 'reception') - store.getAttr(b, 'reception'));
  const weakSure = rng.chance(0.3 + accuracy * 0.65);
  const weakPasser = passers.length === 0 ? -1 : weakSure || passers.length === 1 ? passers[0] : rng.pick(passers.slice(0, Math.min(3, passers.length)));
  return { clubId: opp.id, accuracy, offense, offenseSure, serve, serveSure, tempo, tempoSure, danger, weakPasser, weakSure };
}

/** One thing to try in the lab. */
export interface PrepVariant {
  id: string;
  label: string;
  apply: (t: TeamTactics) => void;
}

export const PREP_VARIANTS: readonly PrepVariant[] = [
  { id: 'serve-weakest', label: 'Serve at their weakest passer', apply: (t) => { for (const r of t.rotations) r.serveTarget = ServeTarget.WeakestPasser; } },
  { id: 'serve-risky', label: 'Serve aggressively', apply: (t) => { t.serve = ServeStrategy.Risky; } },
  { id: 'serve-safe', label: 'Serve safe', apply: (t) => { t.serve = ServeStrategy.Conservative; } },
  { id: 'commit-middle', label: 'Commit the middle blocker on their quick', apply: (t) => { for (const r of t.rotations) r.blockAssignment = BlockAssignment.CommitMiddle; } },
  { id: 'triple-outside', label: 'Three up against their outside', apply: (t) => { t.blockPlans = { ...blockPlansOf(t), outside: { focus: BlockFocus.Read, numbers: BlockNumbers.Triple } }; } },
  { id: 'block-opposite-cross', label: 'Take the cross away from their opposite', apply: (t) => { t.blockPlans = { ...blockPlansOf(t), opposite: { focus: BlockFocus.Cross, numbers: BlockNumbers.Double } }; } },
  { id: 'offense-opposite', label: 'Play more through the opposite', apply: (t) => { t.offense = OffensiveSystem.OppositeFocused; } },
  { id: 'offense-middle', label: 'Play more through the middle', apply: (t) => { t.offense = OffensiveSystem.MiddleFocused; } },
  { id: 'tempo-fast', label: 'Play faster', apply: (t) => { t.tempo = Tempo.Fast; } },
  { id: 'receive-4', label: 'Four in the reception line', apply: (t) => { for (const r of t.rotations) r.receivers = 4; } },
];

export interface LabLine {
  /** Share of the points won, of the sets won, side-out rate. */
  points: number;
  sets: number;
  sideOut: number;
}

export interface LabResult {
  matches: number;
  base: LabLine;
  variant: LabLine;
  /** The variant's edge in points won, per hundred rallies — and how sure of it the lab is: 'clear', 'likely', 'noise'. */
  edge: number;
  confidence: 'clear' | 'likely' | 'noise';
}

/** Practice matches: the side as it is, and with the variant, against the opponent as the staff read him. */
export function runPrepLab(world: World, club: Club, opp: Club, scouted: ScoutedOpponent, variant: PrepVariant, matches = 40): LabResult {
  const store = world.players;
  const theirTactics = structuredClone(opp.tactics);
  // The opponent the staff believe in — right or wrong.
  theirTactics.offense = scouted.offense;
  theirTactics.serve = scouted.serve;
  theirTactics.tempo = scouted.tempo;
  const play = (change: ((t: TeamTactics) => void) | null): { line: LabLine; perMatch: number[] } => {
    let won = 0;
    let total = 0;
    let setsWon = 0;
    let sets = 0;
    let received = 0;
    let sidedOut = 0;
    const perMatch: number[] = [];
    for (let i = 0; i < matches; i++) {
      const home = toTeamSetup(store, club);
      home.tactics = structuredClone(club.tactics);
      if (change !== null) change(home.tactics);
      const away = toTeamSetup(store, opp);
      away.tactics = structuredClone(theirTactics);
      const r: MatchResult = new MatchSimulator(store, {
        home, away, format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: false, seed: 9_001 + i * 7919 + opp.id,
      }).run();
      let h = 0;
      let a = 0;
      for (const [x, y] of r.setScores) { h += x; a += y; }
      won += h;
      total += h + a;
      perMatch.push(h / Math.max(1, h + a));
      setsWon += r.homeSets;
      sets += r.homeSets + r.awaySets;
      for (const rot of r.stats.home.rotations) { received += rot.receiveRallies; sidedOut += rot.sideOutsWon; }
    }
    return { line: { points: won / Math.max(1, total), sets: setsWon / Math.max(1, sets), sideOut: sidedOut / Math.max(1, received) }, perMatch };
  };
  const base = play(null);
  const alt = play(variant.apply);
  // Paired: the same dice for both, match by match.
  const diffs = alt.perMatch.map((v, i) => v - base.perMatch[i]);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, diffs.length - 1));
  const se = sd / Math.sqrt(diffs.length);
  const z = se > 0 ? Math.abs(mean) / se : 0;
  return {
    matches, base: base.line, variant: alt.line, edge: mean * 100,
    confidence: z >= 2.6 ? 'clear' : z >= 1.6 ? 'likely' : 'noise',
  };
}
