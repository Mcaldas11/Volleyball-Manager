/**
 * The player store.
 *
 * A career lasting fifty seasons accumulates hundreds of thousands of players:
 * the initial world, then a fresh generation of regens every year, and every
 * retired legend kept forever so the Hall of Fame and record books stay honest.
 * Storing those as JavaScript objects would mean ~40M+ of heap, slow garbage
 * collection during the season rollover, and multi-second save serialization.
 *
 * So this is struct-of-arrays: every field is a column in a typed array, and a
 * "player" is just an integer index into those columns. Attributes fit in a
 * byte each. Saving is a buffer dump rather than a JSON walk, and the match
 * engine reads attributes straight out of contiguous memory.
 *
 * The cost is ergonomics — you index columns rather than dotting into objects.
 * `PlayerView` papers over that for UI and non-hot-path code.
 */

import { ATTR_COUNT, ATTR_INDEX, type AttributeName } from './attributes.ts';
import { Position } from './positions.ts';

export const NO_CLUB = -1;
export const NO_PLAYER = -1;

/** Bit flags packed into the `flags` column. */
export const enum PlayerFlag {
  Retired = 1 << 0,
  Regen = 1 << 1,
  Youth = 1 << 2,
  Injured = 1 << 3,
  Transferable = 1 << 4,
  NationalTeam = 1 << 5,
  HallOfFame = 1 << 6,
}

/** Injury categories, ordered roughly by severity of long-term consequence. */
export const enum InjuryType {
  None = 0,
  Fatigue = 1,
  AnkleSprain = 2,
  FingerFracture = 3,
  Shoulder = 4,
  Back = 5,
  KneeCartilage = 6,
  AchillesTear = 7,
  ACLTear = 8,
}

export const INJURY_NAMES: Readonly<Record<number, string>> = {
  [InjuryType.None]: 'Fit',
  [InjuryType.Fatigue]: 'Fatigue',
  [InjuryType.AnkleSprain]: 'Ankle Sprain',
  [InjuryType.FingerFracture]: 'Finger Fracture',
  [InjuryType.Shoulder]: 'Shoulder Injury',
  [InjuryType.Back]: 'Back Problem',
  [InjuryType.KneeCartilage]: 'Knee Cartilage Damage',
  [InjuryType.AchillesTear]: 'Achilles Tear',
  [InjuryType.ACLTear]: 'ACL Tear',
};

/**
 * A string table so names cost 4 bytes per player rather than a heap string
 * each. Volleyball name banks repeat heavily within a nation, so dedup pays.
 */
export class StringTable {
  private readonly values: string[] = [];
  private readonly index = new Map<string, number>();

  intern(s: string): number {
    const existing = this.index.get(s);
    if (existing !== undefined) return existing;
    const id = this.values.length;
    this.values.push(s);
    this.index.set(s, id);
    return id;
  }

  get(id: number): string {
    return this.values[id] ?? '';
  }

  get size(): number {
    return this.values.length;
  }

  toJSON(): string[] {
    return this.values;
  }

  static fromJSON(values: string[]): StringTable {
    const t = new StringTable();
    for (const v of values) t.intern(v);
    return t;
  }
}

export class PlayerStore {
  count = 0;
  private capacity: number;

  readonly names = new StringTable();

  // ---- Identity -----------------------------------------------------------
  /** Permanent internal ID. Never reused, never changes, survives retirement. */
  id!: Int32Array;
  /** FIVB player number when imported from VIS; 0 for generated players. */
  fivbId!: Int32Array;
  firstName!: Int32Array;
  lastName!: Int32Array;
  nation!: Uint16Array;
  /** Second nationality for dual-eligible players; 0xffff when none. */
  nation2!: Uint16Array;
  birthYear!: Int16Array;
  /** Day of year 0-364, so ages tick over across a season rather than en bloc. */
  birthDay!: Uint16Array;

  // ---- Anthropometrics (real units, straight from FIVB registration) -------
  heightCm!: Uint16Array;
  weightKg!: Uint8Array;
  spikeReachCm!: Uint16Array;
  blockReachCm!: Uint16Array;

  // ---- Role ---------------------------------------------------------------
  position!: Uint8Array;
  /** Trained secondary position, or -1. */
  secondary!: Int8Array;

  // ---- Attributes (1-20, one byte each) -----------------------------------
  /** Row-major: player i's attribute a lives at i * ATTR_COUNT + a. */
  attrs!: Uint8Array;

  // ---- Ability ------------------------------------------------------------
  /** Current ability, 0-2000. A weighted roll-up of attributes for the role. */
  currentAbility!: Uint16Array;
  /** Potential ability, 0-2000. Dynamic: can be revised up or down. */
  potentialAbility!: Uint16Array;

  // ---- Live state ---------------------------------------------------------
  clubId!: Int32Array;
  /** Match sharpness / physical condition, 0-100. */
  condition!: Uint8Array;
  morale!: Uint8Array;
  /** Rolling form, -50..50. */
  form!: Int8Array;
  injuryDaysLeft!: Uint16Array;
  injuryType!: Uint8Array;
  flags!: Uint8Array;

  // ---- Contract & market --------------------------------------------------
  /** Absolute game-day on which the contract expires. */
  contractUntil!: Int32Array;
  /** Annual wage in euros. */
  wage!: Float64Array;
  /** Estimated market value in euros. */
  value!: Float64Array;
  /** 0-10000, drives transfer interest and media attention. */
  reputation!: Uint16Array;

  // ---- Career totals (persist across the whole save) -----------------------
  careerMatches!: Uint16Array;
  careerPoints!: Uint32Array;
  careerAces!: Uint16Array;
  careerBlocks!: Uint16Array;
  careerTitles!: Uint16Array;
  nationalCaps!: Uint16Array;
  /** Season the player retired, 0 if still active. */
  retiredYear!: Int16Array;

  private nextId = 1;

  constructor(capacity = 4096) {
    this.capacity = capacity;
    this.allocate(capacity);
  }

  private allocate(cap: number): void {
    this.id = new Int32Array(cap);
    this.fivbId = new Int32Array(cap);
    this.firstName = new Int32Array(cap);
    this.lastName = new Int32Array(cap);
    this.nation = new Uint16Array(cap);
    this.nation2 = new Uint16Array(cap).fill(0xffff);
    this.birthYear = new Int16Array(cap);
    this.birthDay = new Uint16Array(cap);
    this.heightCm = new Uint16Array(cap);
    this.weightKg = new Uint8Array(cap);
    this.spikeReachCm = new Uint16Array(cap);
    this.blockReachCm = new Uint16Array(cap);
    this.position = new Uint8Array(cap);
    this.secondary = new Int8Array(cap).fill(-1);
    this.attrs = new Uint8Array(cap * ATTR_COUNT);
    this.currentAbility = new Uint16Array(cap);
    this.potentialAbility = new Uint16Array(cap);
    this.clubId = new Int32Array(cap).fill(NO_CLUB);
    this.condition = new Uint8Array(cap).fill(100);
    this.morale = new Uint8Array(cap).fill(60);
    this.form = new Int8Array(cap);
    this.injuryDaysLeft = new Uint16Array(cap);
    this.injuryType = new Uint8Array(cap);
    this.flags = new Uint8Array(cap);
    this.contractUntil = new Int32Array(cap);
    this.wage = new Float64Array(cap);
    this.value = new Float64Array(cap);
    this.reputation = new Uint16Array(cap);
    this.careerMatches = new Uint16Array(cap);
    this.careerPoints = new Uint32Array(cap);
    this.careerAces = new Uint16Array(cap);
    this.careerBlocks = new Uint16Array(cap);
    this.careerTitles = new Uint16Array(cap);
    this.nationalCaps = new Uint16Array(cap);
    this.retiredYear = new Int16Array(cap);
  }

  private grow(needed: number): void {
    let cap = this.capacity;
    while (cap < needed) cap = Math.ceil(cap * 1.6);

    const old = {
      id: this.id, fivbId: this.fivbId, firstName: this.firstName, lastName: this.lastName,
      nation: this.nation, nation2: this.nation2, birthYear: this.birthYear, birthDay: this.birthDay,
      heightCm: this.heightCm, weightKg: this.weightKg, spikeReachCm: this.spikeReachCm,
      blockReachCm: this.blockReachCm, position: this.position, secondary: this.secondary,
      attrs: this.attrs, currentAbility: this.currentAbility, potentialAbility: this.potentialAbility,
      clubId: this.clubId, condition: this.condition, morale: this.morale, form: this.form,
      injuryDaysLeft: this.injuryDaysLeft, injuryType: this.injuryType, flags: this.flags,
      contractUntil: this.contractUntil, wage: this.wage, value: this.value,
      reputation: this.reputation, careerMatches: this.careerMatches, careerPoints: this.careerPoints,
      careerAces: this.careerAces, careerBlocks: this.careerBlocks, careerTitles: this.careerTitles,
      nationalCaps: this.nationalCaps, retiredYear: this.retiredYear,
    };
    const n = this.count;

    this.capacity = cap;
    this.allocate(cap);

    this.id.set(old.id.subarray(0, n));
    this.fivbId.set(old.fivbId.subarray(0, n));
    this.firstName.set(old.firstName.subarray(0, n));
    this.lastName.set(old.lastName.subarray(0, n));
    this.nation.set(old.nation.subarray(0, n));
    this.nation2.set(old.nation2.subarray(0, n));
    this.birthYear.set(old.birthYear.subarray(0, n));
    this.birthDay.set(old.birthDay.subarray(0, n));
    this.heightCm.set(old.heightCm.subarray(0, n));
    this.weightKg.set(old.weightKg.subarray(0, n));
    this.spikeReachCm.set(old.spikeReachCm.subarray(0, n));
    this.blockReachCm.set(old.blockReachCm.subarray(0, n));
    this.position.set(old.position.subarray(0, n));
    this.secondary.set(old.secondary.subarray(0, n));
    this.attrs.set(old.attrs.subarray(0, n * ATTR_COUNT));
    this.currentAbility.set(old.currentAbility.subarray(0, n));
    this.potentialAbility.set(old.potentialAbility.subarray(0, n));
    this.clubId.set(old.clubId.subarray(0, n));
    this.condition.set(old.condition.subarray(0, n));
    this.morale.set(old.morale.subarray(0, n));
    this.form.set(old.form.subarray(0, n));
    this.injuryDaysLeft.set(old.injuryDaysLeft.subarray(0, n));
    this.injuryType.set(old.injuryType.subarray(0, n));
    this.flags.set(old.flags.subarray(0, n));
    this.contractUntil.set(old.contractUntil.subarray(0, n));
    this.wage.set(old.wage.subarray(0, n));
    this.value.set(old.value.subarray(0, n));
    this.reputation.set(old.reputation.subarray(0, n));
    this.careerMatches.set(old.careerMatches.subarray(0, n));
    this.careerPoints.set(old.careerPoints.subarray(0, n));
    this.careerAces.set(old.careerAces.subarray(0, n));
    this.careerBlocks.set(old.careerBlocks.subarray(0, n));
    this.careerTitles.set(old.careerTitles.subarray(0, n));
    this.nationalCaps.set(old.nationalCaps.subarray(0, n));
    this.retiredYear.set(old.retiredYear.subarray(0, n));
  }

  /** Reserve a slot and return its index. Assigns a permanent ID. */
  create(): number {
    if (this.count >= this.capacity) this.grow(this.count + 1);
    const i = this.count++;
    this.id[i] = this.nextId++;
    return i;
  }

  /** Pre-size the store when the expected population is known up front. */
  reserve(n: number): void {
    if (n > this.capacity) this.grow(n);
  }

  // ---- Attribute access ---------------------------------------------------

  getAttr(i: number, attr: AttributeName): number {
    return this.attrs[i * ATTR_COUNT + ATTR_INDEX[attr]];
  }

  setAttr(i: number, attr: AttributeName, v: number): void {
    this.attrs[i * ATTR_COUNT + ATTR_INDEX[attr]] = v < 1 ? 1 : v > 20 ? 20 : v | 0;
  }

  /** Base offset of player i's attribute row, for hot loops. */
  attrBase(i: number): number {
    return i * ATTR_COUNT;
  }

  // ---- Derived ------------------------------------------------------------

  fullName(i: number): string {
    return `${this.names.get(this.firstName[i])} ${this.names.get(this.lastName[i])}`;
  }

  shortName(i: number): string {
    const f = this.names.get(this.firstName[i]);
    return `${f.charAt(0)}. ${this.names.get(this.lastName[i])}`;
  }

  ageOn(i: number, year: number, dayOfYear: number): number {
    const a = year - this.birthYear[i];
    return dayOfYear >= this.birthDay[i] ? a : a - 1;
  }

  hasFlag(i: number, f: PlayerFlag): boolean {
    return (this.flags[i] & f) !== 0;
  }

  setFlag(i: number, f: PlayerFlag, on: boolean): void {
    if (on) this.flags[i] |= f;
    else this.flags[i] &= ~f;
  }

  isActive(i: number): boolean {
    return (this.flags[i] & PlayerFlag.Retired) === 0;
  }

  isAvailable(i: number): boolean {
    return this.isActive(i) && this.injuryDaysLeft[i] === 0;
  }

  /** Ergonomic wrapper. Allocates — never call this inside the rally loop. */
  view(i: number): PlayerView {
    return new PlayerView(this, i);
  }
}

/**
 * Object-shaped read access to one player. For UI, reports, and any code where
 * clarity matters more than speed.
 */
export class PlayerView {
  constructor(
    readonly store: PlayerStore,
    readonly index: number,
  ) {}

  get id(): number { return this.store.id[this.index]; }
  get fivbId(): number { return this.store.fivbId[this.index]; }
  get name(): string { return this.store.fullName(this.index); }
  get shortName(): string { return this.store.shortName(this.index); }
  get nation(): number { return this.store.nation[this.index]; }
  get position(): Position { return this.store.position[this.index] as Position; }
  get secondary(): Position | -1 { return this.store.secondary[this.index] as Position | -1; }
  get heightCm(): number { return this.store.heightCm[this.index]; }
  get weightKg(): number { return this.store.weightKg[this.index]; }
  get spikeReachCm(): number { return this.store.spikeReachCm[this.index]; }
  get blockReachCm(): number { return this.store.blockReachCm[this.index]; }
  get currentAbility(): number { return this.store.currentAbility[this.index]; }
  get potentialAbility(): number { return this.store.potentialAbility[this.index]; }
  get clubId(): number { return this.store.clubId[this.index]; }
  get condition(): number { return this.store.condition[this.index]; }
  get morale(): number { return this.store.morale[this.index]; }
  get form(): number { return this.store.form[this.index]; }
  get injuryDaysLeft(): number { return this.store.injuryDaysLeft[this.index]; }
  get injuryType(): InjuryType { return this.store.injuryType[this.index] as InjuryType; }
  get wage(): number { return this.store.wage[this.index]; }
  get value(): number { return this.store.value[this.index]; }
  get reputation(): number { return this.store.reputation[this.index]; }
  get birthYear(): number { return this.store.birthYear[this.index]; }

  attr(name: AttributeName): number {
    return this.store.getAttr(this.index, name);
  }

  ageOn(year: number, dayOfYear: number): number {
    return this.store.ageOn(this.index, year, dayOfYear);
  }
}
