/**
 * Clubs, leagues and club finances.
 *
 * Volleyball economics are not football economics. Transfer fees are modest or
 * absent — most moves happen at contract expiry — and clubs live or die on
 * sponsorship and the wage bill. A club that overspends does not get bought
 * out by a new owner; it goes under, drops a division, or dissolves. That is
 * modelled here honestly, which is why a 500-seat arena is a real starting
 * point and a real constraint.
 */

import { defaultTactics, type TeamTactics } from '../match/tactics.ts';

export interface Finances {
  /** Cash in hand. Negative for long enough and the club is in trouble. */
  balance: number;
  /** Annual wage budget the board has sanctioned. */
  wageBudget: number;
  /** Available for transfer fees this window. */
  transferBudget: number;

  /** Income streams, per season. */
  sponsorshipIncome: number;
  ticketIncomePerMatch: number;
  merchandiseIncome: number;
  tvRightsIncome: number;
  prizeMoney: number;

  /** Costs, per season. */
  arenaMaintenance: number;
  travelCosts: number;
  medicalCosts: number;
  youthAcademyCosts: number;

  /** Running season totals, reset at the season rollover. */
  seasonIncome: number;
  seasonExpenditure: number;

  /** Consecutive seasons finishing in the red. Three usually means the end. */
  seasonsInDebt: number;
}

export interface Club {
  id: number;
  name: string;
  shortName: string;
  nation: number;
  /** Division this club currently plays in, 1 = top flight. */
  tier: number;
  leagueId: number;

  /** 0-10000. Drives who will sign, sponsorship value, and media attention. */
  reputation: number;

  finances: Finances;

  arenaName: string;
  arenaCapacity: number;

  /** Facility quality, 1-20. */
  trainingFacilities: number;
  youthFacilities: number;
  medicalFacilities: number;
  /** Youth recruitment reach, 1-20. Drives the quality of the annual intake. */
  youthRecruitment: number;

  /** Player store indices. */
  players: number[];
  youthPlayers: number[];
  /** Staff ids. */
  staff: number[];

  tactics: TeamTactics;
  /** Preferred starting six, as player indices in rotational order. */
  preferredLineup: number[];
  preferredLibero: number;

  /** History. */
  titlesWon: number;
  seasonsInTopFlight: number;
  /** Board's expectation for this season, as a target league position. */
  boardExpectation: number;
  /** 0-100. Below ~25 and the manager is in danger. */
  boardConfidence: number;
}

export interface LeagueTableRow {
  clubId: number;
  played: number;
  won: number;
  lost: number;
  /** Volleyball league points: 3 for a 3-0/3-1 win, 2 for 3-2, 1 for a 2-3 loss. */
  points: number;
  setsFor: number;
  setsAgainst: number;
  pointsFor: number;
  pointsAgainst: number;
}

export function newTableRow(clubId: number): LeagueTableRow {
  return {
    clubId, played: 0, won: 0, lost: 0, points: 0,
    setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0,
  };
}

/** Set ratio, the standard first tiebreaker in volleyball. */
export function setRatio(r: LeagueTableRow): number {
  return r.setsAgainst === 0 ? r.setsFor : r.setsFor / r.setsAgainst;
}

export function pointRatio(r: LeagueTableRow): number {
  return r.pointsAgainst === 0 ? r.pointsFor : r.pointsFor / r.pointsAgainst;
}

/**
 * Standings order: league points, then set ratio, then point ratio. This is
 * the FIVB ordering used by essentially every domestic league.
 */
export function compareTableRows(a: LeagueTableRow, b: LeagueTableRow): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.won !== a.won) return b.won - a.won;
  const sr = setRatio(b) - setRatio(a);
  if (Math.abs(sr) > 1e-9) return sr;
  return pointRatio(b) - pointRatio(a);
}

/**
 * Award league points for a finished match, using the 3/2/1/0 system that is
 * standard in professional volleyball: a 3-2 win is worth less than a 3-0, and
 * losing 2-3 still earns a point.
 */
export function awardLeaguePoints(_winnerSets: number, loserSets: number): [number, number] {
  if (loserSets <= 1) return [3, 0];
  return [2, 1];
}

export function newFinances(reputation: number, arenaCapacity: number): Finances {
  const scale = reputation / 10000;
  const sponsorship = Math.round(180_000 + Math.pow(scale, 2.1) * 6_500_000);
  const tv = Math.round(Math.pow(scale, 2.6) * 2_800_000);
  return {
    balance: Math.round(sponsorship * 0.35),
    wageBudget: Math.round(sponsorship * 0.62 + tv * 0.6),
    transferBudget: Math.round(sponsorship * 0.08),
    sponsorshipIncome: sponsorship,
    ticketIncomePerMatch: Math.round(arenaCapacity * (6 + scale * 26) * 0.72),
    merchandiseIncome: Math.round(Math.pow(scale, 2) * 900_000),
    tvRightsIncome: tv,
    prizeMoney: 0,
    arenaMaintenance: Math.round(12_000 + arenaCapacity * 38),
    travelCosts: Math.round(45_000 + scale * 380_000),
    medicalCosts: Math.round(28_000 + scale * 260_000),
    youthAcademyCosts: Math.round(20_000 + scale * 420_000),
    seasonIncome: 0,
    seasonExpenditure: 0,
    seasonsInDebt: 0,
  };
}

export function newClub(id: number, name: string, nation: number, tier: number): Club {
  return {
    id,
    name,
    shortName: name.slice(0, 3).toUpperCase(),
    nation,
    tier,
    leagueId: -1,
    reputation: 1000,
    finances: newFinances(1000, 1500),
    arenaName: `${name} Arena`,
    arenaCapacity: 1500,
    trainingFacilities: 10,
    youthFacilities: 10,
    medicalFacilities: 10,
    youthRecruitment: 10,
    players: [],
    youthPlayers: [],
    staff: [],
    tactics: defaultTactics(),
    preferredLineup: [],
    preferredLibero: -1,
    titlesWon: 0,
    seasonsInTopFlight: 0,
    boardExpectation: 8,
    boardConfidence: 60,
  };
}

/** Total annual wage bill. */
export function wageBill(club: Club, wages: Float64Array): number {
  let total = 0;
  for (const p of club.players) total += wages[p];
  return total;
}
