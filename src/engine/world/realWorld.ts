/**
 * The real-data world: a generated world whose top flights, where a local
 * real-data file covers them, hold the real clubs and their real rosters.
 *
 * What is real: club names, cities and halls; players' names, positions,
 * heights, birth dates and nationalities; the table order. What is estimated:
 * every ability number. A player's level comes from his league's standing in
 * the world, his club's place in the table, whether he is in his national
 * team, and his age, through the same generator every other player comes from.
 * Leagues the file does not cover are generated as always, and real national
 * team players with no club in the file take the place of a generated player
 * of their own nation and position.
 */

import { Rng } from '../core/rng.ts';
import { newFinances, type Club } from '../model/club.ts';
import { Position, SQUAD_TARGET } from '../model/positions.ts';
import { StaffRole, type Staff } from '../model/staff.ts';
import { PlayerFlag } from '../model/players.ts';
import { REAL_LOGO_URL, type RealClub, type RealDb, type RealLeague, type RealPlayer, type RealPosition } from '../../data/real/realDb.ts';
import type { CrestDesign } from '../model/club.ts';
import { NATION_BY_CODE, nationStrength } from './nations.ts';
import { generatePlayer } from './playerGen.ts';
import { abilityFractionAtAge, refreshAbility } from '../model/ability.ts';
import { ATTR_COUNT, ATTR_INDEX, PHYSICAL_ATTRS, TECHNICAL_ATTRS } from '../model/attributes.ts';
import { UNIQUE_PLAYERS } from './uniquePlayers.ts';
import { seasonEndDay, type World } from './world.ts';

const POS: Record<RealPosition, Position> = {
  S: Position.Setter, OH: Position.OutsideHitter, OP: Position.Opposite, MB: Position.MiddleBlocker, L: Position.Libero,
};

/** Real squads are lifted this share of the way from their generated level toward the target. */
const REAL_LEVEL_LIFT = 0.3;
const REAL_LEVEL_TARGET = 1600;

/**
 * The least a national-team player is worth, from his country's strength: a
 * Polish or Italian international is world class wherever he plays (about
 * 1745), a Slovenian one about 1575, a Portuguese one about 1280, and a
 * small nation's barely above its own league.
 */
export function internationalFloor(strength: number): number {
  return Math.round(Math.min(1800, 400 + strength * 14));
}

/**
 * A real player's measured reach: his vertical jump set to what it takes, at his height, to reach
 * that high (so his jumping, blocking and attacking follow it), the reach written in, his ability
 * worked out again from it.
 */
function applyRealReach(store: World['players'], idx: number, rp: RealPlayer): void {
  if (rp.spikeReachCm === null || rp.spikeReachCm < 200 || rp.spikeReachCm > 400) {
    if (rp.blockReachCm !== null) store.blockReachCm[idx] = rp.blockReachCm;
    return;
  }
  const standing = store.heightCm[idx] * 1.302;
  const [base, range] = store.women ? [44, 46] : [52, 58];
  const vj = Math.max(1, Math.min(20, Math.round(1 + ((rp.spikeReachCm - standing - base) / range) * 19)));
  store.attrs[idx * ATTR_COUNT + ATTR_INDEX.verticalJump] = vj;
  store.spikeReachCm[idx] = rp.spikeReachCm;
  store.blockReachCm[idx] = rp.blockReachCm ?? Math.round(standing + (rp.spikeReachCm - standing) * 0.78);
  refreshAbility(store, idx);
}

/**
 * What was set by hand for a real player: his strongest attributes as given,
 * then the rest brought up or down a point at a time until his ability is the
 * one set (within a few points), and his potential at least that.
 */
function applyHandSet(store: World['players'], idx: number, rp: RealPlayer): void {
  if (rp.attributes === undefined && rp.ability === undefined) return;
  const base = idx * ATTR_COUNT;
  const fixed = new Set<number>();
  for (const [name, value] of Object.entries(rp.attributes ?? {})) {
    const a = (ATTR_INDEX as Record<string, number>)[name];
    if (a === undefined) continue;
    store.attrs[base + a] = Math.max(1, Math.min(20, Math.round(value)));
    fixed.add(a);
  }
  // His jump is what his measured reach says.
  if (rp.spikeReachCm !== null) fixed.add(ATTR_INDEX.verticalJump);
  refreshAbility(store, idx);
  const target = rp.ability;
  if (target !== undefined) {
    const free = SKILL_ATTRS.filter((a) => !fixed.has(a));
    for (let step = 0; step < 400; step++) {
      const ca = store.currentAbility[idx];
      if (Math.abs(ca - target) <= 6) break;
      const up = ca < target;
      // Up: the lowest of the rest; down: the highest.
      let pick = -1;
      for (const a of free) {
        const v = store.attrs[base + a];
        if (up ? v >= 20 : v <= 1) continue;
        if (pick < 0 || (up ? v < store.attrs[base + pick] : v > store.attrs[base + pick])) pick = a;
      }
      if (pick < 0) break;
      store.attrs[base + pick] += up ? 1 : -1;
      refreshAbility(store, idx);
    }
  }
  if (rp.potential !== undefined) store.potentialAbility[idx] = Math.max(store.currentAbility[idx], rp.potential);
}

/** The physical and technical attributes, by index: what makes a player's ability. */
const SKILL_ATTRS: number[] = [...PHYSICAL_ATTRS, ...TECHNICAL_ATTRS].map((n) => ATTR_INDEX[n]);

/** A real squad's level: a little above what a generated squad of the club's standing would be, the weaker the more. */
function realLevel(generatedLevel: number): number {
  return generatedLevel + Math.max(0, REAL_LEVEL_TARGET - generatedLevel) * REAL_LEVEL_LIFT;
}

/**
 * A young real player's room to grow: his potential this many times his
 * level now, the more the younger (about +40% at 17, +20% at 20, none from 24).
 */
export function youngHeadroom(age: number): number {
  // (At most three tenths: a real first team's teenagers are prospects, not all of them stars.)
  return 1 + Math.max(0, Math.min(0.3, (24 - age) * 0.05));
}

/** The most clubs a real division is given in the game. */
const MAX_CLUBS = 16;

/** The fewest a real roster is filled up to, position by position. */
const MIN_AT: Record<Position, number> = {
  [Position.Setter]: 2, [Position.Opposite]: 2, [Position.OutsideHitter]: 4, [Position.MiddleBlocker]: 4, [Position.Libero]: 2,
};

/**
 * A league's clubs the game takes: all of them, those with no roster in the
 * source with a squad generated at their level (their place in the table).
 */
function rostered(league: RealLeague): RealClub[] {
  // Every club in the table: one the federation lists no players for still plays, its squad generated.
  return league.clubs;
}

/** His real seasons before the save, kept for his club history. */
function noteCareer(world: World, id: number, rp: RealPlayer): void {
  const before = (rp.career ?? []).filter((c) => c.year < world.startYear);
  if (before.length > 0) {
    (world.realCareers ??= {})[id] = before.map((c) => (c.apps !== undefined
      ? [c.year, c.club, c.apps, c.points ?? 0]
      : [c.year, c.club]));
  }
}

/**
 * A real player's own dice, from who he is: his estimate and his attributes come
 * out the same in every new world, whatever its seed or whoever else is in it.
 */
function playerDice(world: World, rp: RealPlayer): Rng {
  return new Rng(`real:${world.gender ?? 'men'}:${rp.first}|${rp.last}|${rp.birthYear ?? ''}`);
}

/** A potential and an ability set by hand win over the estimate. */
function handSet(rp: RealPlayer, estimated: number): { potential: number; abilityFraction?: number } {
  const potential = rp.potential ?? estimated;
  return { potential, abilityFraction: rp.ability !== undefined ? Math.min(1, rp.ability / Math.max(1, potential)) : undefined };
}

/** Lower case, no accents, letters only. */
export function personKey(first: string, last: string): string {
  return `${first} ${last}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ł/g, 'l').replace(/[^a-z]+/g, ' ').trim();
}

/** Surname and first initial: "Silva B" — catches "Bernardo" against "Bernardo J.". */
function looseKey(first: string, last: string): string {
  const k = personKey('', last);
  const f = personKey(first, '').charAt(0);
  return `${k} ${f}`;
}

/** A badge that is the real logo, served by the dev server from the local folder. */
export function logoCrest(file: string, text: string): CrestDesign {
  return { shape: 'shield', primary: '#1d2b3a', secondary: '#33475c', pattern: 'plain', text: text.slice(0, 4), image: REAL_LOGO_URL + file };
}

export class RealWorldPlan {
  /** Real clubs by the game club they became. */
  readonly clubs = new Map<number, RealClub>();
  private readonly byNation = new Map<string, RealLeague>();
  private readonly intl = new Set<string>();
  private readonly intlLoose = new Set<string>();
  /** Store indices of the real players, as opposed to the generated players filling squads out. */
  readonly realIndices = new Set<number>();
  /** Clubs whose academy is their real under-21 squad: no generated intake on top. */
  readonly realYouth = new Set<number>();
  /** The under-21s have clubs of their own: their squads are built there. */
  readonly under21Sides = true;
  /** Players whose potential was set by hand: left as set. */
  readonly handSetPotential = new Set<number>();
  /** Each real club's place in its table today, 0 the leader to 1 the last. */
  private readonly rankOf = new Map<number, number>();
  /** Each real club's players scaled by this, so the clubs line up in the order of today's table. */
  private readonly tableFactor = new Map<number, number>();
  /** Everyone placed from a club roster, so a national-team player is not added twice. */
  private readonly placed = new Set<string>();

  constructor(readonly db: RealDb) {
    // A league with rosters; or one with only its clubs and table, if it has enough of them to be a division.
    for (const l of db.leagues) {
      if (l.clubs.some((c) => c.players.length > 0) || l.clubs.length >= 4) this.byNation.set(`${l.nation}:${l.tier ?? 1}`, l);
    }
    for (const p of db.internationals) {
      this.intl.add(personKey(p.first, p.last));
      this.intlLoose.add(looseKey(p.first, p.last));
    }
  }

  /** The lowest real division the file has for a nation (0: none). */
  deepestTier(nationCode: string): number {
    let deepest = 0;
    for (const key of this.byNation.keys()) {
      const [code, tier] = key.split(':');
      if (code === nationCode) deepest = Math.max(deepest, Number(tier));
    }
    return deepest;
  }

  /** A nation's real division at a tier, when the file has one with players in it. */
  leagueFor(nationCode: string, tier: number): RealLeague | undefined {
    return this.byNation.get(`${nationCode}:${tier}`);
  }

  /**
   * Give freshly generated clubs the real clubs' identities. The strongest
   * generated club becomes the club top of the real table, and so on down;
   * clubs with no known place come after, in the file's order.
   */
  adopt(generated: Club[], league: RealLeague, world?: World, levelFor?: (reputation: number) => number): void {
    const real = rostered(league);
    const order = [...real].sort((a, b) => (a.standing ?? 99) - (b.standing ?? 99));
    const strongest = [...generated].sort((a, b) => b.reputation - a.reputation);
    for (let i = 0; i < strongest.length && i < order.length; i++) {
      const club = strongest[i];
      const rc = order[i];
      club.name = rc.name;
      club.shortName = rc.shortName;
      club.arenaName = rc.arena ?? `${rc.name} Arena`;
      if (rc.logo) club.crest = logoCrest(rc.logo, rc.shortName);
      // A fixed standing, the same in every world: its country, its division and its place in the table.
      const rank = order.length > 1 ? i / (order.length - 1) : 0;
      this.rankOf.set(club.id, rc.standing !== null ? rank : 0.5);
      const tierFactor = 1 / (1 + (club.tier - 1) * 0.68);
      const strength = Math.pow(nationStrength(club.nation) / 98, 2.6);
      // The table as it stands: its leader the favourite, its last a good deal weaker.
      club.reputation = Math.round(Math.min(10000, 10000 * strength * tierFactor * (1.16 - 0.42 * rank)));
      club.finances = newFinances(club.reputation, club.arenaCapacity);
      this.clubs.set(club.id, rc);
    }
    if (world !== undefined && levelFor !== undefined) this.planTable(world, strongest.slice(0, order.length), levelFor);
  }

  /**
   * Line the division's clubs up in the order of today's table: each club's
   * strength (the average of its best seven) as its players would come out,
   * then a target falling from the leader's down to the last's, and the factor
   * that takes each club to its target. The leader is the strongest, whatever
   * internationals the others have; the gap from first to last stays between
   * an eighth and three tenths; nobody passes the ceiling.
   */
  private planTable(world: World, clubs: Club[], levelFor: (reputation: number) => number): void {
    const natural = clubs.map((club) => {
      const rc = this.clubs.get(club.id)!;
      const level = realLevel(levelFor(club.reputation));
      const values = rc.players.filter((rp) => rp.first !== '' || rp.last !== '')
        .map((rp) => this.estimate(world, rp, club.nation, level).now);
      // Short of seven: the generated ones (squad players, or the whole squad where there is no roster).
      const fill = rc.players.length === 0 ? level : level * 0.8;
      while (values.length < 7) values.push(fill);
      const best = values.sort((a, b) => b - a).slice(0, 7);
      return best.reduce((s, v) => s + v, 0) / best.length;
    });
    const top = Math.min(1860, Math.max(...natural));
    const bottom = Math.max(top * 0.7, Math.min(top * 0.88, Math.min(...natural)));
    clubs.forEach((club, i) => {
      const rank = this.rankOf.get(club.id) ?? 0.5;
      const target = top - (top - bottom) * rank;
      this.tableFactor.set(club.id, target / Math.max(1, natural[i]));
    });
  }

  /**
   * The last word on today's table: in each real division, from the top down,
   * a club that came out as strong as the one above it (the generator's dice
   * on attributes) gives up an attribute point at a time from its best players
   * until it is just behind. Only ever downwards, only as much as needed.
   */
  lineUpTables(world: World): number {
    const store = world.players;
    const strength = (club: Club): { avg: number; best: number[] } => {
      const best = [...club.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 7);
      return { avg: best.reduce((s, p) => s + store.currentAbility[p], 0) / Math.max(1, best.length), best };
    };
    let nudged = 0;
    const byLeague = new Map<number, Club[]>();
    for (const [id, rc] of this.clubs) {
      const club = world.clubs[id];
      if (club === undefined || rc.standing === null || club.under21Of !== undefined) continue;
      byLeague.set(club.leagueId, [...(byLeague.get(club.leagueId) ?? []), club]);
    }
    for (const clubs of byLeague.values()) {
      clubs.sort((a, b) => (this.rankOf.get(a.id) ?? 0.5) - (this.rankOf.get(b.id) ?? 0.5));
      for (let i = 1; i < clubs.length; i++) {
        const above = strength(clubs[i - 1]).avg;
        for (let step = 0; step < 400; step++) {
          const { avg, best } = strength(clubs[i]);
          if (avg < above - 4) break;
          // The best of them, his strongest attribute, one point down.
          const p = best[step % best.length];
          const base = p * ATTR_COUNT;
          let top = 0;
          for (let a = 1; a < ATTR_COUNT; a++) if (store.attrs[base + a] > store.attrs[base + top]) top = a;
          if (store.attrs[base + top] <= 1) continue;
          store.attrs[base + top]--;
          refreshAbility(store, p);
          nudged++;
        }
      }
    }
    return nudged;
  }

  /**
   * A real player's estimate before his club's place in the table: the club's
   * level, more for a national-team player (at least his country's floor), and
   * his own spread; `now` is what he has reached of it (a teenager at least 80%).
   */
  private estimate(world: World, rp: RealPlayer, clubNation: number, level: number): { estimated: number; now: number; young: boolean; age: number; international: boolean } {
    const nation = rp.nation !== null ? (NATION_BY_CODE.get(rp.nation) ?? clubNation) : clubNation;
    const age = rp.birthYear !== null ? Math.max(15, Math.min(45, world.year - rp.birthYear)) : 25;
    const international = this.isInternational(rp.first, rp.last);
    const young = world.year - (rp.birthYear ?? 0) <= 20;
    const lift = international ? 1.13 : young ? 1.08 : 1;
    const spread = playerDice(world, rp).gaussianClamped(1, 0.07, 0.8, 1.22);
    let estimated = Math.min(1980, level * lift * spread);
    if (international) {
      const floor = internationalFloor(nationStrength(nation)) * Math.min(1.08, Math.max(0.94, spread));
      estimated = Math.min(1980, Math.max(estimated, floor));
    }
    const now = young ? estimated * Math.max(abilityFractionAtAge(age), 0.8) : estimated;
    return { estimated, now, young, age, international };
  }

  /** Real clubs with players to sign, in a league: how many game clubs it needs. */
  clubCount(league: RealLeague): number {
    // A division merged from regional groups can run long: the top of each table, up to a full division.
    return Math.min(MAX_CLUBS, rostered(league).length);
  }

  /**
   * The real head coach and assistants, written over the generated ones; an assistant more than
   * the club had is taken on (by `hire`) to be him.
   */
  nameStaff(world: World, club: Club, rc: RealClub, hire: (role: StaffRole) => Staff): void {
    const used = new Set<number>();
    for (const coach of rc.coaches ?? []) {
      const role = coach.role === 'head' ? StaffRole.HeadCoach : StaffRole.AssistantCoach;
      let s = club.staff.map((id) => world.staff[id]).find((x) => x !== undefined && x.role === role && !used.has(x.id));
      if (s === undefined && role === StaffRole.AssistantCoach) s = hire(role);
      if (s === undefined) continue;
      used.add(s.id);
      s.firstName = coach.first;
      s.lastName = coach.last;
      if (coach.photo) (world.realStaffPhotos ??= {})[s.id] = coach.photo;
    }
  }

  isInternational(first: string, last: string): boolean {
    return this.intl.has(personKey(first, last)) || this.intlLoose.has(looseKey(first, last));
  }

  /**
   * A real club's squad: its real roster, then generated players for any
   * position it is short of. Returns the store indices.
   */
  buildSquad(world: World, rng: Rng, club: Club, rc: RealClub, generatedLevel: number): number[] {
    const store = world.players;
    // Real players a little above what a generated squad of the club's standing would be, and the
    // weaker the league the more: a real roster in a small league is not as thin as a made-up one.
    const level = realLevel(generatedLevel);
    // Its place in today's table: the factor that lines the division up (see planTable).
    const tableLift = this.tableFactor.get(club.id) ?? 1.07 - 0.14 * (this.rankOf.get(club.id) ?? 0.5);
    const created: number[] = [];
    const count = new Map<Position, number>();
    const need = (): Position => {
      let best = Position.OutsideHitter;
      let gap = -99;
      for (const pos of Object.keys(MIN_AT).map(Number) as Position[]) {
        const g = MIN_AT[pos] - (count.get(pos) ?? 0);
        if (g > gap) { gap = g; best = pos; }
      }
      return best;
    };

    // The club's real under-21 list, those too old for the side this season (born before 2006 for 2026/27): first team.
    const overAge = (rc.youth ?? []).filter((rp) => rp.birthYear !== null && world.year - rp.birthYear > 20);
    for (const rp of [...rc.players, ...overAge]) {
      if (rp.first === '' && rp.last === '') continue;
      const position = rp.position !== null ? POS[rp.position] : need();
      const nation = rp.nation !== null ? (NATION_BY_CODE.get(rp.nation) ?? club.nation) : club.nation;
      // The estimate (see estimate): the club's level, more for a national-team player; a youngster on a
      // real first-team roster is there because he is good already. Then the club's place in today's table.
      const { estimated: raw, young, age } = this.estimate(world, rp, club.nation, level);
      const own = playerDice(world, rp);
      own.gaussianClamped(1, 0.07, 0.8, 1.22);
      const estimated = Math.round(Math.min(1980, raw * tableLift));
      const height = rp.heightCm !== null && rp.heightCm >= 150 && rp.heightCm <= 230 ? rp.heightCm : undefined;
      // A young one: his level now as estimated, and room above it to grow into.
      const headroom = youngHeadroom(age);
      const set = handSet(rp, Math.round(Math.min(1980, estimated * headroom)));
      const potential = set.potential;
      // His level now as before (a teenager most of the way there, at least 80%); the room above it is new.
      const now = young ? estimated * Math.max(abilityFractionAtAge(age), 0.8) : estimated;
      // The estimate is his level now, at any age: all of it reached from 24 on.
      const abilityFraction = set.abilityFraction ?? (headroom > 1 ? Math.min(1, now / Math.max(1, potential)) : 1);

      const idx = generatePlayer(store, own, { nation, age, potential, position, currentYear: world.year, heightCm: height, abilityFraction });
      this.realIndices.add(idx);
      store.firstName[idx] = store.names.intern(rp.first);
      store.lastName[idx] = store.names.intern(rp.last);
      store.nation2[idx] = store.nation[idx];
      if (rp.birthYear !== null) store.birthYear[idx] = rp.birthYear;
      if (rp.birthDay !== null) store.birthDay[idx] = rp.birthDay;
      if (rp.weightKg !== null) store.weightKg[idx] = rp.weightKg;
      applyRealReach(store, idx, rp);
      applyHandSet(store, idx, rp);
      if (rp.potential !== undefined) this.handSetPotential.add(idx);
      if (rp.secondary) {
        store.secondary[idx] = POS[rp.secondary];
        store.setFamiliarity(idx, POS[rp.secondary], 100);
      }
      store.clubId[idx] = club.id;
      store.contractUntil[idx] = seasonEndDay(world.season + rng.int(0, 2));
      if (rp.photo) (world.realPhotos ??= {})[store.id[idx]] = rp.photo;
      noteCareer(world, store.id[idx], rp);
      count.set(position, (count.get(position) ?? 0) + 1);
      this.placed.add(personKey(rp.first, rp.last));
      this.placed.add(looseKey(rp.first, rp.last));
      created.push(idx);
    }

    // The under-21s play for the club's under-21 side (see buildUnder21Squad), not in its academy.
    for (const rp of this.under21Sides ? [] : rc.youth ?? []) {
      if (rp.first === '' && rp.last === '') continue;
      const position = rp.position !== null ? POS[rp.position] : Position.OutsideHitter;
      const nation = rp.nation !== null ? (NATION_BY_CODE.get(rp.nation) ?? club.nation) : club.nation;
      const age = rp.birthYear !== null ? Math.max(14, Math.min(23, world.year - rp.birthYear)) : 18;
      const own = playerDice(world, rp);
      const estimated = Math.round(Math.min(1980, level * own.gaussianClamped(0.95, 0.12, 0.6, 1.35)));
      const height = rp.heightCm !== null && rp.heightCm >= 150 && rp.heightCm <= 230 ? rp.heightCm : undefined;
      const { potential, abilityFraction } = handSet(rp, estimated);
      const idx = generatePlayer(store, own, { nation, age, potential, position, currentYear: world.year, heightCm: height, isRegen: true, abilityFraction });
      store.firstName[idx] = store.names.intern(rp.first);
      store.lastName[idx] = store.names.intern(rp.last);
      if (rp.birthYear !== null) store.birthYear[idx] = rp.birthYear;
      if (rp.birthDay !== null) store.birthDay[idx] = rp.birthDay;
      store.clubId[idx] = club.id;
      store.setFlag(idx, PlayerFlag.Youth, true);
      store.contractUntil[idx] = seasonEndDay(world.season + rng.int(1, 3));
      store.wage[idx] = Math.round(8_000 + (club.reputation / 10000) * 30_000);
      if (rp.photo) (world.realPhotos ??= {})[store.id[idx]] = rp.photo;
      club.youthPlayers.push(idx);
      this.placed.add(personKey(rp.first, rp.last));
    }
    if (!this.under21Sides && (rc.youth ?? []).length > 0) this.realYouth.add(club.id);

    // Short of a position: someone generated, a squad player rather than a starter; with no real
    // roster at all, the whole squad generated at the club's level (its place in the real table).
    const fill = rc.players.length === 0 ? 1 : 0.8;
    for (const pos of Object.keys(MIN_AT).map(Number) as Position[]) {
      while ((count.get(pos) ?? 0) < Math.min(MIN_AT[pos], SQUAD_TARGET[pos])) {
        // A club with no real roster: a squad of its level, close together and in its prime, so its place
        // in today's table decides how strong it is, not the dice.
        const whole = fill === 1;
        const age = Math.round(whole ? rng.gaussianClamped(27, 2, 24, 30) : rng.gaussianClamped(23, 3.5, 18, 33));
        const potential = Math.round(Math.min(1980, level * fill * tableLift * (whole ? rng.gaussianClamped(1, 0.04, 0.9, 1.1) : rng.gaussianClamped(1, 0.1, 0.7, 1.2))));
        const idx = generatePlayer(store, rng, { nation: club.nation, age, potential, position: pos, currentYear: world.year, abilityFraction: whole ? 1 : undefined });
        store.clubId[idx] = club.id;
        store.contractUntil[idx] = seasonEndDay(world.season + rng.int(0, 2));
        count.set(pos, (count.get(pos) ?? 0) + 1);
        created.push(idx);
      }
    }
    return created;
  }

  /**
   * A player written into the game by hand who is also on a real roster is
   * that one: the key points at the real player, and no second copy is made
   * as a free agent.
   */
  /** The national teams' real head coaches. */
  nameNationalCoaches(world: World): void {
    for (const c of this.db.nationalCoaches ?? []) {
      const n = NATION_BY_CODE.get(c.nation);
      if (n !== undefined) (world.realNationalCoaches ??= {})[n] = `${c.first} ${c.last}`;
    }
  }

  claimUniques(world: World): void {
    const store = world.players;
    for (const def of UNIQUE_PLAYERS) {
      if (world.uniquePlayers?.[def.key] !== undefined) continue;
      const key = personKey(def.firstName, def.lastName);
      for (let i = 0; i < store.count; i++) {
        if (!this.clubs.has(store.clubId[i]) || store.birthYear[i] !== def.born[0]) continue;
        if (personKey(store.names.get(store.firstName[i]), store.names.get(store.lastName[i])) !== key) continue;
        (world.uniquePlayers ??= {})[def.key] = i;
        break;
      }
    }
  }

  /**
   * An under-21 side's squad: its real under-21 roster where the file has one,
   * filled out to a full squad with generated players of 17 to 21. They are
   * first-team players here, judged against the senior club's level.
   */
  buildUnder21Squad(world: World, rng: Rng, club: Club, senior: RealClub | undefined, seniorLevel: number): number[] {
    const store = world.players;
    const level = seniorLevel + Math.max(0, REAL_LEVEL_TARGET - seniorLevel) * REAL_LEVEL_LIFT;
    const created: number[] = [];
    const count = new Map<Position, number>();
    // No under-21 starts better than any of the senior club's grown men: below the weakest of them.
    const firstTeam = club.under21Of !== undefined ? world.clubs[club.under21Of] : undefined;
    // The real ones: generated fill-ins differ from world to world, and the ceiling must not.
    const grown = (firstTeam?.players ?? []).filter((p) => world.year - store.birthYear[p] > 20 && this.realIndices.has(p));
    const ceiling = grown.length > 0 ? Math.min(...grown.map((p) => store.currentAbility[p])) - 50 : Infinity;
    const capped = (potential: number, age: number, fraction?: number): number | undefined => {
      const f = fraction ?? abilityFractionAtAge(age);
      return potential * f > ceiling ? Math.max(0.2, ceiling / Math.max(1, potential)) : fraction;
    };
    for (const rp of senior?.youth ?? []) {
      if (rp.first === '' && rp.last === '') continue;
      // Too old for the under-21s this season (born before 2006 for 2026/27): not on this side.
      if (rp.birthYear !== null && world.year - rp.birthYear > 20) continue;
      const position = rp.position !== null ? POS[rp.position] : Position.OutsideHitter;
      const nation = rp.nation !== null ? (NATION_BY_CODE.get(rp.nation) ?? club.nation) : club.nation;
      const age = rp.birthYear !== null ? Math.max(15, Math.min(20, world.year - rp.birthYear)) : 19;
      const own = playerDice(world, rp);
      const estimated = Math.round(Math.min(1980, level * own.gaussianClamped(0.95, 0.12, 0.6, 1.35)));
      const height = rp.heightCm !== null && rp.heightCm >= 150 && rp.heightCm <= 230 ? rp.heightCm : undefined;
      const set = handSet(rp, estimated);
      const potential = set.potential;
      // A hand-set ability is the user's word; the estimate stays below the first team.
      const abilityFraction = rp.ability !== undefined ? set.abilityFraction : capped(potential, age, set.abilityFraction);
      const idx = generatePlayer(store, own, { nation, age, potential, position, currentYear: world.year, heightCm: height, abilityFraction });
      store.firstName[idx] = store.names.intern(rp.first);
      store.lastName[idx] = store.names.intern(rp.last);
      if (rp.birthYear !== null) store.birthYear[idx] = rp.birthYear;
      if (rp.birthDay !== null) store.birthDay[idx] = rp.birthDay;
      applyRealReach(store, idx, rp);
      applyHandSet(store, idx, rp);
      if (rp.potential !== undefined) this.handSetPotential.add(idx);
      if (rp.secondary) {
        store.secondary[idx] = POS[rp.secondary];
        store.setFamiliarity(idx, POS[rp.secondary], 100);
      }
      store.clubId[idx] = club.id;
      store.contractUntil[idx] = seasonEndDay(world.season + rng.int(0, 2));
      if (rp.photo) (world.realPhotos ??= {})[store.id[idx]] = rp.photo;
      noteCareer(world, store.id[idx], rp);
      count.set(position, (count.get(position) ?? 0) + 1);
      this.placed.add(personKey(rp.first, rp.last));
      created.push(idx);
    }
    // The senior club's own under-21s play for this side too (see matchSquadClub): they count.
    const seniorClub = club.under21Of !== undefined ? world.clubs[club.under21Of] : undefined;
    for (const p of seniorClub?.players ?? []) {
      if (world.year - store.birthYear[p] <= 20) count.set(store.position[p] as Position, (count.get(store.position[p] as Position) ?? 0) + 1);
    }
    // A full squad: generated youngsters only where the real ones leave a position short.
    for (const pos of Object.keys(SQUAD_TARGET).map(Number) as Position[]) {
      while ((count.get(pos) ?? 0) < SQUAD_TARGET[pos] - 1) {
        const age = rng.int(16, 20);
        const potential = Math.round(Math.min(1980, level * rng.gaussianClamped(0.9, 0.12, 0.6, 1.3)));
        const idx = generatePlayer(store, rng, { nation: club.nation, age, potential, position: pos, currentYear: world.year, abilityFraction: capped(potential, age) });
        store.clubId[idx] = club.id;
        store.contractUntil[idx] = seasonEndDay(world.season + rng.int(0, 2));
        count.set(pos, (count.get(pos) ?? 0) + 1);
        created.push(idx);
      }
    }
    return created;
  }

  /**
   * National-team players who have no club in the file: each takes the place
   * of the best generated player of his nation and position not yet taken, so
   * every squad keeps its shape. Returns how many were written in.
   */
  placeInternationals(world: World): number {
    const store = world.players;
    const realClub = this.clubs;
    const taken = new Set<number>();
    let placed = 0;
    for (const p of this.db.internationals) {
      if (this.placed.has(personKey(p.first, p.last)) || this.placed.has(looseKey(p.first, p.last))) continue;
      const nation = NATION_BY_CODE.get(p.nation);
      if (nation === undefined) continue;
      const pos = p.position !== null ? POS[p.position] : undefined;
      let best = -1;
      for (let i = 0; i < store.count; i++) {
        if (!store.isActive(i) || store.nation[i] !== nation || taken.has(i)) continue;
        if (pos !== undefined && store.position[i] !== pos) continue;
        const club = store.clubId[i];
        if (club < 0 || realClub.has(club)) continue;
        if (best < 0 || store.currentAbility[i] > store.currentAbility[best]) best = i;
      }
      if (best < 0) continue;
      store.firstName[best] = store.names.intern(p.first);
      store.lastName[best] = store.names.intern(p.last);
      if (p.birthYear !== undefined) store.birthYear[best] = p.birthYear;
      if (p.birthDay !== undefined) store.birthDay[best] = p.birthDay;
      if (p.heightCm !== undefined) store.heightCm[best] = p.heightCm;
      taken.add(best);
      placed++;
    }
    return placed;
  }
}
