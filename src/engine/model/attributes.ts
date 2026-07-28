/**
 * Player attribute schema.
 *
 * Every attribute is on the familiar 1-20 scale and stored as a single byte.
 * The ordering here defines the memory layout of the player store, so entries
 * may be appended but never reordered without bumping the save format version.
 *
 * Anthropometrics (height, weight, spike reach, block reach) are deliberately
 * NOT on the 1-20 scale — they are real measurements in cm/kg, because they
 * come straight from FIVB registration data and because the match engine needs
 * true reach differentials to compute block coverage. They live in a separate
 * numeric block on the player store.
 */

export const PHYSICAL_ATTRS = [
  'acceleration',
  'verticalJump',
  'agility',
  'balance',
  'flexibility',
  'stamina',
  'recovery',
  'durability',
] as const;

export const TECHNICAL_ATTRS = [
  'floatServe',
  'jumpServe',
  'powerServe',
  'setting',
  'reception',
  'digging',
  'blocking',
  'quickAttack',
  'backRowAttack',
  'pipeAttack',
  'servingAccuracy',
  'servingPower',
  'spikeTechnique',
  'ballControl',
] as const;

export const MENTAL_ATTRS = [
  'leadership',
  'teamwork',
  'professionalism',
  'determination',
  'composure',
  'concentration',
  'aggression',
  'pressureHandling',
  'discipline',
  'confidence',
  'adaptability',
  'workEthic',
] as const;

/**
 * Hidden attributes are never shown to the player as numbers, only inferred
 * through behaviour and scout reports.
 */
export const HIDDEN_ATTRS = [
  'injuryProneness',
  'loyalty',
  'ambition',
  'temperament',
  'mediaHandling',
  'consistency',
  'bigMatchPerformance',
  'homesickness',
  'coachability',
  'retirementPreference',
] as const;

export const ATTRIBUTES = [
  ...PHYSICAL_ATTRS,
  ...TECHNICAL_ATTRS,
  ...MENTAL_ATTRS,
  ...HIDDEN_ATTRS,
] as const;

export type AttributeName = (typeof ATTRIBUTES)[number];
export type PhysicalAttr = (typeof PHYSICAL_ATTRS)[number];
export type TechnicalAttr = (typeof TECHNICAL_ATTRS)[number];
export type MentalAttr = (typeof MENTAL_ATTRS)[number];
export type HiddenAttr = (typeof HIDDEN_ATTRS)[number];

export const ATTR_COUNT = ATTRIBUTES.length;

/** Attribute name -> its column index in the player store. */
export const ATTR_INDEX = Object.freeze(
  ATTRIBUTES.reduce<Record<string, number>>((acc, name, i) => {
    acc[name] = i;
    return acc;
  }, {}),
) as Readonly<Record<AttributeName, number>>;

export const HIDDEN_ATTR_SET: ReadonlySet<string> = new Set(HIDDEN_ATTRS);

export type AttributeGroup = 'physical' | 'technical' | 'mental' | 'hidden';

export function attributeGroup(name: AttributeName): AttributeGroup {
  if ((PHYSICAL_ATTRS as readonly string[]).includes(name)) return 'physical';
  if ((TECHNICAL_ATTRS as readonly string[]).includes(name)) return 'technical';
  if ((MENTAL_ATTRS as readonly string[]).includes(name)) return 'mental';
  return 'hidden';
}

/** Human-readable labels for the UI. */
export const ATTR_LABELS: Readonly<Record<AttributeName, string>> = {
  acceleration: 'Acceleration',
  verticalJump: 'Vertical Jump',
  agility: 'Agility',
  balance: 'Balance',
  flexibility: 'Flexibility',
  stamina: 'Stamina',
  recovery: 'Recovery',
  durability: 'Durability',
  floatServe: 'Float Serve',
  jumpServe: 'Jump Serve',
  powerServe: 'Power Serve',
  setting: 'Setting',
  reception: 'Reception',
  digging: 'Digging',
  blocking: 'Blocking',
  quickAttack: 'Quick Attack',
  backRowAttack: 'Back Row Attack',
  pipeAttack: 'Pipe Attack',
  servingAccuracy: 'Serving Accuracy',
  servingPower: 'Serving Power',
  spikeTechnique: 'Spike Technique',
  ballControl: 'Ball Control',
  leadership: 'Leadership',
  teamwork: 'Teamwork',
  professionalism: 'Professionalism',
  determination: 'Determination',
  composure: 'Composure',
  concentration: 'Concentration',
  aggression: 'Aggression',
  pressureHandling: 'Pressure Handling',
  discipline: 'Discipline',
  confidence: 'Confidence',
  adaptability: 'Adaptability',
  workEthic: 'Work Ethic',
  injuryProneness: 'Injury Proneness',
  loyalty: 'Loyalty',
  ambition: 'Ambition',
  temperament: 'Temperament',
  mediaHandling: 'Media Handling',
  consistency: 'Consistency',
  bigMatchPerformance: 'Big Match Performance',
  homesickness: 'Homesickness',
  coachability: 'Coachability',
  retirementPreference: 'Retirement Preference',
};

/**
 * Attributes that physically decay with age, and how fast relative to the base
 * decline curve. Technique and mental attributes hold up far better than
 * explosive physical qualities — a 34-year-old setter can still be world class
 * while a 34-year-old opposite has usually lost their best swing.
 */
export const AGE_DECAY_WEIGHT: Readonly<Partial<Record<AttributeName, number>>> = {
  acceleration: 1.35,
  verticalJump: 1.5,
  agility: 1.2,
  stamina: 1.0,
  recovery: 1.25,
  balance: 0.35,
  flexibility: 0.7,
  durability: 0.9,
  quickAttack: 0.4,
  backRowAttack: 0.5,
  pipeAttack: 0.5,
  servingPower: 0.6,
  powerServe: 0.6,
  jumpServe: 0.55,
  blocking: 0.35,
};

/** Attributes that keep improving well past physical peak. */
export const LATE_GROWTH_WEIGHT: Readonly<Partial<Record<AttributeName, number>>> = {
  setting: 0.6,
  ballControl: 0.5,
  reception: 0.45,
  digging: 0.4,
  spikeTechnique: 0.4,
  servingAccuracy: 0.5,
  floatServe: 0.45,
  leadership: 0.9,
  composure: 0.7,
  concentration: 0.5,
  pressureHandling: 0.6,
  teamwork: 0.4,
  discipline: 0.35,
};

/** Clamp a raw value into the legal 1-20 attribute band. */
export function clampAttr(v: number): number {
  return v < 1 ? 1 : v > 20 ? 20 : v;
}
