/**
 * The rally engine.
 *
 * Every point in every match in the game world resolves through this file, one
 * contact at a time. Nothing here samples a scoreline directly: a set score of
 * 25-23 is what is left over after fifty-odd independent rallies, each of which
 * ran serve -> reception -> set -> attack -> block -> dig -> transition until
 * the ball hit the floor.
 *
 * That matters because it is what makes the management layer meaningful. A
 * middle blocker with a poor reach is not punished by a fudge factor applied to
 * their team's strength rating; they are punished because they are genuinely
 * late to the quick in rotations 2 and 5, and the box score at the end of the
 * night shows exactly that.
 *
 * Calibration targets, checked by `npm run vm validate`, are elite men's
 * indoor volleyball: side-out 62-68%, attack efficiency .250-.350, kill rate
 * 45-52%, reception positivity 60-70%, ace rate 5-8% of serves, serve errors
 * 10-16%, and roughly a fifth of matches going to five sets.
 */

import { Rng } from '../core/rng.ts';
import { selectionScore } from '../model/ability.ts';
import type { PlayerStore } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import {
  BACK_ROW_ZONES,
  effectivePlayerAt,
  receptionUnit,
  rotate,
  rotationOf,
} from './court.ts';
import { matchRating } from './playerRating.ts';
import { computeRatings, contest, type PlayerMatchRatings } from './ratings.ts';
import {
  AttackLane,
  BlockAssignment,
  DEFENSE_PROFILE,
  LANE_NAMES,
  OFFENSE_LANE_WEIGHTS,
  SERVE_PROFILE,
  ServeTarget,
  TEMPO_PROFILE,
  Formation,
  formationOf,
  type TeamTactics,
} from './tactics.ts';
import {
  newTeamStats,
  statsFor,
  type TeamMatchStats,
} from './stats.ts';

export enum MatchFormat {
  BestOf5 = 0,
  BestOf3 = 1,
  GoldenSet = 2,
}

export interface TeamSetup {
  clubId: number;
  name: string;
  /** Six starters in rotational order; index 0 starts in zone 1. */
  lineup: number[];
  /** Libero player index, or -1. With a second libero this is the reception
   *  libero: the one on court whenever the team is receiving serve. */
  libero: number;
  /**
   * Optional second libero, on court whenever the team is serving — the
   * defensive specialist. Teams that register two liberos swap them freely
   * between rallies, so one can be picked for passing and one for digging.
   * Omitted or -1: the one libero plays throughout.
   */
  defensiveLibero?: number;
  bench: number[];
  tactics: TeamTactics;
  /** Rotation the team starts each set in, 0-5. */
  startingRotation?: number;
  /**
   * How well the opposition has this side's tactic worked out, 0-1 — see
   * tacticRead.ts. A side that is read gets served where it hurts, blocked
   * where it attacks and dug where it hits. Absent: not at all.
   */
  read?: number;
}

export interface MatchSetup {
  home: TeamSetup;
  away: TeamSetup;
  format: MatchFormat;
  /** 0-1. Scales pressure: a dead rubber vs an Olympic final. */
  importance: number;
  neutralVenue: boolean;
  /** Set true to record a full point-by-point log. Costs memory; off for background sim. */
  collectLog: boolean;
  seed: number;
  /**
   * Sides whose bench the engine runs itself, [home, away]: changes during a
   * set and a new six at each set break, by the same judgement the AI coach
   * uses live. For matches nobody is watching — an instant result, or the
   * rest of a match skipped to the end. Off unless asked for.
   */
  autoCoach?: readonly [boolean, boolean];
  /** A friendly: played in full, but nothing of it goes on anyone's career record. */
  friendly?: boolean;
}

export interface RallyContact {
  kind:
    | 'serve' | 'ace' | 'serveError'
    | 'reception' | 'receptionError'
    | 'set' | 'setError'
    | 'attack' | 'kill' | 'attackError' | 'blocked'
    | 'blockTouch' | 'dig' | 'digError' | 'freeball';
  team: 0 | 1;
  player: number;
  /** Lane for attacks, reception grade for passes. */
  detail?: string;
  /** How good a pass or dig was, 0 to 1. */
  quality?: number;
}

export interface RallyLogEntry {
  set: number;
  scoreBefore: [number, number];
  serveTeam: 0 | 1;
  winner: 0 | 1;
  homeRotation: number;
  awayRotation: number;
  contacts: RallyContact[];
  /** Home team's win probability after this rally. */
  homeWinProb: number;
}

export interface MatchResult {
  homeSets: number;
  awaySets: number;
  setScores: Array<[number, number]>;
  stats: { home: TeamMatchStats; away: TeamMatchStats };
  log: RallyLogEntry[] | null;
  totalRallies: number;
  /** Match MVP: highest scoring impact. Player index, or -1. */
  mvp: number;
}

/** Why a coach made a change: a tired player, a bad night, or simply a better option. */
export type SubstitutionReason = 'fatigue' | 'form' | 'upgrade';

export interface SubstitutionPlan {
  outPlayerIdx: number;
  inPlayerIdx: number;
  reason: SubstitutionReason;
}

/** Reception grades, as they appear on a scoresheet. */
const enum Grade {
  Error = 0,
  Poor = 1,
  Positive = 2,
  Perfect = 3,
}

const GRADE_SYMBOL = ['/', '-', '+', '#'];

/**
 * Two scale-alignment constants, both fixed by `npm run vm calibrate`.
 *
 * Attack, reception and defence ratings are each built from a different blend
 * of attributes, and attack additionally carries a spike-reach bonus that
 * defence has no counterpart to. That makes their numeric zeros incomparable,
 * so a contest between them needs an explicit offset before the logistic curve
 * means anything. These are those offsets — not gameplay thumbs on the scale.
 *
 * SERVE_EDGE reflects that a professional serve is harder to handle than the
 * receiver's raw rating alone implies. ATTACK_DEFENCE_BALANCE is negative
 * because the attack scale sits roughly eight points above the defence scale
 * for equivalently skilled players.
 */
const SERVE_EDGE = 5;
const ATTACK_DEFENCE_BALANCE = -8;

/**
 * How a coach judges a substitution — see `suggestSubstitution()`. The margin
 * is the fraction by which the replacement's current value (selection score x
 * live condition x form) must beat the player coming off.
 */
const SUB_MARGIN = 0.04;
const SUB_MARGIN_PER_SUB_USED = 0.02;
/** Trailing by four or more lowers the bar by this much; leading raises it. */
const SUB_MARGIN_SCORE_SHIFT = 0.03;
/** Extra margin to undo a swap already made this set, so a coach doesn't flip-flop. */
const SUB_MARGIN_REVERSAL = 0.08;
/**
 * In a 4-2, the bar moves this much for an opposite to take a setter's place
 * — up, since it changes the system — and for a setter to take it back, down.
 * See `crossShift()`.
 */
const SYSTEM_CHANGE_MARGIN = 0.05;
/**
 * The same judgement for the six handed in at a set break — a lower bar than
 * a substitution, since it costs none, shifted up after a set won and down
 * after one lost.
 */
const LINEUP_MARGIN = 0.03;
const LINEUP_MARGIN_SCORE_SHIFT = 0.02;
/** Live condition at or below which a player is visibly tiring. */
const TIRED_FATIGUE = 0.94;
/** Rallies on court before a match rating says anything about form. */
const FORM_MIN_RALLIES = 30;
/** Match rating below which a player counts as having a bad night... */
const FORM_FLOOR = 5.5;
/** ...and how much of their value each rating point under it costs them. */
const FORM_PENALTY = 0.1;

/**
 * What reading a side's tactic completely is worth to the side facing it: its
 * serve, block and floor defence against that side, each this much stronger.
 * Together enough to turn an even match into one the reader wins about two
 * times in three — engine.test.ts pins it.
 */
const READ_SERVE = 0.04;
const READ_BLOCK = 0.06;
const READ_DIG = 0.06;

/** Rallies an engine-coached side lets a change settle before making another. */
const AUTO_SUB_COOLDOWN_RALLIES = 4;

/** A pass or dig this far off the net (quality below it) may be too far for the setter… */
const BAD_BALL = 0.22;
/** …and this often the libero goes for it instead. */
const BAD_BALL_LIBERO = 0.55;

/**
 * Upsets. A side's level on the night is not its ability alone: some nights
 * everything comes off and some nights nothing does, and a set can turn on a
 * bad patch. Each side draws a form for the match and a swing for every set,
 * both multipliers on its players' confidence, and the weaker side plays with
 * nothing to lose. Big enough that a lesser team can beat a better one on its
 * night; never so big that ability stops deciding most matches. The curve —
 * how often the favourite wins at each gap — is pinned by engine.test.ts, and
 * the background quick sim gives the same one.
 */
const DAY_FORM_SD = 0.035;
const SET_FORM_SD = 0.055;
/** The underdog's lift per 100 of squad-strength gap, and its ceiling. */
const UNDERDOG_LIFT = 0.042;
const UNDERDOG_LIFT_MAX = 0.2;
/** The home crowd's lift, and the away trip's cost. */
const HOME_EDGE = 1.01;
const AWAY_EDGE = 0.999;

/** Per-team mutable state for the duration of one match. */
class TeamRuntime {
  court = new Int32Array(6);
  readonly ratings = new Map<number, PlayerMatchRatings>();
  readonly stats: TeamMatchStats = newTeamStats();
  setterIdx = -1;
  /** The libero on court for the rally being played — one of the two below. */
  liberoIdx = -1;
  receptionLibero = -1;
  defensiveLibero = -1;
  score = 0;
  setsWon = 0;
  momentum = 0;
  currentRun = 0;
  /**
   * How the side is playing tonight, each a multiplier on every player's
   * confidence: the venue (home crowd or away trip), the night's form, and
   * the swing of the set under way — see `DAY_FORM_SD`.
   */
  venue = 1;
  dayForm = 1;
  setForm = 1;

  /** All three together. */
  get edge(): number {
    return this.venue * this.dayForm * this.setForm;
  }
  /** The six who start each set, in rotational order — the coach may hand in a new sheet between sets. */
  startLineup: number[];
  /** How well the opposition reads this side's tactic, 0-1. */
  readonly read: number;
  private readonly startRotation: number;
  private readonly positions: Uint8Array;

  constructor(
    readonly setup: TeamSetup,
    store: PlayerStore,
  ) {
    this.positions = store.position;
    this.startLineup = setup.lineup.slice();
    this.read = Math.min(1, Math.max(0, setup.read ?? 0));
    this.startRotation = setup.startingRotation ?? 0;
    this.liberoIdx = setup.libero;
    this.receptionLibero = setup.libero;
    this.defensiveLibero = setup.defensiveLibero ?? -1;

    // Ratings for everyone who might take the floor.
    const all = [...setup.lineup, ...setup.bench];
    if (setup.libero >= 0) all.push(setup.libero);
    if (this.defensiveLibero >= 0) all.push(this.defensiveLibero);
    for (const p of all) {
      if (p < 0) continue;
      const role = store.position[p] as Position;
      this.ratings.set(p, computeRatings(store, p, role));
    }

    this.resetForSet();
  }

  get tactics(): TeamTactics {
    return this.setup.tactics;
  }

  resetForSet(): void {
    for (let i = 0; i < 6; i++) this.court[i] = this.startLineup[i];
    for (let r = 0; r < this.startRotation; r++) rotate(this.court);
    // Picked afresh every set: last set's setter may have been substituted,
    // or left out of this set's six altogether. In a 4-2 it is the first of
    // the two — the one the rotations are named for.
    this.setterIdx = -1;
    const fourTwo = formationOf(this.setup.tactics) === Formation.FourTwo;
    for (const p of this.startLineup) {
      if (this.positions[p] !== Position.Setter) continue;
      if (!fourTwo || this.setterIdx < 0) this.setterIdx = p;
    }
    if (this.setterIdx < 0) this.setterIdx = this.startLineup[0];
    this.score = 0;
    this.momentum = 0;
    this.currentRun = 0;
  }

  rate(playerIdx: number): PlayerMatchRatings {
    return this.ratings.get(playerIdx)!;
  }

  rotation(): number {
    return rotationOf(this.court, this.setterIdx);
  }

  /** True when the team plays a 4-2. */
  get fourTwo(): boolean {
    return formationOf(this.setup.tactics) === Formation.FourTwo;
  }

  /**
   * Who sets this rally. In a 5-1, the setter. In a 4-2, whichever setter is
   * in the back row — he comes up to the net to set, and the one already at
   * the net attacks on the right, as an opposite would.
   */
  settingIdx(): number {
    if (!this.fourTwo) return this.setterIdx;
    for (const z of BACK_ROW_ZONES) {
      if (this.positions[this.court[z]] === Position.Setter) return this.court[z];
    }
    return this.setterIdx;
  }
}

export class MatchSimulator {
  private readonly rng: Rng;
  private readonly teams: [TeamRuntime, TeamRuntime];
  private readonly log: RallyLogEntry[] | null;
  private readonly setScores: Array<[number, number]> = [];
  private contacts: RallyContact[] = [];
  private totalRallies = 0;
  private currentSet = 0;
  /** Scratch buffers, reused every rally to keep the loop allocation-free. */
  private readonly recvUnit = [0, 0, 0];
  private readonly laneWeights = new Float64Array(6);
  private readonly laneAttacker = new Int32Array(6);

  // ---- Stepped match state --------------------------------------------------
  // The match plays one rally per step() call rather than end-to-end in one
  // shot, so a live viewer can pace calls over time and substitute a player
  // between any two rallies — exactly where real volleyball allows a sub.
  private started = false;
  private matchOver = false;
  private serving: 0 | 1 = 0;
  private setTarget = 25;
  private setsToWin = 3;
  private maxSets = 5;
  /** Substitutions used this set, per team. Resets each set. */
  private readonly subsUsedThisSet: [number, number] = [0, 0];
  /**
   * Once a starter is replaced by a bench player, that pair is locked for the
   * rest of the set — the starter can only re-enter by swapping back in for
   * that same substitute, never a different one. Keyed by player id, both
   * directions, so a lookup works from whichever side is currently on court.
   * Resets each set.
   */
  private readonly subPairing: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  /** Sides whose bench the engine runs — see `MatchSetup.autoCoach`. */
  private readonly autoCoached: [boolean, boolean];
  /** The rally each engine-coached side last made a change on. */
  private readonly lastAutoSub: [number, number] = [-Infinity, -Infinity];

  constructor(
    private readonly store: PlayerStore,
    private readonly setup: MatchSetup,
  ) {
    this.rng = new Rng(setup.seed);
    this.teams = [new TeamRuntime(setup.home, store), new TeamRuntime(setup.away, store)];
    this.log = setup.collectLog ? [] : null;
    this.autoCoached = [setup.autoCoach?.[0] ?? false, setup.autoCoach?.[1] ?? false];

    // Home advantage: a real but modest effect, applied as a confidence bump to
    // the home side. Worth roughly 3-4 percentage points of match win rate.
    if (!setup.neutralVenue) {
      this.teams[0].venue = HOME_EDGE;
      this.teams[1].venue = AWAY_EDGE;
    }
  }

  /** Play the whole match synchronously and return the result. */
  run(): MatchResult {
    this.startIfNeeded();
    this.finish();
    return this.buildResult();
  }

  /** Play every remaining rally to completion. */
  finish(): void {
    while (!this.matchOver) this.step();
  }

  /**
   * Hand a side's bench to the engine from here on — or take it back. Handed
   * over at a set break, the engine picks the coming set's six too.
   */
  setAutoCoach(team: 0 | 1, on: boolean): void {
    this.autoCoached[team] = on;
    const atSetBreak = this.started && !this.matchOver && this.currentSet > 0 &&
      this.teams[0].score === 0 && this.teams[1].score === 0;
    if (on && atSetBreak) this.coachSetBreak(team);
  }

  /**
   * Play exactly one rally and return its log entry, or null if the match is
   * already over. This is the one place set/match transitions happen, so it
   * is also the natural point a live caller checks for a set/match boundary.
   */
  step(): RallyLogEntry | null {
    this.startIfNeeded();
    if (this.matchOver) return null;

    const serving = this.serving;
    const entry = this.playRally(serving);
    const winner = entry.winner;

    this.teams[winner].score++;
    this.teams[winner].currentRun++;
    this.teams[1 - winner].currentRun = 0;
    const run = this.teams[winner].currentRun;
    if (run > this.teams[winner].stats.longestRun) {
      this.teams[winner].stats.longestRun = run;
    }

    // Momentum decays toward zero and swings with runs. Bounded so it
    // colours performance without ever deciding a match on its own.
    this.teams[winner].momentum = Math.min(6, this.teams[winner].momentum * 0.82 + 1);
    this.teams[1 - winner].momentum = Math.max(-6, this.teams[1 - winner].momentum * 0.82 - 1);

    if (winner !== serving) {
      // Side-out: the receiving team wins the ball and rotates before serving.
      rotate(this.teams[winner].court);
      this.serving = winner;
    }

    const a = this.teams[0].score;
    const b = this.teams[1].score;
    const setOver =
      ((a >= this.setTarget || b >= this.setTarget) && Math.abs(a - b) >= 2) ||
      // Safety valve: a deuce cannot run forever in a simulation.
      a > this.setTarget + 25 || b > this.setTarget + 25;

    if (setOver) {
      const setWinner = a > b ? 0 : 1;
      this.teams[setWinner].setsWon++;
      this.setScores.push([a, b]);
      this.teams[0].stats.pointsByset.push(a);
      this.teams[1].stats.pointsByset.push(b);
      this.recoverBetweenSets();

      // Serve alternates by set.
      this.serving = (this.currentSet % 2 === 0 ? 1 : 0) as 0 | 1;
      this.currentSet++;

      if (
        this.teams[0].setsWon >= this.setsToWin ||
        this.teams[1].setsWon >= this.setsToWin ||
        this.currentSet >= this.maxSets
      ) {
        this.teams[0].stats.setsWon = this.teams[0].setsWon;
        this.teams[1].stats.setsWon = this.teams[1].setsWon;
        if (this.setup.friendly !== true) this.commitCareerTotals();
        this.matchOver = true;
      } else {
        this.beginSet();
        for (const t of [0, 1] as const) if (this.autoCoached[t]) this.coachSetBreak(t);
      }
    } else {
      for (const t of [0, 1] as const) if (this.autoCoached[t]) this.coachRally(t);
    }

    return entry;
  }

  /** An engine-coached side's change between rallies, if one is warranted and the last has settled. */
  private coachRally(team: 0 | 1): void {
    if (this.totalRallies - this.lastAutoSub[team] < AUTO_SUB_COOLDOWN_RALLIES) return;
    const plan = this.suggestSubstitution(team);
    if (plan !== null && this.substitute(team, plan.outPlayerIdx, plan.inPlayerIdx).ok) {
      this.lastAutoSub[team] = this.totalRallies;
    }
  }

  /** An engine-coached side's team sheet for the set about to start. */
  private coachSetBreak(team: 0 | 1): void {
    const plan = this.suggestStartingLineup(team);
    if (plan === null) return;
    const t = this.teams[team];
    this.setStartingLineup(team, plan.lineup, t.receptionLibero, t.defensiveLibero);
  }

  private startIfNeeded(): void {
    if (this.started) return;
    this.started = true;
    const format = this.setup.format;
    this.setsToWin = format === MatchFormat.BestOf5 ? 3 : format === MatchFormat.BestOf3 ? 2 : 1;
    this.maxSets = format === MatchFormat.BestOf5 ? 5 : format === MatchFormat.BestOf3 ? 3 : 1;
    // Coin toss for first serve.
    this.serving = this.rng.chance(0.5) ? 0 : 1;
    this.drawForm();
    this.beginSet();
  }

  /** Each side's form for the night — the weaker one lifted for having nothing to lose. */
  private drawForm(): void {
    const gap = sideStrength(this.store, this.teams[0]) - sideStrength(this.store, this.teams[1]);
    const lift = Math.min(UNDERDOG_LIFT_MAX, (Math.abs(gap) / 100) * UNDERDOG_LIFT);
    for (let t = 0; t < 2; t++) {
      const underdog = t === 0 ? gap < 0 : gap > 0;
      this.teams[t].dayForm = clamp(this.rng.gaussian(underdog ? 1 + lift : 1, DAY_FORM_SD), 0.82, 1.18);
    }
  }

  private beginSet(): void {
    this.teams[0].resetForSet();
    this.teams[1].resetForSet();
    for (const t of this.teams) t.setForm = clamp(this.rng.gaussian(1, SET_FORM_SD), 0.85, 1.15);
    const format = this.setup.format;
    const isDecider =
      (format === MatchFormat.BestOf5 && this.currentSet === 4) ||
      (format === MatchFormat.BestOf3 && this.currentSet === 2) ||
      format === MatchFormat.GoldenSet;
    this.setTarget = isDecider ? 15 : 25;
    this.subsUsedThisSet[0] = 0;
    this.subsUsedThisSet[1] = 0;
    this.subPairing[0].clear();
    this.subPairing[1].clear();
  }

  buildResult(): MatchResult {
    return {
      homeSets: this.teams[0].setsWon,
      awaySets: this.teams[1].setsWon,
      setScores: this.setScores,
      stats: { home: this.teams[0].stats, away: this.teams[1].stats },
      log: this.log,
      totalRallies: this.totalRallies,
      mvp: this.findMvp(),
    };
  }

  /**
   * Bring a bench player on for one currently on court, if the rules allow
   * it — the substitute must be part of the matchday squad, the outgoing
   * player must actually be on court, each side gets five substitutions per
   * set, and once a pair has swapped, only that pair may swap again (a
   * starter who comes off can only return for the player who replaced them,
   * never a different bench player). No libero re-entry rules are modelled.
   */
  substitute(
    team: 0 | 1,
    outPlayerIdx: number,
    inPlayerIdx: number,
  ): { ok: boolean; reason?: string } {
    const error = this.substitutionError(team, outPlayerIdx, inPlayerIdx);
    if (error !== null) return { ok: false, reason: error };

    const t = this.teams[team];
    const zone = t.court.indexOf(outPlayerIdx);
    const pairing = this.subPairing[team];
    const requiredPartner = pairing.get(outPlayerIdx);
    t.court[zone] = inPlayerIdx;
    if (t.setterIdx === outPlayerIdx) {
      // A setter off for someone who isn't one: in a 4-2 the other setter
      // runs the offence from here — failing one, whoever came on has to.
      const pos = this.store.position;
      t.setterIdx = pos[inPlayerIdx] === Position.Setter
        ? inPlayerIdx
        : Array.from(t.court).find((p) => pos[p] === Position.Setter) ?? inPlayerIdx;
    }
    this.subsUsedThisSet[team]++;
    if (requiredPartner === undefined) {
      pairing.set(outPlayerIdx, inPlayerIdx);
      pairing.set(inPlayerIdx, outPlayerIdx);
    }
    return { ok: true };
  }

  /** Why substitute() would refuse this swap, or null if it is legal. */
  private substitutionError(team: 0 | 1, outPlayerIdx: number, inPlayerIdx: number): string | null {
    const t = this.teams[team];
    if (!t.court.includes(outPlayerIdx)) return 'That player is not on court.';
    if (!t.ratings.has(inPlayerIdx)) return 'That player is not part of the squad.';
    if (t.court.includes(inPlayerIdx)) return 'That player is already on court.';
    if (this.subsUsedThisSet[team] >= 5) return 'No substitutions left this set.';

    const pairing = this.subPairing[team];
    const requiredPartner = pairing.get(outPlayerIdx);
    if (requiredPartner !== undefined && requiredPartner !== inPlayerIdx) {
      return 'That player can only be replaced by whoever substituted for them.';
    }
    const inPartner = pairing.get(inPlayerIdx);
    if (inPartner !== undefined && inPartner !== outPlayerIdx) {
      return 'That player can only come back on for the player they swapped with.';
    }
    return null;
  }

  subsRemaining(team: 0 | 1): number {
    return 5 - this.subsUsedThisSet[team];
  }

  /**
   * The change a coach would make right now, or null if the six on court are
   * still the best available. Drives the AI side of a live match.
   *
   * A swap has to be warranted, not merely possible: the replacement must play
   * the same position — or, in a 4-2, be an opposite for a setter who has to
   * come off (see `crossShift()`) — and be clearly more effective *at this
   * moment*: a fresh reserve against a starter who is running on empty, or
   * anyone against a starter who is having a nightmare. The margin required
   * grows as the set's five substitutions get used up and while the set is
   * going well, and shrinks when it is slipping away.
   */
  suggestSubstitution(team: 0 | 1): SubstitutionPlan | null {
    this.startIfNeeded();
    if (this.matchOver || this.subsUsedThisSet[team] >= 5) return null;
    const t = this.teams[team];
    const lead = t.score - this.teams[1 - team].score;
    let margin = SUB_MARGIN + this.subsUsedThisSet[team] * SUB_MARGIN_PER_SUB_USED;
    if (lead <= -4) margin -= SUB_MARGIN_SCORE_SHIFT;
    else if (lead >= 4) margin += SUB_MARGIN_SCORE_SHIFT;

    const pairing = this.subPairing[team];
    let best: SubstitutionPlan | null = null;
    let bestExcess = 0;
    for (const out of t.court) {
      const outValue = this.currentValue(team, out);
      for (const inc of t.ratings.keys()) {
        const shift = this.crossShift(team, out, inc, t.court);
        if (shift === null) continue;
        if (this.substitutionError(team, out, inc) !== null) continue;
        const needed = margin + shift + (pairing.get(out) === inc ? SUB_MARGIN_REVERSAL : 0);
        const excess = this.currentValue(team, inc) / Math.max(1, outValue) - 1 - needed;
        if (excess <= bestExcess) continue;
        bestExcess = excess;
        best = { outPlayerIdx: out, inPlayerIdx: inc, reason: this.reasonToReplace(team, out) };
      }
    }
    return best;
  }

  /**
   * The six a coach would hand in for the coming set, with the changes from
   * the last set's, or null to keep them. The same judgement as
   * suggestSubstitution() — like for like (in a 4-2, an opposite for a setter
   * too), a starter who is tiring or having a bad night makes way for someone
   * who would do better right now — but a
   * new line-up sheet costs no substitution, so the bar is lower; it is
   * higher after a set won (nobody changes a winning team) and lower after
   * one lost. Only meaningful at a set break, before the first serve.
   */
  suggestStartingLineup(team: 0 | 1): { lineup: number[]; changes: SubstitutionPlan[] } | null {
    this.startIfNeeded();
    const t = this.teams[team];
    if (this.matchOver || t.score !== 0 || this.teams[1 - team].score !== 0) return null;
    let margin = LINEUP_MARGIN;
    const last = this.setScores[this.setScores.length - 1];
    if (last !== undefined) {
      const wonIt = team === 0 ? last[0] > last[1] : last[1] > last[0];
      margin += wonIt ? LINEUP_MARGIN_SCORE_SHIFT : -LINEUP_MARGIN_SCORE_SHIFT;
    }

    const lineup = t.startLineup.slice();
    const changes: SubstitutionPlan[] = [];
    for (let slot = 0; slot < lineup.length; slot++) {
      const starter = lineup[slot];
      const starterValue = Math.max(1, this.currentValue(team, starter));
      let pick = -1;
      let pickExcess = 0;
      for (const p of t.ratings.keys()) {
        if (lineup.includes(p) || p === t.receptionLibero || p === t.defensiveLibero) continue;
        const shift = this.crossShift(team, starter, p, lineup);
        if (shift === null) continue;
        const excess = this.currentValue(team, p) / starterValue - 1 - margin - shift;
        if (excess > pickExcess) { pick = p; pickExcess = excess; }
      }
      if (pick === -1) continue;
      lineup[slot] = pick;
      changes.push({ outPlayerIdx: starter, inPlayerIdx: pick, reason: this.reasonToReplace(team, starter) });
    }
    return changes.length > 0 ? { lineup, changes } : null;
  }

  /**
   * How far a coach's bar moves for `inc` taking `out`'s place in `six`, or
   * null if he wouldn't consider it. Like for like, not at all. Across
   * positions only in a 4-2, and only for a setter: an opposite on for one
   * who has to come off — tired, or having a bad night, not merely bettered —
   * so long as the other setter stays on to set (the side plays on as a 5-1);
   * and a setter back on for that opposite, restoring the 4-2.
   */
  private crossShift(team: 0 | 1, out: number, inc: number, six: ArrayLike<number>): number | null {
    const pos = this.store.position;
    if (pos[inc] === pos[out]) return 0;
    if (!this.teams[team].fourTwo) return null;
    let setters = 0;
    for (let i = 0; i < six.length; i++) if (pos[six[i]] === Position.Setter) setters++;
    if (pos[out] === Position.Setter && pos[inc] === Position.Opposite) {
      return setters >= 2 && this.reasonToReplace(team, out) !== 'upgrade' ? SYSTEM_CHANGE_MARGIN : null;
    }
    if (pos[out] === Position.Opposite && pos[inc] === Position.Setter && setters < 2) return -SYSTEM_CHANGE_MARGIN;
    return null;
  }

  /** What a player is worth on court right now, as a coach sees it. */
  private currentValue(team: 0 | 1, playerIdx: number): number {
    const fit = this.fitness(team, playerIdx);
    return selectionScore(this.store, playerIdx) * fit.fatigue * fit.form;
  }

  /** Why a coach would take this player off: tiredness, a bad night, or simply someone better. */
  private reasonToReplace(team: 0 | 1, playerIdx: number): SubstitutionReason {
    const fit = this.fitness(team, playerIdx);
    const tiredness = 1 - fit.fatigue;
    const slump = 1 - fit.form;
    return tiredness > 0 && tiredness >= slump ? 'fatigue' : slump > 0 ? 'form' : 'upgrade';
  }

  /**
   * How much of their ability a player can bring to the court right now:
   * `fatigue` is their live condition once they are visibly tiring (a little
   * wear early on worries no coach), `form` a discount for a bad night on the
   * scoresheet — applied only once there are enough rallies to judge.
   */
  private fitness(team: 0 | 1, playerIdx: number): { fatigue: number; form: number } {
    const t = this.teams[team];
    const condition = t.rate(playerIdx).fatigue;
    const fatigue = condition <= TIRED_FATIGUE ? condition : 1;
    const s = t.stats.players.get(playerIdx);
    if (s === undefined || s.ralliesPlayed < FORM_MIN_RALLIES) return { fatigue, form: 1 };
    const rating = matchRating(
      s, this.store.position[playerIdx] as Position, t.setsWon, this.teams[1 - team].setsWon,
    );
    const form = rating >= FORM_FLOOR ? 1 : Math.max(0.6, 1 - (FORM_FLOOR - rating) * FORM_PENALTY);
    return { fatigue, form };
  }

  /**
   * The libero who takes the court for the next rally: the reception libero
   * while the team is receiving serve, the defensive libero (if one is
   * registered) while it is serving.
   */
  private activeLibero(team: 0 | 1): number {
    const t = this.teams[team];
    return team === this.serving && t.defensiveLibero >= 0 ? t.defensiveLibero : t.receptionLibero;
  }

  /** Both of a team's libero roles. `defence` is -1 when only one libero is used. */
  liberos(team: 0 | 1): { reception: number; defence: number } {
    const t = this.teams[team];
    return { reception: t.receptionLibero, defence: t.defensiveLibero };
  }

  /**
   * Change who plays libero, between rallies. Libero replacements are
   * unlimited and never count against the substitution allowance, but only a
   * registered libero from the matchday squad may take the role. Naming the
   * player who currently holds the other role swaps the two roles over;
   * passing -1 for the defensive role goes back to a single libero.
   */
  setLibero(
    team: 0 | 1,
    role: 'reception' | 'defence',
    playerIdx: number,
  ): { ok: boolean; reason?: string } {
    const t = this.teams[team];
    if (role === 'defence' && playerIdx === -1) {
      t.defensiveLibero = -1;
      return { ok: true };
    }
    if (!t.ratings.has(playerIdx)) return { ok: false, reason: 'That player is not part of the squad.' };
    if (this.store.position[playerIdx] !== Position.Libero) {
      return { ok: false, reason: 'Only a registered libero can play libero.' };
    }
    if (t.court.includes(playerIdx)) return { ok: false, reason: 'That player is already on court.' };

    if (role === 'reception') {
      if (playerIdx === t.defensiveLibero) t.defensiveLibero = t.receptionLibero;
      t.receptionLibero = playerIdx;
    } else {
      if (playerIdx === t.receptionLibero) {
        if (t.defensiveLibero < 0) return { ok: false, reason: 'Name another libero for reception first.' };
        t.receptionLibero = t.defensiveLibero;
      }
      t.defensiveLibero = playerIdx;
    }
    return { ok: true };
  }

  /** The six a team starts the current set with, in rotational order (index 0 in zone 1). */
  startingLineup(team: 0 | 1): number[] {
    return this.teams[team].startLineup.slice();
  }

  /**
   * Hand in the line-up sheet for the coming set: the six who start it, in
   * rotational order, and the libero(s). Allowed only before the set's first
   * serve. Anyone from the matchday squad may start, and it is not a
   * substitution — the set's five are all still to come. The new six also
   * start every later set until another sheet replaces it.
   */
  setStartingLineup(
    team: 0 | 1,
    lineup: readonly number[],
    libero: number,
    defensiveLibero = -1,
  ): { ok: boolean; reason?: string } {
    this.startIfNeeded();
    const t = this.teams[team];
    if (this.matchOver) return { ok: false, reason: 'The match is over.' };
    if (t.score !== 0 || this.teams[1 - team].score !== 0) {
      return { ok: false, reason: 'The set is already under way.' };
    }
    if (lineup.length !== 6 || new Set(lineup).size !== 6) {
      return { ok: false, reason: 'Pick six different players to start the set.' };
    }
    if (lineup.some((p) => !t.ratings.has(p))) return { ok: false, reason: 'That player is not part of the squad.' };
    for (const l of [libero, defensiveLibero]) {
      if (l < 0) continue;
      if (!t.ratings.has(l)) return { ok: false, reason: 'That player is not part of the squad.' };
      if (this.store.position[l] !== Position.Libero) return { ok: false, reason: 'Only a registered libero can play libero.' };
      if (lineup.includes(l)) return { ok: false, reason: 'A libero cannot also start in the six.' };
    }
    if (defensiveLibero >= 0 && (libero < 0 || defensiveLibero === libero)) {
      return { ok: false, reason: 'Name a different libero for reception first.' };
    }

    t.startLineup = lineup.slice();
    t.receptionLibero = libero;
    t.defensiveLibero = defensiveLibero;
    t.resetForSet();
    this.subsUsedThisSet[team] = 0;
    this.subPairing[team].clear();
    return { ok: true };
  }

  /** Running box-score state for a live viewer, e.g. to rate players mid-match. */
  liveStats(): { home: TeamMatchStats; away: TeamMatchStats; homeSets: number; awaySets: number } {
    return {
      home: this.teams[0].stats,
      away: this.teams[1].stats,
      homeSets: this.teams[0].setsWon,
      awaySets: this.teams[1].setsWon,
    };
  }

  /** The matchday squad's bench for this team — not currently on court. */
  benchFor(team: 0 | 1): number[] {
    const t = this.teams[team];
    return t.setup.bench.filter((p) => !t.court.includes(p));
  }

  /**
   * Read-only snapshot for a live viewer to render after each step(). The
   * libero fields name whoever takes the court for the *next* rally, which is
   * what the viewer is about to animate. Taking the first snapshot also makes
   * the coin toss, so it already knows who serves first — the random draws
   * happen in exactly the same order either way.
   */
  snapshot(): {
    homeCourt: number[];
    awayCourt: number[];
    homeLibero: number;
    awayLibero: number;
    homeScore: number;
    awayScore: number;
    homeSets: number;
    awaySets: number;
    set: number;
    serving: 0 | 1;
    matchOver: boolean;
  } {
    this.startIfNeeded();
    return {
      homeCourt: Array.from(this.teams[0].court),
      awayCourt: Array.from(this.teams[1].court),
      homeLibero: this.activeLibero(0),
      awayLibero: this.activeLibero(1),
      homeScore: this.teams[0].score,
      awayScore: this.teams[1].score,
      homeSets: this.teams[0].setsWon,
      awaySets: this.teams[1].setsWon,
      set: this.currentSet,
      serving: this.serving,
      matchOver: this.matchOver,
    };
  }

  // ---- Rally --------------------------------------------------------------

  private playRally(serving: 0 | 1): RallyLogEntry {
    const receiving = (1 - serving) as 0 | 1;
    const srv = this.teams[serving];
    const rcv = this.teams[receiving];

    this.contacts = [];
    // Two-libero teams send the reception specialist on to pass and the
    // defensive one on to dig; with a single libero both calls return it.
    srv.liberoIdx = this.activeLibero(serving);
    rcv.liberoIdx = this.activeLibero(receiving);
    const scoreBefore: [number, number] = [this.teams[0].score, this.teams[1].score];
    const srvRot = srv.rotation();
    const rcvRot = rcv.rotation();

    // Rotation bookkeeping, so the rotation screen can show where points leak.
    srv.stats.rotations[srvRot].serveRallies++;
    rcv.stats.rotations[rcvRot].receiveRallies++;

    this.applyPressure();

    const winner = this.resolveRally(serving);

    if (winner === serving) srv.stats.rotations[srvRot].servePointsWon++;
    else rcv.stats.rotations[rcvRot].sideOutsWon++;

    this.totalRallies++;
    // Logged sets aren't extra work: every attack already implies one.
    let touches = 0;
    for (const c of this.contacts) if (c.kind !== 'set') touches++;
    this.applyFatigue(touches || 4);

    const entry: RallyLogEntry = {
      set: this.currentSet,
      scoreBefore,
      serveTeam: serving,
      winner,
      homeRotation: this.teams[0].rotation(),
      awayRotation: this.teams[1].rotation(),
      contacts: this.contacts,
      homeWinProb: this.estimateWinProbability(),
    };
    if (this.log) this.log.push(entry);
    return entry;
  }

  /** Runs one rally from the serve to the moment the ball is dead. */
  private resolveRally(serving: 0 | 1): 0 | 1 {
    const srv = this.teams[serving];
    const rcv = this.teams[1 - serving];
    const rng = this.rng;

    // ---- Serve ----
    const server = srv.court[0];
    const sr = srv.rate(server);
    const sStats = statsFor(srv.stats, server);
    sStats.servesTotal++;

    const profile = SERVE_PROFILE[srv.tactics.serve];
    const defProfile = DEFENSE_PROFILE[srv.tactics.defense];

    // Jump serves are more dangerous but less reliable; the engine picks
    // whichever weapon the player is actually better at.
    const jump = sr.serveJump > sr.serveFloat;
    const rawPower = (jump ? sr.serveJump : sr.serveFloat) * (jump ? 1.06 : 0.97);
    const serveStrength =
      rawPower * profile.power * defProfile.servePressure * sr.fatigue * sr.confidence;
    const serveAccuracy = sr.serveAccuracy * profile.accuracy;

    const errorProb = clamp(
      0.20 - 0.0018 * serveAccuracy + 0.0012 * (serveStrength - 50) + (jump ? 0.022 : -0.012),
      0.015,
      0.34,
    );
    if (rng.chance(errorProb)) {
      sStats.serveErrors++;
      rcv.stats.opponentErrors++;
      this.push({ kind: 'serveError', team: serving, player: server });
      return (1 - serving) as 0 | 1;
    }
    this.push({ kind: 'serve', team: serving, player: server, detail: jump ? 'jump' : 'float' });

    // ---- Reception ----
    const receiver = this.pickReceiver(rcv, srv.tactics, srvRotTactics(srv));
    const rr = rcv.rate(receiver);
    const rStats = statsFor(rcv.stats, receiver);
    rStats.receptionsTotal++;

    const recvSkill =
      rr.reception * rr.fatigue * rr.confidence * DEFENSE_PROFILE[rcv.tactics.defense].receptionBonus;
    // SERVE_EDGE is the inherent difficulty of handling a professional serve,
    // independent of who is hitting it. The wide contest scale keeps a single
    // serve/reception mismatch from swinging the pass grade to an extreme —
    // without it the grade distribution develops fat tails and the same match
    // produces both too many perfect passes and too many aces.
    // A side whose patterns are known is served where it hurts — no harder,
    // so no likelier to go long, just aimed better.
    const pressure = contest(serveStrength * (1 + READ_SERVE * rcv.read) + SERVE_EDGE, recvSkill, 26);

    // Ace chance rises sharply with serve pressure but never becomes routine.
    // The high exponent means only a genuinely dominant serve aces; ordinary
    // pressure produces a bad pass, which is a different and lesser reward.
    const aceProb = 0.012 + 0.07 * Math.pow(pressure, 2.6);
    if (rng.chance(aceProb)) {
      sStats.serveAces++;
      rStats.receptionErrors++;
      this.push({ kind: 'ace', team: serving, player: server });
      return serving;
    }

    const q = clamp(rng.gaussian(1 - pressure, 0.18), 0, 1);
    const grade = gradeOf(q);
    if (grade === Grade.Error) {
      sStats.serveAces++;
      rStats.receptionErrors++;
      this.push({ kind: 'receptionError', team: (1 - serving) as 0 | 1, player: receiver });
      return serving;
    }
    if (grade === Grade.Perfect) rStats.receptionPerfect++;
    else if (grade === Grade.Positive) rStats.receptionPositive++;
    else rStats.receptionPoor++;

    this.push({
      kind: 'reception',
      team: (1 - serving) as 0 | 1,
      player: receiver,
      detail: GRADE_SYMBOL[grade],
      quality: q,
    });

    // ---- Offense / transition loop ----
    let attacking = (1 - serving) as 0 | 1;
    let quality = q;
    // Widened deliberately: `grade` is narrowed to the non-error grades above,
    // but transition balls reassign this from the full range.
    let grd: Grade = grade;
    let transition = false;
    // Who played the ball first — the passer, then each digger — since he can't play it twice.
    let firstTouch = receiver;

    for (let contact = 0; contact < 24; contact++) {
      const outcome = this.resolveOffense(attacking, quality, grd, transition, firstTouch);
      if (outcome.point !== -1) return outcome.point as 0 | 1;
      // Ball was dug; the other side now attacks off a transition ball.
      attacking = (1 - attacking) as 0 | 1;
      quality = outcome.nextQuality;
      grd = gradeOf(quality);
      transition = true;
      firstTouch = outcome.toucher;
    }
    // Absurdly long rally: award to whoever is fresher.
    return this.freshestTeam();
  }

  /**
   * One offensive sequence: set, attack selection, block, dig.
   * Returns the winning team, or -1 with a transition ball quality.
   */
  private resolveOffense(
    attacking: 0 | 1,
    quality: number,
    grade: Grade,
    transition: boolean,
    firstTouch: number,
  ): { point: number; nextQuality: number; toucher: number } {
    const atk = this.teams[attacking];
    const def = this.teams[1 - attacking];
    const rng = this.rng;
    const rotTac = atk.tactics.rotations[atk.rotation()];
    const tempo = TEMPO_PROFILE[atk.tactics.tempo];

    // ---- Setting ----
    const setter = this.secondTouch(atk, firstTouch, quality);
    const setRatings = atk.rate(setter);
    const setterStats = statsFor(atk.stats, setter);

    // A setter's job is to convert whatever pass they get into a hittable ball.
    // Good setters lose less off a poor pass, which is precisely their value.
    const setSkill = setRatings.setting * setRatings.fatigue * setRatings.confidence;
    const setQuality = clamp(
      quality * 0.55 + (setSkill / 100) * 0.45 + rng.gaussian(0, 0.07) - (transition ? 0.06 : 0),
      0,
      1,
    );

    const setErrorProb = clamp(0.012 - (setSkill - 55) * 0.00018 + (1 - quality) * 0.02, 0.002, 0.06);
    if (rng.chance(setErrorProb * tempo.executionDifficulty)) {
      setterStats.setErrors++;
      this.push({ kind: 'setError', team: attacking, player: setter });
      return { point: 1 - attacking, nextQuality: 0, toucher: -1 };
    }
    setterStats.setsMade++;
    this.push({ kind: 'set', team: attacking, player: setter });

    // ---- Attack lane selection ----
    const lane = this.chooseLane(atk, grade, rotTac, setQuality, setter);
    if (lane === -1) {
      // No attacker available: send a free ball over and concede the initiative.
      this.push({ kind: 'freeball', team: attacking, player: setter });
      return { point: -1, nextQuality: 0.86, toucher: -1 };
    }
    const attacker = this.laneAttacker[lane];
    const ar = atk.rate(attacker);
    const aStats = statsFor(atk.stats, attacker);
    aStats.attacksTotal++;

    // ---- Attack strength ----
    let attackBase: number;
    switch (lane) {
      case AttackLane.QuickMiddle:
        attackBase = ar.quickAttack;
        break;
      case AttackLane.Pipe:
        attackBase = ar.pipeAttack;
        break;
      case AttackLane.BackRowRight:
        attackBase = ar.backRowAttack;
        break;
      case AttackLane.SecondTempoOutside:
        attackBase = ar.attackPower * 0.45 + ar.attackControl * 0.55;
        break;
      default:
        attackBase = ar.attackPower * 0.62 + ar.attackControl * 0.38;
    }
    const attackRating =
      attackBase * ar.fatigue * ar.confidence * (0.82 + 0.28 * setQuality) +
      rng.gaussian(0, (1 - ar.consistency) * 9);

    // ---- Block ----
    const blockCount = this.blockersFor(lane, grade, def, rotTac, transition);
    // A block that knows the attack's patterns is there before the ball.
    const blockRating =
      this.blockStrength(def, lane, blockCount) * (1 - tempo.blockDelay) * def.edge * (1 + READ_BLOCK * atk.read);

    // ---- Dig ----
    const digRating =
      this.digStrength(def) * DEFENSE_PROFILE[def.tactics.defense].digCoverage * def.edge * (1 + READ_DIG * atk.read);

    // ---- Outcome ----
    // Blocked balls and attack errors are resolved first; whatever probability
    // is left over is split between a kill and a dug ball.
    const blockEdge = blockRating - attackRating;
    const pBlocked = clamp(0.03 + 0.09 * contest(blockEdge, 0, 16), 0.005, 0.30);

    const controlFactor = (ar.attackControl * ar.fatigue) / 100;
    const pError = clamp(
      (0.145 - controlFactor * 0.09) * tempo.executionDifficulty * (transition ? 1.12 : 1) +
        (1 - setQuality) * 0.05,
      0.02,
      0.30,
    );

    const remaining = Math.max(0.05, 1 - pBlocked - pError);
    const pKillGivenLive = contest(attackRating + ATTACK_DEFENCE_BALANCE, digRating, 16);
    const pKill = remaining * pKillGivenLive;

    const roll = rng.float();
    if (roll < pBlocked) {
      aStats.attackBlocked++;
      const blocker = this.pickBlocker(def, lane);
      statsFor(def.stats, blocker).blockPoints++;
      this.push({ kind: 'blocked', team: attacking, player: attacker, detail: LANE_NAMES[lane] });
      return { point: 1 - attacking, nextQuality: 0, toucher: -1 };
    }
    if (roll < pBlocked + pError) {
      aStats.attackErrors++;
      def.stats.opponentErrors++;
      this.push({ kind: 'attackError', team: attacking, player: attacker, detail: LANE_NAMES[lane] });
      return { point: 1 - attacking, nextQuality: 0, toucher: -1 };
    }
    if (roll < pBlocked + pError + pKill) {
      aStats.attackKills++;
      setterStats.setAssists++;
      this.push({ kind: 'kill', team: attacking, player: attacker, detail: LANE_NAMES[lane] });
      return { point: attacking, nextQuality: 0, toucher: -1 };
    }

    // ---- Dug: the rally continues ----
    this.push({ kind: 'attack', team: attacking, player: attacker, detail: LANE_NAMES[lane] });
    const digger = this.pickDigger(def);
    const dr = def.rate(digger);
    statsFor(def.stats, digger).digsTotal++;

    // A block touch slows the ball down and makes the dig cleaner.
    const touched = rng.chance(0.28);
    if (touched) {
      const blocker = this.pickBlocker(def, lane);
      statsFor(def.stats, blocker).blockTouches++;
      this.push({ kind: 'blockTouch', team: (1 - attacking) as 0 | 1, player: blocker });
    }
    // Transition balls are messier than serve reception, so the ceiling is lower.
    const digQuality = clamp(
      rng.gaussian(0.30 + (dr.dig / 100) * 0.34 + (touched ? 0.08 : 0), 0.17),
      0.05,
      0.95,
    );
    this.push({ kind: 'dig', team: (1 - attacking) as 0 | 1, player: digger, quality: digQuality });
    return { point: -1, nextQuality: digQuality, toucher: digger };
  }

  // ---- Selection helpers --------------------------------------------------

  /**
   * Who takes the second ball. The setter — unless he played the first one:
   * then, in a 4-2, the other setter; in a 5-1, the libero. And on a ball
   * passed or dug well off the net he may not get there at all: the libero
   * goes for it instead. Failing a libero on court, the right-side hitter or
   * whoever else is free.
   */
  private secondTouch(atk: TeamRuntime, firstTouch: number, quality: number): number {
    const setter = atk.settingIdx();
    const pos = this.store.position;
    const onCourt: number[] = [];
    for (let z = 0; z < 6; z++) onCourt.push(effectivePlayerAt(atk.court, z, pos, atk.liberoIdx));
    const free = (p: number): boolean => p >= 0 && p !== firstTouch && onCourt.includes(p);
    const libero = free(atk.liberoIdx) ? atk.liberoIdx : -1;

    if (setter === firstTouch) {
      if (atk.fourTwo) {
        const other = onCourt.find((p) => pos[p] === Position.Setter && free(p));
        if (other !== undefined) return other;
      }
      if (libero >= 0) return libero;
      return onCourt.find((p) => pos[p] === Position.Opposite && free(p))
        ?? onCourt.find((p) => free(p)) ?? setter;
    }
    // A ball well off the net: the setter can't always reach it, and the libero takes it.
    if (quality < BAD_BALL && libero >= 0 && this.rng.chance(BAD_BALL_LIBERO)) return libero;
    return setter;
  }

  /**
   * Choose which receiver the serve is aimed at.
   *
   * Serving a weak passer is one of the highest-leverage instructions a coach
   * gives, so the tactic has to actually change who touches the ball.
   */
  private pickReceiver(rcv: TeamRuntime, srvTactics: TeamTactics, rotTac: ServeTarget): number {
    const n = receptionUnit(rcv.court, this.store.position, rcv.liberoIdx, this.recvUnit);
    if (n === 0) return rcv.court[0];

    const target = rotTac !== ServeTarget.Auto ? rotTac : autoTarget(srvTactics);

    if (target === ServeTarget.WeakestPasser) {
      let worst = this.recvUnit[0];
      let worstScore = Infinity;
      for (let i = 0; i < n; i++) {
        const s = rcv.rate(this.recvUnit[i]).reception;
        if (s < worstScore) {
          worstScore = s;
          worst = this.recvUnit[i];
        }
      }
      // Even a targeted serve misses its man sometimes.
      return this.rng.chance(0.72) ? worst : this.recvUnit[this.rng.int(0, n - 1)];
    }

    if (target === ServeTarget.Setter) {
      // Serving the setter disrupts the offense but they are usually hidden.
      return this.rng.chance(0.3) ? rcv.settingIdx() : this.recvUnit[this.rng.int(0, n - 1)];
    }

    if (target === ServeTarget.BestAttacker) {
      let best = this.recvUnit[0];
      let bestScore = -Infinity;
      for (let i = 0; i < n; i++) {
        const s = rcv.rate(this.recvUnit[i]).attackPower;
        if (s > bestScore) {
          bestScore = s;
          best = this.recvUnit[i];
        }
      }
      return this.rng.chance(0.7) ? best : this.recvUnit[this.rng.int(0, n - 1)];
    }

    return this.recvUnit[this.rng.int(0, n - 1)];
  }

  /**
   * Pick the attack lane.
   *
   * This is where the 5-1 system produces its characteristic rotation swings.
   * When the setter is front row only two attackers are available, so those
   * three rotations are structurally weaker — exactly the pattern a real
   * coach sees in their rotation report.
   */
  private chooseLane(
    atk: TeamRuntime,
    grade: Grade,
    rotTac: { preferredAttacker: Position | -1; setterTempoBias: number; transitionBackRow: number },
    setQuality: number,
    /** Whoever is setting this ball — he can't hit it too. */
    setter: number,
  ): number {
    const weights = this.laneWeights;
    const attackers = this.laneAttacker;
    weights.fill(0);
    attackers.fill(-1);

    const base = OFFENSE_LANE_WEIGHTS[atk.tactics.offense];
    const pos = this.store.position;
    const fastBias = 0.6 + (rotTac.setterTempoBias / 100) * 0.8;

    for (let z = 0; z < 6; z++) {
      const p = effectivePlayerAt(atk.court, z, pos, atk.liberoIdx);
      if (p === setter) continue;
      const role = pos[p] as Position;
      const front = z >= 1 && z <= 3;
      const r = atk.rate(p);

      if (front) {
        if (role === Position.MiddleBlocker) {
          // Quick attacks need a pass the setter can work with.
          if (grade >= Grade.Positive && setQuality > 0.35) {
            weights[AttackLane.QuickMiddle] = base[AttackLane.QuickMiddle] * fastBias * qual(r.quickAttack);
            attackers[AttackLane.QuickMiddle] = p;
          }
        } else if (role === Position.OutsideHitter) {
          weights[AttackLane.OutsideHigh] = base[AttackLane.OutsideHigh] * qual(r.attackPower);
          attackers[AttackLane.OutsideHigh] = p;
          weights[AttackLane.SecondTempoOutside] =
            base[AttackLane.SecondTempoOutside] * qual(r.attackControl);
          attackers[AttackLane.SecondTempoOutside] = p;
        } else if (role === Position.Opposite || (role === Position.Setter && atk.fourTwo)) {
          // In a 4-2 the setter at the net is the right-side hitter.
          weights[AttackLane.OppositeRight] = base[AttackLane.OppositeRight] * qual(r.attackPower);
          attackers[AttackLane.OppositeRight] = p;
        } else {
          // A non-attacker stranded in the front row can still put a ball over.
          if (attackers[AttackLane.SecondTempoOutside] === -1) {
            weights[AttackLane.SecondTempoOutside] = 0.35 * qual(r.attackControl);
            attackers[AttackLane.SecondTempoOutside] = p;
          }
        }
      } else {
        // Back-row attacks demand a good pass and a real jumper.
        if (grade >= Grade.Positive && setQuality > 0.42) {
          const backBias = 0.7 + (rotTac.transitionBackRow / 100) * 0.7;
          if (role === Position.OutsideHitter && z === 5) {
            weights[AttackLane.Pipe] = base[AttackLane.Pipe] * backBias * qual(r.pipeAttack);
            attackers[AttackLane.Pipe] = p;
          } else if (role === Position.Opposite && z === 0) {
            weights[AttackLane.BackRowRight] =
              base[AttackLane.BackRowRight] * backBias * qual(r.backRowAttack);
            attackers[AttackLane.BackRowRight] = p;
          }
        }
      }
    }

    // On a poor pass the fast game is off; the ball goes high to the pin.
    if (grade === Grade.Poor) {
      weights[AttackLane.QuickMiddle] = 0;
      weights[AttackLane.Pipe] *= 0.2;
      weights[AttackLane.BackRowRight] *= 0.2;
      weights[AttackLane.SecondTempoOutside] *= 2.2;
    }

    // The coach's per-rotation preference.
    if (rotTac.preferredAttacker !== -1) {
      for (let l = 0; l < 6; l++) {
        const p = attackers[l];
        if (p >= 0 && pos[p] === rotTac.preferredAttacker) weights[l] *= 1.7;
      }
    }

    let total = 0;
    for (let l = 0; l < 6; l++) total += weights[l];
    if (total <= 0) return -1;
    return this.rng.weightedIndex(weights, total);
  }

  /** How many blockers get up, given the lane and the defensive instruction. */
  private blockersFor(
    lane: number,
    grade: Grade,
    def: TeamRuntime,
    _rotTac: unknown,
    transition: boolean,
  ): number {
    const assignment = def.tactics.rotations[def.rotation()].blockAssignment;
    const pressure = DEFENSE_PROFILE[def.tactics.defense].blockPressure;

    // A well-run quick attack beats the block by tempo, not by height.
    let expected: number;
    if (lane === AttackLane.QuickMiddle) expected = 1.15;
    else if (lane === AttackLane.Pipe || lane === AttackLane.BackRowRight) expected = 1.7;
    else expected = grade === Grade.Poor ? 2.35 : 1.95;

    if (assignment === BlockAssignment.CommitMiddle) {
      expected += lane === AttackLane.QuickMiddle ? 0.55 : -0.3;
    } else if (assignment === BlockAssignment.SpreadBlock) {
      expected += lane === AttackLane.QuickMiddle ? 0.2 : -0.1;
    } else if (assignment === BlockAssignment.ReleaseToLine) {
      expected -= 0.15;
    }
    if (transition) expected -= 0.45; // less time to form up
    expected *= pressure;

    const floorN = Math.floor(expected);
    const frac = expected - floorN;
    const n = floorN + (this.rng.chance(frac) ? 1 : 0);
    return Math.max(0, Math.min(3, n));
  }

  /** Combined block rating: the primary blocker plus help. */
  private blockStrength(def: TeamRuntime, lane: number, count: number): number {
    if (count === 0) return 0;
    const primary = this.pickBlocker(def, lane);
    let total = def.rate(primary).block * def.rate(primary).fatigue;
    // Extra blockers close seams rather than adding their full rating.
    let helpers = 0;
    for (let z = 1; z <= 3 && helpers < count - 1; z++) {
      const p = def.court[z];
      if (p === primary) continue;
      total += def.rate(p).block * 0.28;
      helpers++;
    }
    return total / (1 + helpers * 0.28) + (count - 1) * 7.5;
  }

  private pickBlocker(def: TeamRuntime, lane: number): number {
    // Zone indices: 1 = zone 2 (right), 2 = zone 3 (middle), 3 = zone 4 (left).
    const zone = lane === AttackLane.QuickMiddle || lane === AttackLane.Pipe
      ? 2
      : lane === AttackLane.OppositeRight || lane === AttackLane.BackRowRight
        ? 3
        : 1;
    return def.court[zone];
  }

  /** Average digging strength of the players who can realistically get the ball up. */
  private digStrength(def: TeamRuntime): number {
    const pos = this.store.position;
    let total = 0;
    let n = 0;
    for (const z of [0, 4, 5]) {
      const p = effectivePlayerAt(def.court, z, pos, def.liberoIdx);
      const r = def.rate(p);
      // The libero is the best defender on the floor and gets more balls.
      const weight = pos[p] === Position.Libero ? 1.6 : 1;
      total += r.dig * r.fatigue * weight;
      n += weight;
    }
    return n > 0 ? total / n : 40;
  }

  private pickDigger(def: TeamRuntime): number {
    const pos = this.store.position;
    const zones = [0, 4, 5];
    const w = [1, 1, 1];
    for (let i = 0; i < 3; i++) {
      const p = effectivePlayerAt(def.court, zones[i], pos, def.liberoIdx);
      w[i] = pos[p] === Position.Libero ? 2.2 : 1;
    }
    const z = zones[this.rng.weightedIndex(w)];
    return effectivePlayerAt(def.court, z, pos, def.liberoIdx);
  }

  // ---- Match-state modifiers ---------------------------------------------

  /**
   * Pressure and momentum, applied to on-court players before each rally.
   *
   * Composure and Big Match Performance decide who grows and who shrinks. This
   * is deliberately a small effect — a few percent — because in real volleyball
   * nerves shade outcomes rather than dictating them.
   */
  private applyPressure(): void {
    const setNo = this.currentSet;
    const a = this.teams[0].score;
    const b = this.teams[1].score;
    const target = setNo === 4 ? 15 : 25;
    const lead = Math.abs(a - b);
    const closeness = Math.max(0, 1 - lead / 6);
    const lateness = Math.min(1, Math.max(a, b) / target);
    const decider = setNo >= (this.setup.format === MatchFormat.BestOf5 ? 4 : 2) ? 1.25 : 1;
    const pressure = this.setup.importance * closeness * lateness * decider;

    for (let t = 0; t < 2; t++) {
      const team = this.teams[t];
      const momentumBoost = 1 + team.momentum * 0.006;
      const edge = team.edge;
      for (let z = 0; z < 6; z++) {
        const p = effectivePlayerAt(team.court, z, this.store.position, team.liberoIdx);
        const r = team.rate(p);
        const clutch = (r.bigMatch - 0.5) * 0.5 + (r.composure - 0.5) * 0.5;
        r.confidence = clamp(edge * momentumBoost * (1 + clutch * pressure * 0.16), 0.72, 1.28);
      }
    }
  }

  /** Drain condition from everyone who was on court. */
  private applyFatigue(contacts: number): void {
    const intensity = 0.00045 + contacts * 0.00007;
    for (let t = 0; t < 2; t++) {
      const team = this.teams[t];
      for (let z = 0; z < 6; z++) {
        const p = effectivePlayerAt(team.court, z, this.store.position, team.liberoIdx);
        const r = team.rate(p);
        // Stamina buys endurance; a 20-stamina player fades roughly a third as
        // fast as a 5-stamina one.
        r.fatigue = Math.max(0.72, r.fatigue - intensity * (1.7 - r.stamina));
        statsFor(team.stats, p).ralliesPlayed++;
      }
    }
  }

  /** Players recover a little in the interval between sets. */
  private recoverBetweenSets(): void {
    for (const team of this.teams) {
      for (const r of team.ratings.values()) {
        r.fatigue = Math.min(1, r.fatigue + 0.012 + r.recovery * 0.022);
      }
    }
  }

  private freshestTeam(): 0 | 1 {
    let best = 0;
    let bestScore = -Infinity;
    for (let t = 0; t < 2; t++) {
      let sum = 0;
      for (let z = 0; z < 6; z++) sum += this.teams[t].rate(this.teams[t].court[z]).fatigue;
      if (sum > bestScore) {
        bestScore = sum;
        best = t;
      }
    }
    return best as 0 | 1;
  }

  // ---- Reporting ----------------------------------------------------------

  /**
   * Home win probability from the current match state. A closed-form estimate
   * rather than a nested simulation, so it is cheap enough to record on every
   * rally of a logged match.
   */
  private estimateWinProbability(): number {
    const setsToWin = this.setup.format === MatchFormat.BestOf5 ? 3 : 2;
    const hs = this.teams[0].setsWon;
    const as = this.teams[1].setsWon;
    if (hs >= setsToWin) return 1;
    if (as >= setsToWin) return 0;

    const target = this.currentSet === 4 ? 15 : 25;
    const a = this.teams[0].score;
    const b = this.teams[1].score;
    // Current-set win probability from the points still needed.
    const needA = Math.max(1, target - a);
    const needB = Math.max(1, target - b);
    const pSet = clamp(0.5 + (needB - needA) * 0.055, 0.02, 0.98);

    // Remaining sets are close to coin flips between evenly matched sides.
    const needSetsA = setsToWin - hs;
    const needSetsB = setsToWin - as;
    let p = 0;
    // Enumerate: win current set, or lose it, then treat the rest as fair.
    p += pSet * setsProb(needSetsA - 1, needSetsB);
    p += (1 - pSet) * setsProb(needSetsA, needSetsB - 1);
    return clamp(p, 0, 1);
  }

  private findMvp(): number {
    let best = -1;
    let bestScore = -Infinity;
    const winner = this.teams[0].setsWon > this.teams[1].setsWon ? 0 : 1;
    for (const s of this.teams[winner].stats.players.values()) {
      const score =
        s.attackKills + s.serveAces * 1.4 + s.blockPoints * 1.3 - s.attackErrors * 0.7 -
        s.serveErrors * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = s.playerIdx;
      }
    }
    return best;
  }

  /** Fold this match into each player's permanent career record. */
  private commitCareerTotals(): void {
    const st = this.store;
    for (const team of this.teams) {
      for (const s of team.stats.players.values()) {
        const i = s.playerIdx;
        if (s.ralliesPlayed === 0 && s.attacksTotal === 0) continue;
        st.careerMatches[i] = Math.min(65535, st.careerMatches[i] + 1);
        st.careerPoints[i] += s.attackKills + s.serveAces + s.blockPoints;
        st.careerAces[i] = Math.min(65535, st.careerAces[i] + s.serveAces);
        st.careerBlocks[i] = Math.min(65535, st.careerBlocks[i] + s.blockPoints);
      }
    }
  }

  private push(c: RallyContact): void {
    if (this.log) this.contacts.push(c);
  }
}

// ---- Free functions -------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A side's strength as the background sim reckons it: the six and the libero's average ability. */
function sideStrength(store: PlayerStore, t: TeamRuntime): number {
  let total = 0;
  let n = 0;
  for (const p of t.startLineup) {
    if (p < 0) continue;
    total += store.currentAbility[p];
    n++;
  }
  if (t.receptionLibero >= 0) {
    total += store.currentAbility[t.receptionLibero];
    n++;
  }
  return n > 0 ? total / n : 0;
}

/** Convert a rating into a selection weight; better attackers get more sets. */
function qual(rating: number): number {
  return Math.max(0.15, rating / 60);
}

function gradeOf(q: number): Grade {
  if (q >= 0.58) return Grade.Perfect;
  if (q >= 0.42) return Grade.Positive;
  if (q >= 0.10) return Grade.Poor;
  return Grade.Error;
}

function srvRotTactics(srv: TeamRuntime): ServeTarget {
  return srv.tactics.rotations[srv.rotation()].serveTarget;
}

function autoTarget(t: TeamTactics): ServeTarget {
  return t.serve === 0 ? ServeTarget.WeakestPasser : ServeTarget.Auto;
}

/** Probability of winning a race to `a` more sets vs `b`, assuming fair sets. */
function setsProb(a: number, b: number): number {
  if (a <= 0) return 1;
  if (b <= 0) return 0;
  return 0.5 * setsProb(a - 1, b) + 0.5 * setsProb(a, b - 1);
}

/** Convenience entry point. */
export function simulateMatch(store: PlayerStore, setup: MatchSetup): MatchResult {
  return new MatchSimulator(store, setup).run();
}
