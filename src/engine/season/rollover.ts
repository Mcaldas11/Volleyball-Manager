/**
 * The season rollover.
 *
 * Everything that happens between the last match of one season and the first
 * of the next: titles awarded, clubs promoted and relegated, books balanced,
 * players developed and aged, careers ended, a new generation brought in, and
 * the transfer market run.
 *
 * This is the function that has to hold up fifty times in a row. Any bias here
 * compounds — if relegation is slightly too punishing or youth intake slightly
 * too generous, the world will have visibly drifted by season twenty.
 */

import { compareTableRows, type Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position, SQUAD_TARGET } from '../model/positions.ts';
import {
  applyAgeing, generateYouthIntake, processRetirements, revalueSquads, revisePotential,
} from '../world/progression.ts';
import { selectAllNationalSquads } from '../world/worldGen.ts';
import {
  DAYS_PER_SEASON, type HallOfFameEntry, type SeasonRecord, type World,
} from '../world/world.ts';
import { startSeason, type SeasonContext } from './seasonEngine.ts';

export interface RolloverReport {
  season: number;
  year: number;
  champions: Array<{ competition: string; winner: string }>;
  promoted: number;
  relegated: number;
  retired: number;
  youthIntake: number;
  transfers: number;
  bankruptcies: string[];
  inductees: string[];
}

export function endSeason(world: World, ctx: SeasonContext): RolloverReport {
  const report: RolloverReport = {
    season: world.season,
    year: world.year,
    champions: [],
    promoted: 0,
    relegated: 0,
    retired: 0,
    youthIntake: 0,
    transfers: 0,
    bankruptcies: [],
    inductees: [],
  };

  const record: SeasonRecord = {
    season: world.season,
    year: world.year,
    champions: [],
    playerOfTheYear: -1,
    topScorer: { player: -1, points: 0 },
    dissolved: [],
  };

  awardTitles(world, report, record);
  settleFinances(world, report, record);
  applyPromotionRelegation(world, report);

  revisePotential(world, ctx.stats);
  applyAgeing(world);

  const retired = processRetirements(world);
  report.retired = retired.length;
  inductHallOfFame(world, retired, report);

  promoteYouth(world);
  report.youthIntake = generateYouthIntake(world).length;

  // Surplus players are released before the window opens, so they have a
  // chance to be picked up by someone else rather than simply vanishing.
  trimSquads(world);
  report.transfers = runTransferWindow(world);
  revalueSquads(world);
  selectAllNationalSquads(world);

  recordSeasonAwards(ctx, record);
  world.history.push(record);

  // Reset for the new season.
  world.season++;
  ctx.stats.clear();
  ctx.detailedResults.clear();
  startSeason(world);

  return report;
}

// ---- Titles ---------------------------------------------------------------

function awardTitles(world: World, report: RolloverReport, record: SeasonRecord): void {
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.table.length === 0) continue;
    const sorted = [...comp.table].sort(compareTableRows);
    if (sorted[0].played === 0) continue;

    const winner = sorted[0].clubId;
    comp.champion = winner;
    record.champions.push({ competitionId: comp.id, winner });

    const club = world.clubs[winner];
    if (club !== undefined) {
      club.titlesWon++;
      // Winning raises a club's standing, which raises the players it can sign.
      club.reputation = Math.min(10000, Math.round(club.reputation * 1.035 + 60));
      if (comp.tier === 1) {
        report.champions.push({ competition: comp.name, winner: club.name });
        for (const p of club.players) {
          world.players.careerTitles[p] = Math.min(65535, world.players.careerTitles[p] + 1);
        }
      }
    }

    // Prize money down the table.
    sorted.forEach((row, i) => {
      const c = world.clubs[row.clubId];
      if (c === undefined) return;
      const share = comp.prizePool * Math.pow(0.82, i);
      c.finances.prizeMoney = Math.round(share);
      c.finances.balance += Math.round(share);
      c.finances.seasonIncome += Math.round(share);
    });
  }
}

// ---- Finances -------------------------------------------------------------

/**
 * Balance the books.
 *
 * Income is sponsorship, television, merchandise and whatever gate receipts
 * accumulated during the season; expenditure is wages plus running costs.
 * Clubs that lose money for three consecutive seasons are dissolved — which is
 * rare, but real, and is what stops the user from being able to overspend
 * indefinitely.
 */
function settleFinances(world: World, report: RolloverReport, record: SeasonRecord): void {
  const store = world.players;
  const dissolved: Club[] = [];

  for (const club of world.clubs) {
    const f = club.finances;

    let wages = 0;
    for (const p of club.players) wages += store.wage[p];
    for (const p of club.youthPlayers) wages += store.wage[p];
    for (const sid of club.staff) wages += world.staff[sid]?.wage ?? 0;

    const income =
      f.sponsorshipIncome + f.tvRightsIncome + f.merchandiseIncome + f.seasonIncome;
    const costs =
      wages + f.arenaMaintenance + f.medicalCosts + f.youthAcademyCosts + f.seasonExpenditure;

    f.balance += income - costs;

    if (f.balance < 0) f.seasonsInDebt++;
    else f.seasonsInDebt = 0;

    // The board recalculates next season's budget from what the club can bear.
    f.wageBudget = Math.max(60_000, Math.round((income * 0.68 + Math.max(0, f.balance) * 0.2)));
    f.transferBudget = Math.max(0, Math.round(f.balance * 0.25));
    f.seasonIncome = 0;
    f.seasonExpenditure = 0;
    f.prizeMoney = 0;

    // Sponsorship follows reputation, so success compounds and decline bites.
    const scale = club.reputation / 10000;
    f.sponsorshipIncome = Math.round(180_000 + Math.pow(scale, 2.1) * 6_500_000);
    f.tvRightsIncome = Math.round(Math.pow(scale, 2.6) * 2_800_000);

    if (f.seasonsInDebt >= 3 && f.balance < -500_000) dissolved.push(club);
  }

  for (const club of dissolved) {
    report.bankruptcies.push(club.name);
    record.dissolved.push(club.id);
    // Players are released rather than deleted; they become free agents.
    for (const p of [...club.players, ...club.youthPlayers]) {
      store.clubId[p] = -1;
    }
    club.players = [];
    club.youthPlayers = [];
    // The club restarts in the lowest division with minimal resources.
    club.reputation = Math.round(club.reputation * 0.45);
    club.finances.balance = 50_000;
    club.finances.seasonsInDebt = 0;
  }
}

// ---- Promotion and relegation --------------------------------------------

function applyPromotionRelegation(world: World, report: RolloverReport): void {
  // Group divisions by nation and tier so clubs move between the right ones.
  const byNationTier = new Map<string, number[]>();
  for (const comp of world.competitions) {
    if (comp.kind !== 'league') continue;
    const key = `${comp.nation}:${comp.tier}`;
    const list = byNationTier.get(key) ?? [];
    list.push(comp.id);
    byNationTier.set(key, list);
  }

  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.table.length === 0) continue;
    const above = byNationTier.get(`${comp.nation}:${comp.tier - 1}`);
    const below = byNationTier.get(`${comp.nation}:${comp.tier + 1}`);
    const sorted = [...comp.table].sort(compareTableRows);
    if (sorted[0].played === 0) continue;

    // Relegate the bottom clubs if there is a division beneath.
    if (below !== undefined && below.length > 0) {
      for (let i = 0; i < comp.relegationSlots && i < sorted.length; i++) {
        const clubId = sorted[sorted.length - 1 - i].clubId;
        const target = world.competitions[below[i % below.length]];
        moveClub(world, clubId, comp.id, target.id);
        report.relegated++;
      }
    }
    // Promote the top clubs if there is a division above.
    if (above !== undefined && above.length > 0 && comp.promotionSlots > 0) {
      for (let i = 0; i < comp.promotionSlots && i < sorted.length; i++) {
        const clubId = sorted[i].clubId;
        const target = world.competitions[above[i % above.length]];
        moveClub(world, clubId, comp.id, target.id);
        report.promoted++;
      }
    }
  }
}

function moveClub(world: World, clubId: number, fromComp: number, toComp: number): void {
  const club = world.clubs[clubId];
  const from = world.competitions[fromComp];
  const to = world.competitions[toComp];
  if (club === undefined || from === undefined || to === undefined) return;

  from.participants = from.participants.filter((c) => c !== clubId);
  to.participants.push(clubId);
  club.leagueId = to.id;
  club.tier = to.tier;

  // Moving division changes what a club is worth to sponsors, and therefore
  // what it can pay. Promotion is a windfall; relegation hurts for years.
  const factor = to.tier < from.tier ? 1.18 : 0.86;
  club.reputation = Math.round(Math.min(10000, club.reputation * factor));
}

// ---- Youth and squads -----------------------------------------------------

/**
 * Maximum senior squad size.
 *
 * Without a cap, clubs absorb every academy graduate every year and squads
 * grow without bound — which quietly doubles the world's player population
 * over a couple of decades. Real rosters are tightly bounded, so this is too.
 */
const MAX_SQUAD = 16;

/** Move youth players who have come of age into the senior squad. */
function promoteYouth(world: World): void {
  const store = world.players;
  for (const club of world.clubs) {
    const staying: number[] = [];
    for (const p of club.youthPlayers) {
      const age = store.ageOn(p, world.year, 181);
      if (age >= 19) {
        // Only prospects worth a contract, and only if there is room.
        const worthKeeping =
          (store.potentialAbility[p] > 700 && club.players.length < MAX_SQUAD) ||
          club.players.length < 12;
        if (worthKeeping) {
          club.players.push(p);
          store.setFlag(p, PlayerFlag.Youth, false);
          store.contractUntil[p] = world.day + 2 * DAYS_PER_SEASON;
        } else {
          store.clubId[p] = -1;
          store.setFlag(p, PlayerFlag.Youth, false);
        }
      } else {
        staying.push(p);
      }
    }
    club.youthPlayers = staying;
  }
}

/**
 * Release players a club has no room for, weakest first, while keeping enough
 * cover at every position to field a team.
 */
function trimSquads(world: World): void {
  const store = world.players;
  for (const club of world.clubs) {
    if (club.players.length <= MAX_SQUAD) continue;

    const ranked = [...club.players].sort(
      (a, b) => store.currentAbility[b] - store.currentAbility[a],
    );
    const kept: number[] = [];
    const counts = new Map<number, number>();

    for (const p of ranked) {
      const pos = store.position[p] as Position;
      const have = counts.get(pos) ?? 0;
      // Never release below the minimum cover a position needs.
      const minimum = pos === Position.Libero || pos === Position.Setter ? 2 : 2;
      if (kept.length < MAX_SQUAD || have < minimum) {
        kept.push(p);
        counts.set(pos, have + 1);
      } else {
        store.clubId[p] = -1;
      }
    }
    club.players = kept;
  }
}

/**
 * The transfer window.
 *
 * Contracts that have expired put players on the market; clubs then fill their
 * weakest positions with the best player they can afford, richest club first.
 * Volleyball transfers are overwhelmingly free agency at contract end, so
 * that is what is modelled rather than a fee-driven market.
 */
function runTransferWindow(world: World): number {
  const store = world.players;
  let moves = 0;

  // Expire contracts.
  const freeAgents: number[] = [];
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || store.hasFlag(i, PlayerFlag.Youth)) continue;
    if (store.clubId[i] < 0) {
      freeAgents.push(i);
      continue;
    }
    if (store.contractUntil[i] <= world.day) {
      const club = world.clubs[store.clubId[i]];
      const loyalty = store.getAttr(i, 'loyalty') / 20;
      const ambition = store.getAttr(i, 'ambition') / 20;
      // A player at a club well below their level moves on; a loyal one stays.
      const clubLevel = club !== undefined ? club.reputation / 10000 : 0;
      const playerLevel = store.currentAbility[i] / 2000;
      const wantsOut = playerLevel > clubLevel + 0.12 ? ambition * 0.9 : 0.25;

      if (world.rng.chance(Math.min(0.92, wantsOut * (1.25 - loyalty * 0.6)))) {
        if (club !== undefined) club.players = club.players.filter((p) => p !== i);
        store.clubId[i] = -1;
        freeAgents.push(i);
      } else {
        store.contractUntil[i] = world.day + world.rng.int(1, 3) * DAYS_PER_SEASON;
      }
    }
  }

  // Clubs shop in order of standing.
  const shoppers = [...world.clubs].sort((a, b) => b.reputation - a.reputation);
  const available = new Set(freeAgents);

  for (const club of shoppers) {
    let wageRoom = club.finances.wageBudget;
    for (const p of club.players) wageRoom -= store.wage[p];

    for (const posKey of [
      Position.Setter, Position.Opposite, Position.OutsideHitter,
      Position.MiddleBlocker, Position.Libero,
    ]) {
      const have = club.players.filter((p) => store.position[p] === posKey).length;
      let need = SQUAD_TARGET[posKey] - have;
      if (need <= 0) continue;

      const candidates = [...available]
        .filter((p) => store.position[p] === posKey && store.wage[p] <= wageRoom)
        .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);

      for (const p of candidates) {
        if (need <= 0) break;
        // A player will not drop far below their level for no reason.
        const playerLevel = store.currentAbility[p] / 2000;
        const clubLevel = club.reputation / 10000;
        if (playerLevel > clubLevel + 0.22 && world.rng.chance(0.85)) continue;

        club.players.push(p);
        store.clubId[p] = club.id;
        store.contractUntil[p] = world.day + world.rng.int(1, 4) * DAYS_PER_SEASON;
        available.delete(p);
        wageRoom -= store.wage[p];
        need--;
        moves++;
      }
    }

    // Rebuild the preferred lineup around whoever is now at the club.
    refreshPreferredLineup(world, club);
  }

  return moves;
}

export function refreshPreferredLineup(world: World, club: Club): void {
  const store = world.players;
  const best = (pos: Position): number[] =>
    club.players
      .filter((p) => store.position[p] === pos)
      .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);

  const s = best(Position.Setter);
  const o = best(Position.Opposite);
  const oh = best(Position.OutsideHitter);
  const mb = best(Position.MiddleBlocker);
  const li = best(Position.Libero);

  if (s.length && o.length && oh.length >= 2 && mb.length >= 2) {
    club.preferredLineup = [s[0], mb[0], oh[0], o[0], mb[1], oh[1]];
  }
  if (li.length) club.preferredLibero = li[0];
}

// ---- Records --------------------------------------------------------------

function recordSeasonAwards(ctx: SeasonContext, record: SeasonRecord): void {
  let bestScore = -Infinity;
  let bestPoints = 0;
  for (const [p, line] of ctx.stats) {
    if (line.matches < 8) continue;
    const points = line.attackKills + line.serveAces + line.blockPoints;
    if (points > bestPoints) {
      bestPoints = points;
      record.topScorer = { player: p, points };
    }
    // Player of the year weighs efficiency as well as volume.
    const efficiency = line.attacksTotal > 0
      ? (line.attackKills - line.attackErrors - line.attackBlocked) / line.attacksTotal
      : 0;
    const score = points * (0.75 + efficiency);
    if (score > bestScore) {
      bestScore = score;
      record.playerOfTheYear = p;
    }
  }
}

/**
 * Hall of Fame induction.
 *
 * Deliberately strict. A Hall of Fame that admits every competent professional
 * is worthless by season thirty; this one should admit a handful a year, so
 * that appearing on the list still means something after four decades.
 */
function inductHallOfFame(world: World, retired: number[], report: RolloverReport): void {
  const store = world.players;
  for (const p of retired) {
    const points = store.careerPoints[p];
    const titles = store.careerTitles[p];
    const caps = store.nationalCaps[p];
    const peak = store.potentialAbility[p];

    const score = points / 90 + titles * 22 + caps * 0.9 + (peak > 1650 ? 55 : 0);
    if (score < 175) continue;

    const citation = titles >= 6
      ? `${titles}-time national champion`
      : peak > 1750
        ? 'One of the finest players of their generation'
        : titles > 0
          ? `${titles}-time champion and long-serving professional`
          : 'A career of sustained excellence';

    const entry: HallOfFameEntry = {
      player: p,
      inductedYear: world.year,
      careerPoints: points,
      titles,
      caps,
      citation,
    };
    world.hallOfFame.push(entry);
    store.setFlag(p, PlayerFlag.HallOfFame, true);
    report.inductees.push(store.fullName(p));
  }
}
