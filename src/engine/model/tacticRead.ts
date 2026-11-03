/**
 * How well the opposition has the manager's tactic worked out.
 *
 * Every side in the league has an analyst with the video. Play the same way
 * long enough and the teams you face learn it: where the setter goes in each
 * rotation, who your servers aim at, how your block sets up. Through most of
 * a first season they are still finding out; after about a season of it they
 * are on to you, and if nothing changes they get on top of it. A few tweaks
 * put them off the scent — but only the parts that changed. The rest of the
 * plan they still know.
 *
 * So knowledge is kept per instruction: for each one (the system, the
 * offence, each rotation's serve target, …) how many matches the opposition
 * has watched each of its values played. A value not played fades from
 * memory, so an old idea brought back after a season away is half new again.
 */

import { formationOf, type TeamTactics } from '../match/tactics.ts';

export interface TacticRead {
  /** Matches the opposition has watched each instruction's value played, keyed `instruction=value`. */
  seen: Record<string, number>;
  /** The last level the assistant warned about — 0 none, 1 "starting to", 2 "worked out". */
  warned?: number;
}

/** Matches of exposure before the opposition starts to read a tactic — most of a first season… */
export const READ_ONSET = 18;
/** …and by when, with nothing changed, they have it completely. */
export const READ_FULL = 50;
/** A value not played is remembered this much less after every match. */
const FORGET_PER_MATCH = 0.96;

/** Read levels at which the assistant speaks up. */
export const READ_WARN_STARTING = 0.35;
export const READ_WARN_WORKED_OUT = 0.75;

interface Instruction {
  key: string;
  /** Its share of the whole plan — how much changing it throws the opposition. */
  weight: number;
  value: (t: TeamTactics) => number;
  /** What the assistant calls it. */
  label: string;
}

/** A 0-100 slider, in the three bands an analyst would notice. */
const band = (v: number): number => (v < 34 ? 0 : v < 67 ? 1 : 2);

const ROTATION_PARTS: ReadonlyArray<{ part: string; weight: number; label: string; value: (r: TeamTactics['rotations'][number]) => number }> = [
  { part: 'attacker', weight: 0.022, label: 'first option', value: (r) => r.preferredAttacker },
  { part: 'serve', weight: 0.014, label: 'serve target', value: (r) => r.serveTarget },
  { part: 'block', weight: 0.014, label: 'block', value: (r) => r.blockAssignment },
  { part: 'shape', weight: 0.01, label: 'defensive shape', value: (r) => r.defensiveShape },
  { part: 'backRow', weight: 0.005, label: 'back-row transition', value: (r) => band(r.transitionBackRow) },
  { part: 'tempo', weight: 0.005, label: 'setter tempo', value: (r) => band(r.setterTempoBias) },
];

const INSTRUCTIONS: readonly Instruction[] = [
  { key: 'formation', weight: 0.12, label: 'system', value: (t) => formationOf(t) },
  { key: 'offense', weight: 0.16, label: 'offence', value: (t) => t.offense },
  { key: 'defense', weight: 0.12, label: 'defence', value: (t) => t.defense },
  { key: 'serve', weight: 0.08, label: 'serving', value: (t) => t.serve },
  { key: 'tempo', weight: 0.1, label: 'tempo', value: (t) => t.tempo },
  ...[0, 1, 2, 3, 4, 5].flatMap((r) => ROTATION_PARTS.map((p) => ({
    key: `r${r + 1}.${p.part}`,
    weight: p.weight,
    label: `P${r + 1} ${p.label}`,
    value: (t: TeamTactics) => p.value(t.rotations[r]),
  }))),
];

function seenOf(read: TacticRead | undefined, i: Instruction, t: TeamTactics): number {
  return read?.seen[`${i.key}=${i.value(t)}`] ?? 0;
}

/** Matches' worth of this tactic the opposition has watched. */
export function exposure(read: TacticRead | undefined, t: TeamTactics): number {
  let e = 0;
  for (const i of INSTRUCTIONS) e += i.weight * seenOf(read, i, t);
  return e;
}

/** How well the opposition reads this tactic, 0 (not at all) to 1 (completely). */
export function readLevel(read: TacticRead | undefined, t: TeamTactics): number {
  const x = Math.min(1, Math.max(0, (exposure(read, t) - READ_ONSET) / (READ_FULL - READ_ONSET)));
  return x * x * (3 - 2 * x);
}

/** One more match of this tactic watched: what was played learnt, what wasn't fading. */
export function studyTactic(read: TacticRead, t: TeamTactics): void {
  const played = new Set(INSTRUCTIONS.map((i) => `${i.key}=${i.value(t)}`));
  for (const key of Object.keys(read.seen)) {
    if (played.has(key)) continue;
    read.seen[key] *= FORGET_PER_MATCH;
    if (read.seen[key] < 0.5) delete read.seen[key];
  }
  // Past full knowledge there's nothing more to learn — and it would only
  // make an old idea take longer to forget.
  for (const key of played) read.seen[key] = Math.min(READ_FULL * 1.2, (read.seen[key] ?? 0) + 1);
}

/** The instructions the opposition knows best, as the assistant would name them. */
export function bestKnown(read: TacticRead | undefined, t: TeamTactics, n = 3): string[] {
  return INSTRUCTIONS
    .map((i) => ({ label: i.label, known: i.weight * seenOf(read, i, t) }))
    .filter((x) => x.known > 0)
    .sort((a, b) => b.known - a.known)
    .slice(0, n)
    .map((x) => x.label);
}

/** The team instructions the assistant would change, and what each of their settings is called. */
const CHANGEABLE: ReadonlyArray<{ key: 'offense' | 'tempo' | 'defense' | 'serve'; label: string; names: readonly string[] }> = [
  { key: 'offense', label: 'offence', names: ['Fast offence', 'Balanced', 'Outside focused', 'Opposite focused', 'Middle focused', 'Pipe heavy', 'Back-row heavy'] },
  { key: 'tempo', label: 'tempo', names: ['Very fast', 'Fast', 'Balanced', 'Slow'] },
  { key: 'defense', label: 'defence', names: ['Conservative', 'Aggressive', 'Triple block priority', 'Service pressure', 'Reception stability'] },
  { key: 'serve', label: 'serving', names: ['Risky', 'Balanced', 'Conservative'] },
];

/** A change the assistant recommends: which instruction, from what to what. */
export interface ReadChange {
  label: string;
  from: string;
  to: string;
}

/**
 * What to change to throw the opposition: for each of the team instructions,
 * the setting they know least that does the most to cut how well they read the
 * side — the one nearest what it plays now when several do as much — the
 * best `n` of them, and how well they would read it with all of them made.
 */
export function readSuggestions(read: TacticRead | undefined, t: TeamTactics, n = 2): { changes: ReadChange[]; now: number; after: number } {
  const now = readLevel(read, t);
  const options = CHANGEABLE.map((c) => {
    const current = t[c.key] as number;
    let best = current;
    let bestLevel = now;
    for (let v = 0; v < c.names.length; v++) {
      if (v === current) continue;
      const level = readLevel(read, { ...t, [c.key]: v });
      if (level < bestLevel - 1e-6 || (Math.abs(level - bestLevel) <= 1e-6 && best !== current && Math.abs(v - current) < Math.abs(best - current))) {
        best = v;
        bestLevel = level;
      }
    }
    return { c, current, best, gain: now - bestLevel };
  }).filter((o) => o.best !== o.current && o.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, n);
  let changed: TeamTactics = t;
  for (const o of options) changed = { ...changed, [o.c.key]: o.best };
  return {
    changes: options.map((o) => ({ label: o.c.label, from: o.c.names[o.current] ?? '?', to: o.c.names[o.best] ?? '?' })),
    now,
    after: readLevel(read, changed),
  };
}
