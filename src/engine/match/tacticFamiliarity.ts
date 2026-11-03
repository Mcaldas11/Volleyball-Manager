/**
 * How well a side knows its tactic, and how hard the tactic works it.
 *
 * Familiarity, as FM keeps it: each tactic carries how well the side knows
 * it, in three parts — the attack (the system, the offence, the tempo, the
 * combinations, the zone plans), the defence (the defensive system, the block
 * and the floor behind it) and the serve and receive. It is learnt on the
 * training ground — a tactical session or a day's preparation for a match the
 * most, a physical one hardly at all — and by playing it; it is lost by
 * changing it, in the part changed and by as much as was changed. A side that
 * knows its tactic plays it as it is meant; one that doesn't sets a little
 * worse, blocks and digs a little worse, passes and serves a little worse.
 *
 * Intensity is how much the tactic asks of the legs: a fast tempo, an
 * aggressive block, combinations, the serve hit hard. The more intense, the
 * faster the players tire in a match.
 */

import {
  BlockNumbers, Combinations, DefensiveSystem, defaultTactics, OffensiveSystem, ServeStrategy, Tempo,
  type TeamTactics,
} from './tactics.ts';

export type FamiliarityArea = 'attack' | 'defence' | 'serve';

export const FAMILIARITY_AREAS: readonly FamiliarityArea[] = ['attack', 'defence', 'serve'];

export const FAMILIARITY_AREA_NAMES: Readonly<Record<FamiliarityArea, string>> = {
  attack: 'Attack',
  defence: 'Defence',
  serve: 'Serve & receive',
};

/** How well a side knows a tactic, 0-100 in each part — and the instructions it knows. */
export interface TacticFamiliarity {
  attack: number;
  defence: number;
  serve: number;
  /** Each part's instructions as they were last learnt, one entry per instruction. */
  learned: Record<FamiliarityArea, string[]>;
}

/** An instruction, as familiarity weighs it: what it is set to, and how much of its part it is. */
type Item = readonly [string, number];

/** Each part's instructions. The system weighs in the attack and the defence both. */
function itemsOf(t: TeamTactics): Record<FamiliarityArea, Item[]> {
  const j = (v: unknown): string => JSON.stringify(v ?? null);
  const rot = t.rotations ?? [];
  return {
    attack: [
      [j(t.formation), 6], [j(t.offense), 2], [j(t.tempo), 2], [j(t.combinations), 1],
      [j(t.zones?.A), 1], [j(t.zones?.B), 1], [j(t.zones?.C), 1], [j(t.middlePlay), 0.5],
      ...rot.map((r): Item => [j([r.preferredAttacker, r.setterTempoBias, r.transitionBackRow]), 0.3]),
    ],
    defence: [
      [j(t.formation), 4], [j(t.defense), 2],
      [j(t.blockPlans?.outside), 0.7], [j(t.blockPlans?.opposite), 0.7], [j(t.blockPlans?.pipe), 0.7],
      [j(t.defence?.oh), 0.7], [j(t.defence?.mb), 0.7], [j(t.defence?.opp), 0.7],
      ...rot.map((r): Item => [j([r.blockAssignment, r.defensiveShape]), 0.3]),
    ],
    serve: [
      [j(t.serve), 2], [j(t.receive?.float), 1.5], [j(t.receive?.jump), 1.5], [j(t.servers), 1],
      ...rot.map((r): Item => [j([r.serveTarget, r.receivers]), 0.3]),
    ],
  };
}

/** A tactic known to `level` in every part, as it stands now. */
export function freshFamiliarity(t: TeamTactics, level: number): TacticFamiliarity {
  const items = itemsOf(t);
  return {
    attack: level, defence: level, serve: level,
    learned: { attack: items.attack.map(([v]) => v), defence: items.defence.map(([v]) => v), serve: items.serve.map(([v]) => v) },
  };
}

/** How well the side knows a tactic. One that has never been looked at is the one it has always played: known through and through. */
export function familiarityOf(t: TeamTactics): TacticFamiliarity {
  t.familiarity ??= freshFamiliarity(t, 100);
  return t.familiarity;
}

/** How well it is known overall, 0-100: the attack and the defence count most. */
export function overallFamiliarity(f: Pick<TacticFamiliarity, FamiliarityArea>): number {
  return Math.round(0.4 * f.attack + 0.35 * f.defence + 0.25 * f.serve);
}

/** How much of what a part knew goes when this much of it (0-1) is changed. */
const UNLEARN = 0.75;
/** Familiarity never drops below this: the players still know how to play. */
const FLOOR = 20;
/** A tactic new to the side starts at this. */
export const NEW_TACTIC_FAMILIARITY = 40;

/** What each kind of day teaches of the tactic, points. */
export const FAMILIARITY_GAIN: Readonly<Record<string, number>> = {
  tactical: 7, preparation: 5, match: 5, balanced: 3.5, technical: 2, physical: 1, recovery: 1, rest: 0,
};

/** What is left of a part's familiarity once its instructions are as `now`, against those it learnt. */
function keptOf(level: number, was: readonly string[], now: readonly Item[]): number {
  let total = 0;
  let changed = 0;
  for (let i = 0; i < now.length; i++) {
    total += now[i][1];
    if (was[i] !== now[i][0]) changed += now[i][1];
  }
  if (changed === 0) return level;
  return Math.max(Math.min(level, FLOOR), level * (1 - UNLEARN * (changed / Math.max(1e-9, total))));
}

/** How well the side knows each part of the tactic as it stands right now — what any change since it was last learnt has cost already counted. */
export function currentFamiliarity(t: TeamTactics): Record<FamiliarityArea, number> {
  const f = familiarityOf(t);
  const items = itemsOf(t);
  return {
    attack: keptOf(f.attack, f.learned.attack, items.attack),
    defence: keptOf(f.defence, f.learned.defence, items.defence),
    serve: keptOf(f.serve, f.learned.serve, items.serve),
  };
}

/**
 * A day with the tactic: whatever has been changed since the side last
 * learnt it is partly forgotten — in that part, by as much as was changed —
 * and then `gain` points are learnt in every part.
 */
export function learnTactic(t: TeamTactics, gain: number): void {
  const f = familiarityOf(t);
  const items = itemsOf(t);
  for (const area of FAMILIARITY_AREAS) {
    const kept = keptOf(f[area], f.learned[area], items[area]);
    f.learned[area] = items[area].map(([v]) => v);
    f[area] = Math.min(100, kept + gain);
  }
}

/** How well each part is known, 0-1, as a match starts: any change not yet learnt counted, and the tactic left as it is. Never looked at: fully. */
export function matchFamiliarity(t: TeamTactics): Record<FamiliarityArea, number> {
  const f = t.familiarity;
  if (f === undefined) return { attack: 1, defence: 1, serve: 1 };
  const items = itemsOf(t);
  return {
    attack: keptOf(f.attack, f.learned.attack, items.attack) / 100,
    defence: keptOf(f.defence, f.learned.defence, items.defence) / 100,
    serve: keptOf(f.serve, f.learned.serve, items.serve) / 100,
  };
}

/** What not knowing a part at all costs in it: the set, the block and dig, the pass and serve. */
export const UNFAMILIAR_SET = 0.06;
export const UNFAMILIAR_DEFENCE = 0.05;
export const UNFAMILIAR_SERVE = 0.05;

// ---- Intensity ---------------------------------------------------------------------------

const TEMPO_LOAD: Readonly<Record<Tempo, number>> = {
  [Tempo.VeryFast]: 1, [Tempo.Fast]: 0.75, [Tempo.Balanced]: 0.5, [Tempo.Slow]: 0.2,
};
const DEFENCE_LOAD: Readonly<Record<DefensiveSystem, number>> = {
  [DefensiveSystem.Conservative]: 0.35,
  [DefensiveSystem.Aggressive]: 0.75,
  [DefensiveSystem.TripleBlockPriority]: 0.9,
  [DefensiveSystem.ServicePressure]: 0.7,
  [DefensiveSystem.ReceptionStability]: 0.4,
};
const OFFENCE_LOAD: Readonly<Record<OffensiveSystem, number>> = {
  [OffensiveSystem.Fast]: 0.8,
  [OffensiveSystem.Balanced]: 0.5,
  [OffensiveSystem.OutsideFocused]: 0.45,
  [OffensiveSystem.OppositeFocused]: 0.45,
  [OffensiveSystem.MiddleFocused]: 0.65,
  [OffensiveSystem.PipeHeavy]: 0.7,
  [OffensiveSystem.BackRowHeavy]: 0.7,
};
const COMBO_LOAD: Readonly<Record<Combinations, number>> = {
  [Combinations.Off]: 0.2, [Combinations.Some]: 0.5, [Combinations.Often]: 0.85,
};
const SERVE_LOAD: Readonly<Record<ServeStrategy, number>> = {
  [ServeStrategy.Risky]: 0.85, [ServeStrategy.Balanced]: 0.5, [ServeStrategy.Conservative]: 0.25,
};

/** How much a tactic asks of the legs, 0-1: the tempo most, then the defence and the offence. */
export function tacticIntensity(t: TeamTactics): number {
  const plans = t.blockPlans;
  const blocks = plans !== undefined ? [plans.outside, plans.opposite, plans.pipe] : [];
  const triples = blocks.filter((b) => b.numbers === BlockNumbers.Triple).length;
  const singles = blocks.filter((b) => b.numbers === BlockNumbers.Single).length;
  const block = Math.min(1, Math.max(0, 0.5 + 0.15 * triples - 0.1 * singles));
  const parts: Array<[number, number]> = [
    [TEMPO_LOAD[t.tempo] ?? 0.5, 3],
    [DEFENCE_LOAD[t.defense] ?? 0.5, 2],
    [OFFENCE_LOAD[t.offense] ?? 0.5, 2],
    [COMBO_LOAD[t.combinations ?? Combinations.Some] ?? 0.5, 1.5],
    [SERVE_LOAD[t.serve] ?? 0.5, 1.5],
    [block, 1],
  ];
  let sum = 0;
  let weight = 0;
  for (const [v, w] of parts) {
    sum += v * w;
    weight += w;
  }
  return sum / weight;
}

/** The default tactic's intensity: what tires the players at the rate they always have. */
const USUAL_INTENSITY = tacticIntensity(defaultTactics());
/** How much faster a tactic of full intensity tires them than the usual one does, per unit of intensity. */
const INTENSITY_TOLL = 0.3;

/** How fast the tactic tires the players in a match, against the usual tactic: 1 for it, more for a harder one. */
export function intensityFatigue(t: TeamTactics): number {
  return 1 + INTENSITY_TOLL * (tacticIntensity(t) - USUAL_INTENSITY);
}

/** An intensity in words. */
export function intensityLabel(i: number): string {
  return i < 0.35 ? 'Low' : i < 0.55 ? 'Medium' : i < 0.72 ? 'High' : 'Very high';
}

/** A familiarity in words. */
export function familiarityWords(v: number): string {
  return v >= 90 ? 'Fluid' : v >= 70 ? 'Familiar' : v >= 50 ? 'Getting there' : v >= 35 ? 'Learning' : 'Unfamiliar';
}
