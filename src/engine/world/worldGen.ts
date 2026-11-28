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

import { UNDER21_DIV2_TIER, UNDER21_TIER } from './under21Leagues.ts';
import { addUniquePlayers } from './uniquePlayers.ts';
import { seedChemistry } from './chemistry.ts';
import { planInternationals } from './internationals.ts';
import { Rng } from '../core/rng.ts';
import {
  newClub, newFinances, newTableRow, type Club,
} from '../model/club.ts';
import { AGEING_RESISTANCE } from '../model/ability.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position, SQUAD_TARGET } from '../model/positions.ts';
import { StaffRole, type Staff, type StaffAttributes } from '../model/staff.ts';
import { defaultTactics } from '../match/tactics.ts';
import { cityBankFor } from './cities.ts';
import { bankFor } from './names.ts';
import { NATIONS, nationStrength, setNationsGame, type Confederation } from './nations.ts';
import { estimateValue, generatePlayer } from './playerGen.ts';
import { generateYouthIntake } from './progression.ts';
import { ensureCupCompetitions } from '../season/cups.ts';
import { balanceRelegationSlots, divisionSize } from '../season/pyramid.ts';
import { seedClubHistories } from './clubHistory.ts';
import { logoCrest, RealWorldPlan } from './realWorld.ts';
import type { RealDb } from '../../data/real/realDb.ts';
import {
  contractEndSeason, newWorld, seasonEndDay, type Competition, type ManagerProfile, type NationalTeam, type World,
} from './world.ts';

export type WorldScale = 'small' | 'standard' | 'large';

export interface WorldGenOptions {
  seed: number;
  startYear: number;
  scale: WorldScale;
  manager: ManagerProfile;
  /** The men's game or the women's. Absent: the men's. */
  gender?: 'men' | 'women';
  /**
   * A local real-data file: the top flights it covers get the real clubs and
   * rosters, the rest of the world is generated as always. Men's game only.
   */
  real?: RealDb;
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

/**
 * Every player of 20 or under, the world over, a little more potential: most
 * a good step up (6 to 15%), a few a lot more (up to about 28%), the same for
 * each player in every new world. A share of what he has, so the strongest
 * leagues' and clubs' prospects stay the strongest. A hand-set one is left be.
 */
function liftYoungPotential(world: World, handSet?: ReadonlySet<number>): void {
  const store = world.players;
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || handSet?.has(i) === true) continue;
    if (store.ageOn(i, world.year, 181) > 20) continue;
    // A number in [0, 1) from the player himself, not the world's dice.
    let h = Math.imul(store.id[i] ^ 0x51ed27, 0x2c1b3c6d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 13;
    const u = (h >>> 0) / 4294967296;
    const pa = store.potentialAbility[i];
    // The more he already has ahead of him, the less is added: the stars stay few.
    const lift = (0.06 + 0.22 * u * u) * Math.max(0.3, 1 - Math.max(0, pa - 1200) / 1000);
    store.potentialAbility[i] = Math.max(store.currentAbility[i], Math.min(1980, Math.round(pa * (1 + lift))));
  }
}

/**
 * A club's wage budget covers the squad it starts with, and a little over for
 * the rises its renewals bring: where a squad came out dearer than its club's
 * standing pays for (a real roster full of internationals, say), the sponsor
 * makes up the difference, so it does not come out of the balance.
 */
const STARTING_WAGE_MARGIN = 1.08;
function fundSquads(world: World): void {
  for (const club of world.clubs) {
    if (club.players.length === 0) continue;
    const bill = club.players.reduce((sum, p) => sum + world.players.wage[p], 0);
    const need = Math.round(bill * STARTING_WAGE_MARGIN);
    const f = club.finances;
    if (f.wageBudget >= need) continue;
    const short = need - f.wageBudget;
    f.wageBudget = need;
    // Next season's budget is drawn from income (rollover.ts): the sponsor pays for it.
    f.sponsorshipIncome += Math.round(short / 0.7);
  }
}

/** Clubs per division, by tier. Top flights are smaller than lower ones. */
function clubsPerDivision(tier: number, rng: Rng): number {
  const [lo, hi] = divisionSize(tier);
  return rng.int(lo, hi);
}

export function generateWorld(opts: WorldGenOptions): World {
  const world = newWorld(opts.seed, opts.startYear, opts.manager);
  // The women's game: its players, its nations' standing.
  const gender = opts.gender ?? 'men';
  if (gender === 'women') world.gender = 'women';
  world.gateBooked = true;
  world.fivbCalendarFrom = 0;
  world.players.women = gender === 'women';
  setNationsGame(gender);
  const rng = world.rng;
  const usedNames = new Set<string>();
  const real = opts.real !== undefined && opts.real.gender === gender ? new RealWorldPlan(opts.real) : null;
  if (real !== null) world.realData = true;

  for (let n = 0; n < NATIONS.length; n++) {
    const nation = NATIONS[n];
    // As deep as the real divisions go, at least; a real division is one league, not regional groups.
    const shape = pyramidShape(nation.poolSize, Math.max(nation.leagueTiers, real?.deepestTier(nation.code) ?? 0), opts.scale)
      .map((groups, t) => (real?.leagueFor(nation.code, t + 1) !== undefined ? 1 : groups));
    let realTop: Club[] | null = null;

    for (let t = 0; t < shape.length; t++) {
      const tier = t + 1;
      for (let g = 0; g < shape[t]; g++) {
        // A real division where the file has one.
        const realLeague = shape[t] === 1 ? real?.leagueFor(nation.code, tier) : undefined;
        const size = realLeague !== undefined ? real!.clubCount(realLeague) : clubsPerDivision(tier, rng);
        const comp = createLeague(world, n, tier, g, shape[t], size);
        if (realLeague !== undefined) {
          comp.name = `${nation.name} ${realLeague.name}`;
          if (realLeague.logo) comp.logo = logoCrest(realLeague.logo, realLeague.name.slice(0, 3).toUpperCase());
        }

        const made: Club[] = [];
        for (let c = 0; c < size; c++) {
          const club = createClub(world, rng, n, tier, usedNames);
          club.leagueId = comp.id;
          comp.participants.push(club.id);
          comp.table.push(newTableRow(club.id));
          made.push(club);
        }
        if (realLeague !== undefined) real!.adopt(made, realLeague, world, squadLevelFor);
        if (realLeague !== undefined && tier === 1) realTop = made;
      }
    }
    // The under-21 divisions, once every club of the nation exists.
    if (real !== null) createUnder21Divisions(world, rng, n, usedNames, real, realTop);
  }

  // As many places down from each division as there are up from the one below.
  balanceRelegationSlots(world);

  // Squads are built after every club exists, so that foreign signings can be
  // drawn from the whole world rather than from whatever was created first.
  // The veterans' long careers come from dice of their own.
  const veterans = new Rng(opts.seed ^ 0x01d_ca9e);
  for (const club of world.clubs) {
    const rc = real?.clubs.get(club.id);
    if (club.under21Of !== undefined && real !== null) {
      const senior = world.clubs[club.under21Of];
      finishSquad(world, club, real.buildUnder21Squad(world, rng, club, real.clubs.get(senior.id), squadLevelFor(senior.reputation)));
    } else if (rc !== undefined) finishSquad(world, club, real!.buildSquad(world, rng, club, rc, squadLevelFor(club.reputation)));
    else buildSquad(world, rng, club, veterans);
    hireStaff(world, rng, club);
    if (rc !== undefined) {
      real!.nameStaff(world, club, rc, (role) => {
        const s = generateStaff(world, rng, club.nation, role, club.reputation);
        s.clubId = club.id;
        club.staff.push(s.id);
        return s;
      });
    }
  }
  // National-team players with no club in the file, in place of generated ones.
  real?.placeInternationals(world);
  // Each real division in the order of today's table, the leader the strongest.
  real?.lineUpTables(world);
  // The under-21s with more ahead of them.
  liftYoungPotential(world, real?.handSetPotential);
  // Every club can pay the squad it starts with.
  fundSquads(world);

  // Every club starts with an academy — two years' intakes, from dice of their
  // own so the rest of the world comes out as it always has.
  const academies = new Rng(opts.seed ^ 0x5eed_ac4d);
  generateYouthIntake(world, academies, real?.realYouth);
  generateYouthIntake(world, academies, real?.realYouth);

  // Where every senior player has been before.
  seedClubHistories(world, 0);

  createNationalTeams(world);
  ensureCupCompetitions(world);
  // The national teams' first summer, on the calendar from day one.
  planInternationals(world);
  // Every squad has trained together: its setters and hitters know each other.
  seedChemistry(world);
  // The real players written into the game, free agents to begin with, unless a real roster already has him.
  real?.claimUniques(world);
  real?.nameNationalCoaches(world);
  addUniquePlayers(world);

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
  const groupSuffix = groupCount > 1 ? `, Group ${String.fromCharCode(65 + group)}` : '';

  const reputation = Math.round(
    nationStrength(nation) * 95 * (1 / (1 + (tier - 1) * 0.62)),
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
    playoffGroups: [],
  };
  world.competitions.push(comp);
  void size;
  return comp;
}

// ---- Under-21 sides ----------------------------------------------------------

/** The tier an under-21 league sits at: off the bottom of every pyramid, which leaves it out (see under21Leagues.ts). */
export { UNDER21_TIER };

/**
 * A nation's under-21 divisions. Where the federation says which division each
 * club's under-21 side plays in, those: the first and second divisions with
 * their real clubs, whatever senior division each is in. Otherwise beside a
 * real top flight, its clubs' sides, and below them the best of the second tier.
 */
function createUnder21Divisions(world: World, rng: Rng, nation: number, usedNames: Set<string>, real: RealWorldPlan, realTop: Club[] | null): void {
  const clubs = world.clubs.filter((c) => c.nation === nation && c.under21Of === undefined);
  const inDivision = (d: 1 | 2): Club[] => clubs
    .filter((c) => real.clubs.get(c.id)?.under21Division === d)
    .sort((a, b) => world.competitions[a.leagueId].tier - world.competitions[b.leagueId].tier || b.reputation - a.reputation);
  const first = inDivision(1);
  if (first.length >= 4) {
    createUnder21League(world, rng, nation, first, usedNames, real);
    const second = inDivision(2).slice(0, UNDER21_DIV2_SIZE * 2);
    if (second.length >= 4) createUnder21League(world, rng, nation, second, usedNames, real, UNDER21_DIV2_TIER);
    else createUnder21SecondDivision(world, rng, nation, usedNames);
    return;
  }
  if (realTop === null) return;
  createUnder21League(world, rng, nation, realTop, usedNames, real);
  createUnder21SecondDivision(world, rng, nation, usedNames);
}

/** Under-21 sides in a second division: at most this many, the strongest clubs of the senior tier below first. */
const UNDER21_DIV2_SIZE = 12;

/**
 * The U21 second division, where a nation has a first: the under-21 sides of
 * the best clubs in its second senior tier, as many as the first division has
 * (at most twelve). Promotion and relegation between the two: under21Leagues.ts.
 */
function createUnder21SecondDivision(world: World, rng: Rng, nation: number, usedNames: Set<string>): void {
  const first = world.competitions.find((c) => c.under21 === true && c.nation === nation && c.tier === UNDER21_TIER);
  if (first === undefined) return;
  const seniors = world.clubs
    .filter((c) => c.nation === nation && c.under21Of === undefined && world.competitions[c.leagueId]?.tier === 2)
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, Math.min(UNDER21_DIV2_SIZE, Math.max(4, first.participants.length)));
  if (seniors.length < 4) return;
  createUnder21League(world, rng, nation, seniors, usedNames, null, UNDER21_DIV2_TIER);
}

function createUnder21League(
  world: World, rng: Rng, nation: number, seniors: Club[], usedNames: Set<string>, real: RealWorldPlan | null, tier = UNDER21_TIER,
): void {
  const top = world.competitions[seniors[0]?.leagueId ?? -1];
  if (top === undefined) return;
  const comp = createLeague(world, nation, tier, 0, 1, seniors.length);
  comp.name = tier === UNDER21_TIER ? `${NATIONS[nation].name} U21` : `${NATIONS[nation].name} U21 Second Division`;
  comp.under21 = true;
  comp.reputation = Math.round(top.reputation * 0.3);
  comp.promotionSlots = 0;
  comp.relegationSlots = 0;
  comp.hasPlayoffs = false;
  comp.prizePool = Math.round(top.prizePool * 0.05);
  for (const senior of seniors) {
    const club = createClub(world, rng, nation, tier, usedNames);
    club.name = `${senior.name} U21`;
    club.shortName = senior.shortName;
    club.under21Of = senior.id;
    if (senior.crest !== undefined) club.crest = senior.crest;
    club.arenaName = senior.arenaName;
    club.reputation = Math.round(senior.reputation * 0.35);
    club.arenaCapacity = Math.round(Math.min(senior.arenaCapacity, 300 + senior.arenaCapacity * 0.15));
    club.finances = newFinances(club.reputation, club.arenaCapacity);
    club.leagueId = comp.id;
    comp.participants.push(club.id);
    comp.table.push(newTableRow(club.id));
    (senior.affiliates ??= []).push(club.id);
    void real;
  }
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
  const strengthCurve = Math.pow(nationStrength(nation) / 98, 2.6);
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

function buildSquad(world: World, rng: Rng, club: Club, veterans: Rng): void {
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
      const age = lateCareer(rollSquadAge(rng, i === 0), posKey, veterans);
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
      // Whoever is still playing this late always meant to go on — and past 43, nothing will stop him.
      if (age >= 38) store.setAttr(idx, 'retirementPreference', age > OLDEST_AT_START ? 20 : Math.max(store.getAttr(idx, 'retirementPreference'), veterans.int(12, 18)));
      store.clubId[idx] = club.id;
      store.contractUntil[idx] = seasonEndDay(world.season + rng.int(0, 3));
      created.push(idx);
    }
  }

  void nationDef;
  finishSquad(world, club, created);
}

/** A built squad on the club's books: its preferred six and libero, and wages to match. */
function finishSquad(world: World, club: Club, created: number[]): void {
  const store = world.players;
  club.players = created;

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

  club.preferredLineup = [s[0], oh[0], mb[0], o[0], oh[1], mb[1]];
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

/** The oldest anyone usually is at the start; in the game itself a few go on a year or two longer. */
const OLDEST_AT_START = 43;
/** How often one who gets that far is the exception of exceptions, still playing towards 50. */
const LEGEND_CHANCE = 0.08;

/**
 * The few still going in their late thirties and forties. Everyone the dice
 * put at 36 or more gets there a year at a time, the way the ones built to
 * last do — setters and liberos far more often than opposites, and fewer and
 * fewer past 40. Now and then one simply keeps going.
 */
function lateCareer(age: number, pos: Position, veterans: Rng): number {
  if (age < 36) return age;
  const carryOn = 0.78 - AGEING_RESISTANCE[pos] * 0.22;
  let at = 36;
  while (at < OLDEST_AT_START && veterans.chance(carryOn - Math.max(0, at - 39) * 0.06)) at++;
  if (at === OLDEST_AT_START && veterans.chance(LEGEND_CHANCE)) {
    while (at < 50 && veterans.chance(0.6)) at++;
  }
  return at;
}

/** Foreign signings come disproportionately from strong volleyball nations. */
function pickForeignNation(rng: Rng, exclude: number): number {
  for (let attempt = 0; attempt < 12; attempt++) {
    const weights = NATIONS.map((n, i) =>
      i === exclude ? 0 : Math.pow(nationStrength(i) / 100, 3.4) * n.poolSize,
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
    case StaffRole.DirectorOfFootball: boost('manManagement'); boost('judgingAbility'); break;
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
    // To 30 June, like a player's: this season's, or one of the next two.
    contractUntil: seasonEndDay(contractEndSeason(world.day) + rng.int(0, 2)),
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
      rankingPoints: Math.round(nationStrength(n) * 4.2 + world.rng.gaussian(0, 12)),
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
