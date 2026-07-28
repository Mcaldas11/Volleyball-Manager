/**
 * World generation.
 *
 * Builds a complete, self-consistent volleyball world: national league
 * pyramids sized to each country's actual volleyball culture, clubs whose
 * reputation determines the standard of player they can attract, squads shaped
 * like real rosters, and the staff who develop them.
 *
 * The important property is internal consistency. A club's reputation sets its
 * finances, its finances set its wage budget, its wage budget sets the calibre
 * of player it signs, and the calibre of its players sets its results — which
 * in turn move its reputation. Nothing is assigned independently, so the world
 * still makes sense forty seasons later after all of it has drifted.
 */

import { Rng } from '../core/rng.ts';
import {
  newClub, newFinances, newTableRow, type Club,
} from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position, SQUAD_TARGET } from '../model/positions.ts';
import { StaffRole, type Staff, type StaffAttributes } from '../model/staff.ts';
import { defaultTactics } from '../match/tactics.ts';
import { cityBankFor } from './cities.ts';
import { bankFor } from './names.ts';
import { NATIONS, type Confederation } from './nations.ts';
import { estimateValue, generatePlayer } from './playerGen.ts';
import {
  DAYS_PER_SEASON, newWorld, type Competition, type ManagerProfile, type NationalTeam, type World,
} from './world.ts';

export type WorldScale = 'small' | 'standard' | 'large';

export interface WorldGenOptions {
  seed: number;
  startYear: number;
  scale: WorldScale;
  manager: ManagerProfile;
}

/**
 * How deep each nation's pyramid runs, and how many parallel divisions sit at
 * each level. Lower tiers split into regional groups, which is how real
 * federations organise semi-professional volleyball.
 */
function pyramidShape(
  poolSize: number,
  baseTiers: number,
  scale: WorldScale,
): number[] {
  const extra = scale === 'large'
    ? Math.round(poolSize / 1.7)
    : scale === 'standard'
      ? Math.round(poolSize / 5)
      : 0;
  const tiers = Math.max(1, Math.min(9, baseTiers + extra));

  const groups: number[] = [];
  for (let t = 1; t <= tiers; t++) {
    if (t <= 2) groups.push(1);
    else groups.push(Math.min(8, 2 ** (t - 2)));
  }
  return groups;
}

/** Clubs per division, by tier. Top flights are smaller than lower ones. */
function clubsPerDivision(tier: number, rng: Rng): number {
  if (tier === 1) return rng.int(12, 14);
  if (tier === 2) return rng.int(12, 16);
  return rng.int(10, 14);
}

export function generateWorld(opts: WorldGenOptions): World {
  const world = newWorld(opts.seed, opts.startYear, opts.manager);
  const rng = world.rng;
  const usedNames = new Set<string>();

  for (let n = 0; n < NATIONS.length; n++) {
    const nation = NATIONS[n];
    const shape = pyramidShape(nation.poolSize, nation.leagueTiers, opts.scale);

    for (let t = 0; t < shape.length; t++) {
      const tier = t + 1;
      for (let g = 0; g < shape[t]; g++) {
        const size = clubsPerDivision(tier, rng);
        const comp = createLeague(world, n, tier, g, shape[t], size);

        for (let c = 0; c < size; c++) {
          const club = createClub(world, rng, n, tier, usedNames);
          club.leagueId = comp.id;
          comp.participants.push(club.id);
          comp.table.push(newTableRow(club.id));
        }
      }
    }
  }

  // Squads are built after every club exists, so that foreign signings can be
  // drawn from the whole world rather than from whatever was created first.
  for (const club of world.clubs) {
    buildSquad(world, rng, club);
    hireStaff(world, rng, club);
  }

  createNationalTeams(world);
  createContinentalCups(world);

  return world;
}

// ---- Leagues --------------------------------------------------------------

function createLeague(
  world: World,
  nation: number,
  tier: number,
  group: number,
  groupCount: number,
  size: number,
): Competition {
  const def = NATIONS[nation];
  const tierName =
    tier === 1 ? 'Superliga' : tier === 2 ? 'Serie A2' : `Division ${tier}`;
  const groupSuffix = groupCount > 1 ? ` — Group ${String.fromCharCode(65 + group)}` : '';

  const reputation = Math.round(
    def.strength * 95 * (1 / (1 + (tier - 1) * 0.62)),
  );

  const comp: Competition = {
    id: world.competitions.length,
    name: `${def.name} ${tierName}${groupSuffix}`,
    kind: 'league',
    nation,
    tier,
    participants: [],
    table: [],
    fixtureIds: [],
    reputation,
    promotionSlots: tier === 1 ? 0 : groupCount > 1 ? 1 : 2,
    relegationSlots: 2,
    hasPlayoffs: tier <= 2,
    playoffTeams: tier === 1 ? Math.min(8, size) : 4,
    champion: -1,
    prizePool: Math.round(Math.pow(reputation / 10000, 2.2) * 3_000_000),
  };
  world.competitions.push(comp);
  void size;
  return comp;
}

// ---- Clubs ----------------------------------------------------------------

function createClub(
  world: World,
  rng: Rng,
  nation: number,
  tier: number,
  usedNames: Set<string>,
): Club {
  const def = NATIONS[nation];
  const bank = cityBankFor(def.cityGroup ?? def.nameGroup);

  let name = '';
  for (let attempt = 0; attempt < 40; attempt++) {
    const city = rng.pick(bank.cities);
    const suffix = rng.pick(bank.suffixes);
    name = rng.chance(0.5) ? `${suffix} ${city}` : `${city} ${suffix}`;
    if (!usedNames.has(name)) break;
    if (attempt > 20) name = `${name} ${1 + rng.int(1, 99)}`;
  }
  usedNames.add(name);

  const club = newClub(world.clubs.length, name, nation, tier);

  // Reputation: driven by the nation's volleyball standing and the division,
  // with real spread inside each division so leagues have favourites.
  //
  // Strength is raised to a power rather than used linearly. Linearly, the gap
  // between a 92-strength nation and a 96-strength one is small enough that
  // random spread lets clubs from anywhere top the world rankings — which is
  // not how volleyball works. The convex curve keeps the very best clubs
  // concentrated in Italy, Poland, Brazil and Russia, as they are in reality.
  const tierFactor = 1 / (1 + (tier - 1) * 0.68);
  const strengthCurve = Math.pow(def.strength / 98, 2.6);
  club.reputation = Math.round(
    Math.min(10000, 10000 * strengthCurve * tierFactor * rng.gaussianClamped(0.9, 0.12, 0.6, 1.18)),
  );

  const repScale = club.reputation / 10000;
  club.arenaCapacity = Math.round(400 + Math.pow(repScale, 1.35) * 11_500);
  club.arenaName = rng.chance(0.35)
    ? `${rng.pick(['PalaSport', 'Arena', 'Hala', 'Sports Hall', 'Centre'])} ${club.name.split(' ').pop()}`
    : `${club.name} Arena`;
  club.finances = newFinances(club.reputation, club.arenaCapacity);

  const facility = (): number =>
    Math.round(Math.min(20, Math.max(1, 3 + repScale * 15 + rng.gaussian(0, 2.2))));
  club.trainingFacilities = facility();
  club.youthFacilities = facility();
  club.medicalFacilities = facility();
  club.youthRecruitment = facility();

  club.tactics = defaultTactics();
  club.boardExpectation = Math.max(1, Math.round(7 - repScale * 5 + rng.gaussian(0, 1.5)));
  club.boardConfidence = rng.int(50, 75);

  world.clubs.push(club);
  return club;
}

/**
 * Target Potential Ability for a player this club could realistically sign.
 * The convex mapping is why the gap between a mid-table top-flight club and a
 * title contender is much larger than the gap between two second-division sides.
 */
function squadLevelFor(reputation: number): number {
  return 600 + Math.pow(reputation / 10000, 0.72) * 1010;
}

function buildSquad(world: World, rng: Rng, club: Club): void {
  const store = world.players;
  const nationDef = NATIONS[club.nation];
  const level = squadLevelFor(club.reputation);

  // Stronger clubs import more heavily — a top Italian or Polish roster is
  // majority foreign, a third-division side is entirely local.
  const foreignChance = Math.min(0.62, 0.04 + (club.reputation / 10000) * 0.62);

  const created: number[] = [];
  for (const posKey of [
    Position.Setter, Position.Opposite, Position.OutsideHitter,
    Position.MiddleBlocker, Position.Libero,
  ]) {
    const count = SQUAD_TARGET[posKey];
    for (let i = 0; i < count; i++) {
      // The first-choice player at each position is better than the backup.
      const depthPenalty = i === 0 ? 1.0 : i === 1 ? 0.88 : 0.76;
      const age = rollSquadAge(rng, i === 0);
      const nation = rng.chance(foreignChance)
        ? pickForeignNation(rng, club.nation)
        : club.nation;

      const potential = Math.round(
        Math.min(1980, level * depthPenalty * rng.gaussianClamped(1, 0.11, 0.72, 1.34)),
      );

      const idx = generatePlayer(store, rng, {
        nation,
        age,
        potential,
        position: posKey,
        currentYear: world.year,
      });
      store.clubId[idx] = club.id;
      store.contractUntil[idx] = world.day + rng.int(1, 4) * DAYS_PER_SEASON;
      created.push(idx);
    }
  }

  club.players = created;
  void nationDef;

  // Preferred starting six in 5-1 rotational order: setter and opposite
  // diagonal, the two outsides diagonal, the two middles diagonal.
  const best = (pos: Position): number[] =>
    created
      .filter((p) => store.position[p] === pos)
      .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);

  const s = best(Position.Setter);
  const o = best(Position.Opposite);
  const oh = best(Position.OutsideHitter);
  const mb = best(Position.MiddleBlocker);
  const li = best(Position.Libero);

  club.preferredLineup = [s[0], mb[0], oh[0], o[0], mb[1], oh[1]];
  club.preferredLibero = li[0];

  // Wages are re-derived from ability so the wage bill is consistent with the
  // squad rather than with whatever the players were generated holding.
  for (const p of created) {
    const age = store.ageOn(p, world.year, 181);
    store.value[p] = estimateValue(store, p, age);
    store.wage[p] = Math.round((store.value[p] * 0.22) / 1000) * 1000;
  }
}

/**
 * Squad age distribution. First-choice players skew toward their prime;
 * backups skew young, because that is who a club develops.
 */
function rollSquadAge(rng: Rng, firstChoice: boolean): number {
  const mean = firstChoice ? 27.5 : 24.5;
  return Math.round(rng.gaussianClamped(mean, 4.2, 18, 38));
}

/** Foreign signings come disproportionately from strong volleyball nations. */
function pickForeignNation(rng: Rng, exclude: number): number {
  for (let attempt = 0; attempt < 12; attempt++) {
    const weights = NATIONS.map((n, i) =>
      i === exclude ? 0 : Math.pow(n.strength / 100, 3.4) * n.poolSize,
    );
    const pick = rng.weightedIndex(weights);
    if (pick !== exclude) return pick;
  }
  return exclude;
}

// ---- Staff ----------------------------------------------------------------

function hireStaff(world: World, rng: Rng, club: Club): void {
  const roles: StaffRole[] = [
    StaffRole.HeadCoach,
    StaffRole.AssistantCoach,
    StaffRole.StrengthCoach,
    StaffRole.Physiotherapist,
    StaffRole.Doctor,
    StaffRole.HeadScout,
    StaffRole.YouthCoach,
  ];
  // Wealthier clubs employ the full backroom team.
  if (club.reputation > 4000) {
    roles.push(StaffRole.PerformanceAnalyst, StaffRole.SportsPsychologist, StaffRole.Scout);
  }
  if (club.reputation > 6500) {
    roles.push(StaffRole.Scout, StaffRole.RecruitmentAnalyst);
  }

  for (const role of roles) {
    const s = generateStaff(world, rng, club.nation, role, club.reputation);
    s.clubId = club.id;
    club.staff.push(s.id);
  }
}

export function generateStaff(
  world: World,
  rng: Rng,
  nation: number,
  role: StaffRole,
  clubReputation: number,
): Staff {
  const def = NATIONS[nation];
  const bank = bankFor(def.nameGroup);
  // Staff quality tracks the club's standing, with real spread.
  const level = 4 + (clubReputation / 10000) * 11;
  const a = (bonus = 0): number =>
    Math.round(Math.min(20, Math.max(1, rng.gaussian(level + bonus, 2.8))));

  const attributes: StaffAttributes = {
    coachAttacking: a(), coachBlocking: a(), coachServing: a(), coachReception: a(),
    coachSetting: a(), coachTactical: a(), coachMental: a(), coachFitness: a(),
    judgingAbility: a(), potentialAssessment: a(),
    physiotherapy: a(), sportsScience: a(),
    manManagement: a(), discipline: a(), motivating: a(), workingWithYouth: a(),
    adaptability: a(), loyalty: a(), ambition: a(),
  };

  // Specialists are genuinely better at their own job than at everything else.
  const boost = (k: keyof StaffAttributes): void => {
    attributes[k] = Math.min(20, attributes[k] + rng.int(2, 5));
  };
  switch (role) {
    case StaffRole.StrengthCoach: boost('coachFitness'); boost('sportsScience'); break;
    case StaffRole.Doctor: boost('sportsScience'); boost('physiotherapy'); break;
    case StaffRole.Physiotherapist: boost('physiotherapy'); break;
    case StaffRole.Scout:
    case StaffRole.HeadScout: boost('judgingAbility'); boost('potentialAssessment'); break;
    case StaffRole.SportsPsychologist: boost('coachMental'); boost('manManagement'); break;
    case StaffRole.YouthCoach: boost('workingWithYouth'); break;
    case StaffRole.PerformanceAnalyst: boost('coachTactical'); break;
    case StaffRole.RecruitmentAnalyst: boost('judgingAbility'); break;
    default: boost('coachTactical'); boost('manManagement'); break;
  }

  // Regional knowledge: everyone knows their own confederation best.
  const regionKnowledge = {} as Record<Confederation, number>;
  for (const conf of ['CEV', 'CSV', 'NORCECA', 'AVC', 'CAVB'] as Confederation[]) {
    regionKnowledge[conf] = conf === def.confederation
      ? Math.round(Math.min(20, rng.gaussian(level + 3, 2.5)))
      : Math.round(Math.max(1, rng.gaussian(level - 5, 3)));
  }
  const nationKnowledge = new Map<number, number>();
  nationKnowledge.set(nation, Math.round(Math.min(20, rng.gaussian(level + 5, 2))));
  // Scouts pick up deep knowledge of a couple of other countries over a career.
  if (role === StaffRole.Scout || role === StaffRole.HeadScout) {
    for (let i = 0; i < rng.int(1, 3); i++) {
      const other = rng.int(0, NATIONS.length - 1);
      nationKnowledge.set(other, Math.round(Math.min(20, rng.gaussian(level + 2, 3))));
    }
  }

  const staff: Staff = {
    id: world.staff.length,
    firstName: rng.pick(bank.first),
    lastName: rng.pick(bank.last),
    nation,
    birthYear: world.year - rng.int(30, 63),
    role,
    clubId: -1,
    attributes,
    regionKnowledge,
    nationKnowledge,
    // Staff wages scale convexly with the club's standing. A flat floor would
    // bankrupt semi-professional clubs, whose entire annual income is smaller
    // than a top-flight club's physio budget.
    wage: Math.max(
      2_000,
      Math.round((4_000 + Math.pow(clubReputation / 10000, 1.5) * 240_000) / 1000) * 1000,
    ),
    contractUntil: world.day + rng.int(1, 3) * DAYS_PER_SEASON,
    reputation: Math.round(clubReputation * rng.range(0.7, 1.1)),
  };
  world.staff.push(staff);
  return staff;
}

// ---- National teams -------------------------------------------------------

function createNationalTeams(world: World): void {
  for (let n = 0; n < NATIONS.length; n++) {
    const team: NationalTeam = {
      nation: n,
      squad: [],
      // Seed ranking points from volleyball standing so the first world ranking
      // is plausible rather than random.
      rankingPoints: Math.round(NATIONS[n].strength * 4.2 + world.rng.gaussian(0, 12)),
      managedByUser: false,
      olympicGolds: 0,
      worldTitles: 0,
    };
    world.nationalTeams.push(team);
  }
  selectAllNationalSquads(world);
}

/**
 * Pick every national squad on merit: the best eligible players by ability,
 * subject to fielding a balanced fourteen.
 */
export function selectAllNationalSquads(world: World): void {
  const store = world.players;
  const byNation = new Map<number, number[]>();
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i)) continue;
    const n = store.nation[i];
    let list = byNation.get(n);
    if (list === undefined) {
      list = [];
      byNation.set(n, list);
    }
    list.push(i);
  }

  for (const team of world.nationalTeams) {
    const pool = byNation.get(team.nation) ?? [];
    team.squad = pickBalancedSquad(store, pool, {
      [Position.Setter]: 2,
      [Position.Opposite]: 2,
      [Position.OutsideHitter]: 4,
      [Position.MiddleBlocker]: 4,
      [Position.Libero]: 2,
    });
    for (const p of team.squad) store.setFlag(p, PlayerFlag.NationalTeam, true);
  }
}

/** Best available players filling a required positional shape. */
export function pickBalancedSquad(
  store: { position: Uint8Array; currentAbility: Uint16Array },
  pool: number[],
  shape: Record<number, number>,
): number[] {
  const out: number[] = [];
  for (const posKey of Object.keys(shape)) {
    const pos = Number(posKey);
    const candidates = pool
      .filter((p) => store.position[p] === pos)
      .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
    out.push(...candidates.slice(0, shape[pos]));
  }
  return out;
}

// ---- Continental club competitions ---------------------------------------

function createContinentalCups(world: World): void {
  const confs: Confederation[] = ['CEV', 'CSV', 'NORCECA', 'AVC', 'CAVB'];
  const names: Record<Confederation, string> = {
    CEV: 'Champions League',
    CSV: 'South American Club Championship',
    NORCECA: 'NORCECA Club Championship',
    AVC: 'Asian Club Championship',
    CAVB: 'African Club Championship',
  };

  for (const conf of confs) {
    const eligible = world.clubs
      .filter((c) => c.tier === 1 && NATIONS[c.nation].confederation === conf)
      .sort((a, b) => b.reputation - a.reputation)
      .slice(0, conf === 'CEV' ? 20 : 12);
    if (eligible.length < 4) continue;

    const comp: Competition = {
      id: world.competitions.length,
      name: names[conf],
      kind: 'continental',
      nation: -1,
      tier: 0,
      participants: eligible.map((c) => c.id),
      table: eligible.map((c) => newTableRow(c.id)),
      fixtureIds: [],
      reputation: 9500,
      promotionSlots: 0,
      relegationSlots: 0,
      hasPlayoffs: true,
      playoffTeams: 8,
      champion: -1,
      prizePool: conf === 'CEV' ? 2_500_000 : 600_000,
    };
    world.competitions.push(comp);
  }
}
