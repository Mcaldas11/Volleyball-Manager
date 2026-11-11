/**
 * The bench's eye on a match: what the rallies say, and what to do about it.
 *
 * `playStats` reads a side's match — or several — out of the rally log: how
 * each rotation sides out, how each passer takes the serve, how the side
 * serves, where it attacks and how well, and where the other side hurts it.
 *
 * `diagnose` is the assistant coach's reading of those numbers: a few
 * findings, each with — where there is one — a change to the tactic that can
 * be made at once. It only speaks up on a real sample and a real gap: early in
 * a match it says it is too early, and when nothing stands out it says to
 * hold, rather than inventing a change for the sake of one. A better assistant
 * sees more of what there is to see; a poor one misses things.
 *
 * `opponentCounter` is the other bench doing the same to the manager's side
 * in a live match: noticing where he attacks and whom his serve finds weakest,
 * and moving its block or its serve onto it — once in a while, more surely the
 * better its coach, and only for the match.
 */

import { Rng } from '../core/rng.ts';
import { Position, POSITION_NAMES } from '../model/positions.ts';
import type { RallyLogEntry } from './engine.ts';
import {
  BlockAssignment, BlockFocus, BlockNumbers, blockPlansOf, OffensiveSystem, ServeStrategy, ServeTarget,
  type BlockTarget, type TeamTactics,
} from './tactics.ts';

/** Where an attack comes from, as the bench thinks of it. */
export type AttackSource = 'outside' | 'opposite' | 'middle' | 'pipe';
export const ATTACK_SOURCES: readonly AttackSource[] = ['outside', 'opposite', 'middle', 'pipe'];
export const SOURCE_NAMES: Readonly<Record<AttackSource, string>> = {
  outside: 'the outside', opposite: 'the opposite', middle: 'the middle', pipe: 'the pipe',
};

const SOURCE_OF_LANE: Readonly<Record<string, AttackSource>> = {
  'Outside': 'outside', 'Second tempo outside': 'outside', 'Opposite': 'opposite', 'Back-row right': 'opposite',
  'Pipe': 'pipe', 'Quick (middle)': 'middle',
};

interface AttackLine { att: number; kills: number; errors: number; line: number; cross: number }
interface PassLine { n: number; q: number; errors: number }
interface RotationLine { received: number; sidedOut: number; served: number; broke: number; passes: number; passQ: number }

/** A side's match, or matches, as the bench reads them. Plain data: it is kept with the season. */
export interface PlayStats {
  rallies: number;
  won: number;
  rotations: RotationLine[];
  serves: number;
  aces: number;
  serveErrors: number;
  /** By player index. */
  passers: Record<number, PassLine>;
  /** Our attacks, by where they came from — and by player. */
  attacks: Record<AttackSource, AttackLine>;
  attackers: Record<number, AttackLine>;
  /** Theirs against us. */
  theirs: Record<AttackSource, AttackLine>;
}

function emptyLine(): AttackLine {
  return { att: 0, kills: 0, errors: 0, line: 0, cross: 0 };
}

export function emptyStats(): PlayStats {
  const by = (): Record<AttackSource, AttackLine> =>
    ({ outside: emptyLine(), opposite: emptyLine(), middle: emptyLine(), pipe: emptyLine() });
  return {
    rallies: 0, won: 0, serves: 0, aces: 0, serveErrors: 0, passers: {}, attackers: {},
    rotations: Array.from({ length: 6 }, () => ({ received: 0, sidedOut: 0, served: 0, broke: 0, passes: 0, passQ: 0 })),
    attacks: by(), theirs: by(),
  };
}

function addAttack(l: AttackLine, kind: string, shot: string | undefined): void {
  l.att++;
  if (kind === 'kill') l.kills++;
  if (kind === 'attackError' || kind === 'blocked') l.errors++;
  if (shot === 'line' || shot === 'shortLine') l.line++;
  else if (shot === 'cross' || shot === 'cut') l.cross++;
}

/** A side's rallies, read: from set `fromSet` on (0, the whole match). */
export function playStats(log: readonly RallyLogEntry[], team: 0 | 1, fromSet = 0, into: PlayStats = emptyStats()): PlayStats {
  const s = into;
  for (const r of log) {
    if (r.set < fromSet) continue;
    s.rallies++;
    if (r.winner === team) s.won++;
    const rot = s.rotations[(team === 0 ? r.homeRotation : r.awayRotation) % 6];
    if (r.serveTeam === team) {
      rot.served++;
      if (r.winner === team) rot.broke++;
    } else {
      rot.received++;
      if (r.winner === team) rot.sidedOut++;
    }
    for (const c of r.contacts) {
      if (c.kind === 'serve' || c.kind === 'serveError') {
        if (c.team === team) {
          s.serves++;
          if (c.kind === 'serveError') s.serveErrors++;
        }
        continue;
      }
      if (c.kind === 'ace') {
        if (c.team === team) s.aces++;
        else if (c.passer !== undefined) pass(s, rot, c.passer, 0, true);
        continue;
      }
      if (c.kind === 'reception' || c.kind === 'receptionError') {
        if (c.team === team) pass(s, rot, c.player, c.kind === 'receptionError' ? 0 : c.quality ?? 0.5, c.kind === 'receptionError');
        else if (c.kind === 'receptionError') s.aces++;
        continue;
      }
      if (c.kind === 'attack' || c.kind === 'kill' || c.kind === 'attackError' || c.kind === 'blocked') {
        if (c.shot === 'recycle') continue;
        const source = SOURCE_OF_LANE[c.detail ?? ''];
        if (source === undefined) continue;
        if (c.team === team) {
          addAttack(s.attacks[source], c.kind, c.shot);
          addAttack((s.attackers[c.player] ??= emptyLine()), c.kind, c.shot);
        } else {
          addAttack(s.theirs[source], c.kind, c.shot);
        }
      }
    }
  }
  return s;
}

function pass(s: PlayStats, rot: RotationLine, p: number, q: number, error: boolean): void {
  const l = (s.passers[p] ??= { n: 0, q: 0, errors: 0 });
  l.n++;
  l.q += q;
  if (error) l.errors++;
  rot.passes++;
  rot.passQ += q;
}

/** Two readings added together — a few matches, say. */
export function mergeStats(a: PlayStats, b: PlayStats): PlayStats {
  const out = structuredClone(a);
  out.rallies += b.rallies;
  out.won += b.won;
  out.serves += b.serves;
  out.aces += b.aces;
  out.serveErrors += b.serveErrors;
  b.rotations.forEach((r, i) => {
    const o = out.rotations[i];
    o.received += r.received; o.sidedOut += r.sidedOut; o.served += r.served; o.broke += r.broke;
    o.passes += r.passes; o.passQ += r.passQ;
  });
  const addLine = (o: AttackLine, l: AttackLine): void => {
    o.att += l.att; o.kills += l.kills; o.errors += l.errors; o.line += l.line; o.cross += l.cross;
  };
  for (const src of ATTACK_SOURCES) {
    addLine(out.attacks[src], b.attacks[src]);
    addLine(out.theirs[src], b.theirs[src]);
  }
  for (const [p, l] of Object.entries(b.attackers)) addLine((out.attackers[Number(p)] ??= emptyLine()), l);
  for (const [p, l] of Object.entries(b.passers)) {
    const o = (out.passers[Number(p)] ??= { n: 0, q: 0, errors: 0 });
    o.n += l.n; o.q += l.q; o.errors += l.errors;
  }
  return out;
}

// ---- The assistant's reading ------------------------------------------------------------

export type FindingArea = 'rotation' | 'reception' | 'serve' | 'attack' | 'block' | 'player';

/** A change to the tactic, ready to make — and the part of it whose familiarity it costs. */
export interface TacticChange {
  /** Stable for the same advice: the same change is not offered twice once made. */
  id: string;
  label: string;
  apply: (t: TeamTactics) => void;
}

export interface Finding {
  id: string;
  area: FindingArea;
  /** 1 worth knowing, 2 worth acting on, 3 costing points now. */
  severity: 1 | 2 | 3;
  title: string;
  detail: string;
  change?: TacticChange;
  /** A player it is about — a substitution to think about, say. */
  playerIdx?: number;
}

export interface Diagnosis {
  /** 'early': too little to go on; 'hold': nothing worth changing; 'adjust': findings to act on. */
  verdict: 'early' | 'hold' | 'adjust';
  summary: string;
  findings: Finding[];
  /** The headline numbers the reading is based on. */
  numbers: { sideOut: number | null; breakPoint: number | null; attackEff: number | null; passQ: number | null; serveErrors: number | null };
}

export interface DiagnosisContext {
  positionOf: (p: number) => Position;
  nameOf: (p: number) => string;
  /** How good the assistant is at seeing it, 0-1. */
  eye: number;
  seed: number;
  /** Mid-match: smaller samples are enough, and suggestions are for the match. */
  live: boolean;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const eff = (l: AttackLine): number => (l.att > 0 ? (l.kills - l.errors) / l.att : 0);
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

const OFFENSE_FOR: Readonly<Record<AttackSource, OffensiveSystem>> = {
  outside: OffensiveSystem.OutsideFocused, opposite: OffensiveSystem.OppositeFocused,
  middle: OffensiveSystem.MiddleFocused, pipe: OffensiveSystem.PipeHeavy,
};
const BLOCK_TARGET_OF: Readonly<Partial<Record<AttackSource, BlockTarget>>> = {
  outside: 'outside', opposite: 'opposite', pipe: 'pipe',
};

/** The shot a side's attacks from a source favour, if one clearly: 'line' or 'cross'. */
function favouredShot(l: AttackLine, min: number): 'line' | 'cross' | null {
  const dir = l.line + l.cross;
  if (dir < min) return null;
  if (l.line / dir >= 0.62) return 'line';
  if (l.cross / dir >= 0.62) return 'cross';
  return null;
}

/** Block a source's favourite shot away: the focus on it, two up — the change for either bench. */
function blockChange(source: AttackSource, shot: 'line' | 'cross' | null, live: boolean): TacticChange | null {
  if (source === 'middle') {
    return {
      id: 'block-commit-middle',
      label: 'Commit the middle blocker on their quick, in every rotation',
      apply: (t) => { for (const r of t.rotations) r.blockAssignment = BlockAssignment.CommitMiddle; },
    };
  }
  const target = BLOCK_TARGET_OF[source]!;
  const focus = shot === 'line' ? BlockFocus.Line : shot === 'cross' ? BlockFocus.Cross : BlockFocus.Read;
  // No shot to take away: three up on him, reading it (two up reading is the usual block — no change at all).
  const numbers = shot !== null ? BlockNumbers.Double : BlockNumbers.Triple;
  return {
    id: `block-${target}-${shot ?? 'triple'}`,
    label: shot !== null
      ? `Block ${SOURCE_NAMES[source]} to take the ${shot} away, two up`
      : `Put three up against ${SOURCE_NAMES[source]}`,
    apply: (t) => {
      const plans = (t.blockPlans = { ...blockPlansOf(t) });
      plans[target] = { focus, numbers };
      void live;
    },
  };
}

/**
 * The assistant's reading of a side's numbers: up to three findings, most
 * pressing first — or, on too little, 'early', and when nothing stands out,
 * 'hold'.
 */
export function diagnose(s: PlayStats, tactics: TeamTactics, ctx: DiagnosisContext, theirs?: PlayStats): Diagnosis {
  const received = s.rotations.reduce((n, r) => n + r.received, 0);
  const sidedOut = s.rotations.reduce((n, r) => n + r.sidedOut, 0);
  const served = s.rotations.reduce((n, r) => n + r.served, 0);
  const broke = s.rotations.reduce((n, r) => n + r.broke, 0);
  const passes = Object.values(s.passers).reduce((n, l) => n + l.n, 0);
  const passQ = Object.values(s.passers).reduce((n, l) => n + l.q, 0);
  const ours = ATTACK_SOURCES.reduce((l, src) => {
    const a = s.attacks[src];
    return { att: l.att + a.att, kills: l.kills + a.kills, errors: l.errors + a.errors, line: 0, cross: 0 };
  }, emptyLine());
  const numbers = {
    sideOut: ratio(sidedOut, received), breakPoint: ratio(broke, served), attackEff: ours.att > 0 ? eff(ours) : null,
    passQ: ratio(passQ, passes), serveErrors: ratio(s.serveErrors, s.serves),
  };
  // How much is enough to go on: in a match, a set's worth; over matches, more.
  const k = ctx.live ? 1 : 2.5;
  if (s.rallies < 18 * (ctx.live ? 1 : 2)) {
    return { verdict: 'early', summary: 'Too early to read anything — give it a few more points.', findings: [], numbers };
  }
  const found: Finding[] = [];
  const overallSO = numbers.sideOut ?? 0.6;

  // ---- A rotation that will not side out ----
  s.rotations.forEach((r, i) => {
    if (r.received < 5 * k) return;
    const so = r.sidedOut / r.received;
    if (so >= 0.47 || overallSO - so < 0.12) return;
    const q = r.passes > 0 ? r.passQ / r.passes : 0.5;
    const rt = tactics.rotations[i];
    const receivers = rt?.receivers ?? 3;
    const passing = q < 0.48;
    let change: TacticChange | undefined;
    if (passing && receivers < 4) {
      change = {
        id: `rot${i}-receive4`, label: `Four in the reception line in P${i + 1}`,
        apply: (t) => { if (t.rotations[i] !== undefined) t.rotations[i].receivers = 4; },
      };
    } else if (!passing) {
      // The pass is there: the ball goes to the wrong man. Feed whoever is putting it away.
      const best = bestAttacker(s, ctx, 4 * k);
      if (best !== null && rt !== undefined && rt.preferredAttacker !== ctx.positionOf(best)) {
        const pos = ctx.positionOf(best);
        change = {
          id: `rot${i}-feed-${pos}`, label: `In P${i + 1}, look for the ${POSITION_NAMES[pos].toLowerCase()} first (${ctx.nameOf(best)})`,
          apply: (t) => { if (t.rotations[i] !== undefined) t.rotations[i].preferredAttacker = pos; },
        };
      }
    }
    found.push({
      id: `rot${i}`, area: 'rotation', severity: so < 0.38 ? 3 : 2,
      title: `P${i + 1} is not siding out`,
      detail: `${pct(so)} of points won receiving in P${i + 1}, against ${pct(overallSO)} overall` +
        (passing ? ` — the pass is the problem there (quality ${Math.round(q * 100)}).` : ' — the pass is fine; the attack after it is not.'),
      change,
    });
  });

  // ---- A passer the serve is finding ----
  for (const [key, l] of Object.entries(s.passers)) {
    const p = Number(key);
    if (l.n < 6 * k) continue;
    const q = l.q / l.n;
    if (q >= 0.42 && l.errors < 3 * k) continue;
    const pos = ctx.positionOf(p);
    found.push({
      id: `pass-${p}`, area: 'reception', severity: l.errors >= 3 * k ? 2 : 1, playerIdx: p,
      title: `${ctx.nameOf(p)} is being served`,
      detail: `${l.n} passes, quality ${Math.round(q * 100)}, ${l.errors} aced or shanked.` +
        (pos === Position.Libero ? ' He is the libero: the pass has to come from him — or the other libero.'
          : ' A fresh passer from the bench may steady it.'),
    });
  }

  // ---- The serve ----
  if (s.serves >= 12 * k) {
    const errRate = s.serveErrors / s.serves;
    const theirSO = served > 0 ? 1 - broke / served : 0.6;
    if (errRate >= 0.28 && s.aces / s.serves < 0.06 && tactics.serve !== ServeStrategy.Conservative) {
      const next = tactics.serve === ServeStrategy.Risky ? ServeStrategy.Balanced : ServeStrategy.Conservative;
      found.push({
        id: 'serve-down', area: 'serve', severity: errRate >= 0.34 ? 3 : 2,
        title: 'Too many serves missed',
        detail: `${s.serveErrors} of ${s.serves} serves missed (${pct(errRate)}) — points given away for ${s.aces} aces.`,
        change: {
          id: `serve-${next}`, label: next === ServeStrategy.Balanced ? 'Serve with less risk (balanced)' : 'Serve safe (conservative)',
          apply: (t) => { t.serve = next; },
        },
      });
    } else if (errRate <= 0.09 && theirSO >= 0.68 && tactics.serve !== ServeStrategy.Risky) {
      const next = tactics.serve === ServeStrategy.Conservative ? ServeStrategy.Balanced : ServeStrategy.Risky;
      found.push({
        id: 'serve-up', area: 'serve', severity: 2,
        title: 'The serve is no threat',
        detail: `They side out ${pct(theirSO)} of the time and we miss only ${pct(errRate)} — there is room to serve harder.`,
        change: {
          id: `serve-${next}`, label: next === ServeStrategy.Risky ? 'Serve aggressively (risky)' : 'Serve with more intent (balanced)',
          apply: (t) => { t.serve = next; },
        },
      });
    }
    // A known weak passer of theirs is better found than missed — nothing to read here from our side.
  }

  // ---- Their weakest passer: serve at him ----
  if (theirs !== undefined && tactics.rotations.some((r) => r.serveTarget !== ServeTarget.WeakestPasser)) {
    let weakest: { p: number; q: number; n: number } | null = null;
    for (const [key, l] of Object.entries(theirs.passers)) {
      if (l.n < 6 * k) continue;
      const q = l.q / l.n;
      if (q < 0.45 && (weakest === null || q < weakest.q)) weakest = { p: Number(key), q, n: l.n };
    }
    if (weakest !== null) {
      found.push({
        id: 'serve-weakest', area: 'serve', severity: weakest.q < 0.36 ? 3 : 2, playerIdx: weakest.p,
        title: `${ctx.nameOf(weakest.p)} is their weak link in reception`,
        detail: `${weakest.n} passes at quality ${Math.round(weakest.q * 100)}. Serve at him.`,
        change: {
          id: 'serve-weakest', label: 'Serve at their weakest passer, in every rotation',
          apply: (t) => { for (const r of t.rotations) r.serveTarget = ServeTarget.WeakestPasser; },
        },
      });
    }
  }

  // ---- Where our attack works and where it doesn't ----
  const worked = ATTACK_SOURCES.filter((src) => s.attacks[src].att >= 5 * k).sort((a, b) => eff(s.attacks[a]) - eff(s.attacks[b]));
  if (worked.length >= 2) {
    const worst = worked[0];
    const best = worked[worked.length - 1];
    const w = s.attacks[worst];
    const b = s.attacks[best];
    if (w.att >= 8 * k && eff(w) < 0.05 && eff(b) >= 0.25 && eff(b) - eff(w) >= 0.25 && tactics.offense !== OFFENSE_FOR[best]) {
      const sys = OFFENSE_FOR[best];
      found.push({
        id: `attack-${best}`, area: 'attack', severity: eff(w) < -0.05 ? 3 : 2,
        title: `${cap(SOURCE_NAMES[worst])} is not scoring`,
        detail: `${w.att} attacks through ${SOURCE_NAMES[worst]} at ${eff(w).toFixed(3)} efficiency; ${SOURCE_NAMES[best]} is at ${eff(b).toFixed(3)} on ${b.att}.`,
        change: {
          id: `offense-${sys}`, label: `Play more through ${SOURCE_NAMES[best]}`,
          apply: (t) => { t.offense = sys; },
        },
      });
    }
  }

  // ---- Where they hurt us ----
  const theirTotal = ATTACK_SOURCES.reduce((n, src) => n + s.theirs[src].att, 0);
  const threat = ATTACK_SOURCES
    .filter((src) => s.theirs[src].att >= 8 * k && s.theirs[src].kills / s.theirs[src].att >= 0.48 && s.theirs[src].att / Math.max(1, theirTotal) >= 0.3)
    .sort((a, b) => s.theirs[b].kills - s.theirs[a].kills)[0];
  if (threat !== undefined) {
    const l = s.theirs[threat];
    const shot = favouredShot(l, 6 * k);
    const change = blockChange(threat, shot, ctx.live);
    const already = change !== null && alreadySet(tactics, threat, shot);
    if (!already) {
      found.push({
        id: `threat-${threat}`, area: 'block', severity: l.kills / l.att >= 0.58 ? 3 : 2,
        title: `${cap(SOURCE_NAMES[threat])} is hurting us`,
        detail: `${l.kills} kills from ${l.att} attacks through ${SOURCE_NAMES[threat]}` +
          (shot !== null ? `, most of them ${shot === 'line' ? 'down the line' : 'cross-court'}.` : '.'),
        change: change ?? undefined,
      });
    }
  }

  // ---- A player having a bad night ----
  for (const [key, l] of Object.entries(s.attackers)) {
    if (l.att < 8 * k || eff(l) > -0.06) continue;
    const p = Number(key);
    found.push({
      id: `player-${p}`, area: 'player', severity: 1, playerIdx: p,
      title: `${ctx.nameOf(p)} is struggling`,
      detail: `${l.kills} kills, ${l.errors} errors or blocked from ${l.att} attacks (${eff(l).toFixed(3)}). A change may help him — or the side.`,
    });
  }

  // The assistant sees what he sees: a better one more of it.
  const rng = new Rng(ctx.seed);
  const seen = found.filter((f) => rng.chance(Math.min(1, 0.45 + ctx.eye * 0.6 + (f.severity - 2) * 0.15)));
  seen.sort((a, b) => b.severity - a.severity);
  const findings = seen.slice(0, 3);
  // Winning comfortably, only what is costing points is worth the disruption.
  const winning = s.rallies > 0 && s.won / s.rallies >= 0.56;
  const acting = findings.filter((f) => f.severity >= (winning ? 3 : 2));
  if (acting.length === 0) {
    return {
      verdict: 'hold',
      summary: winning
        ? 'We are on top. Nothing worth changing — the side is playing to its level. Hold your nerve.'
        : 'Nothing stands out that a change would fix. Hold your nerve and let them play.',
      findings,
      numbers,
    };
  }
  return {
    verdict: 'adjust',
    summary: ((): string => {
      const costing = acting.filter((f) => f.severity === 3).length;
      if (costing === acting.length) return costing === 1 ? 'One thing is costing us points.' : `${costing} things are costing us points.`;
      if (costing > 0) return `${acting.length} things worth acting on — ${costing === 1 ? 'one is' : `${costing} are`} costing us points now.`;
      return acting.length === 1 ? 'One thing worth acting on.' : `${acting.length} things worth acting on.`;
    })(),
    findings,
    numbers,
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The side's most effective attacker, on enough attacks. */
function bestAttacker(s: PlayStats, ctx: DiagnosisContext, min: number): number | null {
  let best: number | null = null;
  let bestEff = 0.2;
  for (const [key, l] of Object.entries(s.attackers)) {
    if (l.att < min) continue;
    const p = Number(key);
    if (ctx.positionOf(p) === Position.Libero || ctx.positionOf(p) === Position.Setter) continue;
    if (eff(l) > bestEff) {
      bestEff = eff(l);
      best = p;
    }
  }
  return best;
}

/** The block is set up against that already. */
function alreadySet(t: TeamTactics, source: AttackSource, shot: 'line' | 'cross' | null): boolean {
  if (source === 'middle') return t.rotations.every((r) => r.blockAssignment === BlockAssignment.CommitMiddle);
  const plan = blockPlansOf(t)[BLOCK_TARGET_OF[source]!];
  const focus = shot === 'line' ? BlockFocus.Line : shot === 'cross' ? BlockFocus.Cross : BlockFocus.Read;
  return plan.focus === focus && plan.numbers >= (shot !== null ? BlockNumbers.Double : BlockNumbers.Triple);
}

// ---- The other bench ------------------------------------------------------------------

export interface OpponentMove {
  id: string;
  /** What the manager's side sees: "They have moved their block…". */
  message: string;
  apply: (t: TeamTactics) => void;
}

/**
 * The other bench's answer to the manager's side, `s` being that side's
 * numbers: its block onto where he attacks most and best, or its serve onto
 * his weakest passer. A better coach notices sooner and is surer of it; any
 * coach makes only so many changes in a match. Null: nothing yet, or nothing
 * seen.
 */
export function opponentCounter(s: PlayStats, theirTactics: TeamTactics, coach: number, seed: number, done: ReadonlySet<string>): OpponentMove | null {
  const rng = new Rng(seed);
  // How much they need to see: a good coach reads it off less.
  const need = Math.round(10 - coach * 5);
  if (!rng.chance(0.3 + coach * 0.6)) return null;
  const moves: Array<{ move: OpponentMove; weight: number }> = [];
  const total = ATTACK_SOURCES.reduce((n, src) => n + s.attacks[src].att, 0);
  for (const src of ATTACK_SOURCES) {
    const l = s.attacks[src];
    if (l.att < need || total === 0) continue;
    const share = l.att / total;
    const killRate = l.kills / l.att;
    if (share < 0.32 || killRate < 0.4) continue;
    const shot = favouredShot(l, Math.max(4, need - 3));
    const change = blockChange(src, shot, true);
    if (change === null || done.has(change.id) || alreadySet(theirTactics, src, shot)) continue;
    moves.push({
      weight: share * killRate * 3,
      move: {
        id: change.id,
        message: src === 'middle'
          ? 'They are committing their middle blocker on your quick now.'
          : shot !== null
            ? `They have moved their block on ${SOURCE_NAMES[src]} to take the ${shot} away.`
            : `They are putting three up against ${SOURCE_NAMES[src]} now.`,
        apply: change.apply,
      },
    });
  }
  // Whom to serve at: the passer the serve has found worst.
  let weakest: { p: number; q: number } | null = null;
  for (const [key, l] of Object.entries(s.passers)) {
    if (l.n < Math.max(4, need - 2)) continue;
    const q = l.q / l.n;
    if (q < 0.5 && (weakest === null || q < weakest.q)) weakest = { p: Number(key), q };
  }
  if (weakest !== null && !done.has('serve-weakest') && theirTactics.rotations.some((r) => r.serveTarget !== ServeTarget.WeakestPasser)) {
    moves.push({
      weight: (0.5 - weakest.q) * 4,
      move: {
        id: 'serve-weakest',
        message: 'They are serving at your weakest passer now.',
        apply: (t) => { for (const r of t.rotations) r.serveTarget = ServeTarget.WeakestPasser; },
      },
    });
  }
  if (moves.length === 0) return null;
  moves.sort((a, b) => b.weight - a.weight);
  return moves[0].move;
}
