/**
 * Match statistics, accumulated rally by rally.
 *
 * Counting conventions follow FIVB / Volleyball World scoresheets, because the
 * whole point of tracking them is that a user who knows volleyball can read a
 * box score here and have it mean what it means in a real match report:
 *
 *   Attack efficiency = (kills - errors - blocked) / attempts
 *   Kill %            = kills / attempts
 *   Reception positivity = (perfect + positive) / attempts
 *   Serve efficiency  = (aces - errors) / attempts
 *
 * Reception is graded on the standard four-point scale: # perfect (all options
 * available to the setter), + positive (most options), - poor (limited, no
 * quick), / overpass or error.
 */

export interface PlayerMatchStats {
  playerIdx: number;

  servesTotal: number;
  serveAces: number;
  serveErrors: number;

  receptionsTotal: number;
  receptionPerfect: number;
  receptionPositive: number;
  receptionPoor: number;
  receptionErrors: number;

  attacksTotal: number;
  attackKills: number;
  attackErrors: number;
  attackBlocked: number;

  blockPoints: number;
  blockTouches: number;
  blockErrors: number;

  digsTotal: number;
  digErrors: number;

  setsMade: number;
  setAssists: number;
  setErrors: number;

  /** Rallies this player was on court for; drives fatigue and match ratings. */
  ralliesPlayed: number;
  /** Points scored while on court minus points conceded. */
  plusMinus: number;
}

export function newPlayerStats(playerIdx: number): PlayerMatchStats {
  return {
    playerIdx,
    servesTotal: 0, serveAces: 0, serveErrors: 0,
    receptionsTotal: 0, receptionPerfect: 0, receptionPositive: 0,
    receptionPoor: 0, receptionErrors: 0,
    attacksTotal: 0, attackKills: 0, attackErrors: 0, attackBlocked: 0,
    blockPoints: 0, blockTouches: 0, blockErrors: 0,
    digsTotal: 0, digErrors: 0,
    setsMade: 0, setAssists: 0, setErrors: 0,
    ralliesPlayed: 0, plusMinus: 0,
  };
}

export function totalPoints(s: PlayerMatchStats): number {
  return s.attackKills + s.serveAces + s.blockPoints;
}

export function attackEfficiency(s: PlayerMatchStats): number {
  if (s.attacksTotal === 0) return 0;
  return (s.attackKills - s.attackErrors - s.attackBlocked) / s.attacksTotal;
}

export function killPercent(s: PlayerMatchStats): number {
  return s.attacksTotal === 0 ? 0 : s.attackKills / s.attacksTotal;
}

export function receptionPositivity(s: PlayerMatchStats): number {
  if (s.receptionsTotal === 0) return 0;
  return (s.receptionPerfect + s.receptionPositive) / s.receptionsTotal;
}

export function receptionPerfectPct(s: PlayerMatchStats): number {
  return s.receptionsTotal === 0 ? 0 : s.receptionPerfect / s.receptionsTotal;
}

export function serveEfficiency(s: PlayerMatchStats): number {
  if (s.servesTotal === 0) return 0;
  return (s.serveAces - s.serveErrors) / s.servesTotal;
}

/**
 * Per-rotation performance. This is the number that makes the rotation screen
 * worth looking at: a team with a broken Rotation 2 bleeds points there and
 * nowhere else, and the user needs to be able to see that.
 */
export interface RotationStats {
  /** Rallies played in this rotation while serving. */
  serveRallies: number;
  servePointsWon: number;
  /** Rallies played in this rotation while receiving. */
  receiveRallies: number;
  /** Rallies won while receiving — i.e. successful side-outs. */
  sideOutsWon: number;
}

export function newRotationStats(): RotationStats {
  return { serveRallies: 0, servePointsWon: 0, receiveRallies: 0, sideOutsWon: 0 };
}

/** Side-out percentage: how often the team wins the rally when receiving. */
export function sideOutPct(r: RotationStats): number {
  return r.receiveRallies === 0 ? 0 : r.sideOutsWon / r.receiveRallies;
}

/** Point-scoring percentage while serving (the "break point" rate). */
export function breakPointPct(r: RotationStats): number {
  return r.serveRallies === 0 ? 0 : r.servePointsWon / r.serveRallies;
}

export interface TeamMatchStats {
  players: Map<number, PlayerMatchStats>;
  rotations: RotationStats[];
  setsWon: number;
  pointsByset: number[];
  /** Points from opponent errors, which belong to no individual player. */
  opponentErrors: number;
  /** Longest consecutive run of points scored. */
  longestRun: number;
}

export function newTeamStats(): TeamMatchStats {
  return {
    players: new Map(),
    rotations: Array.from({ length: 6 }, newRotationStats),
    setsWon: 0,
    pointsByset: [],
    opponentErrors: 0,
    longestRun: 0,
  };
}

export function statsFor(team: TeamMatchStats, playerIdx: number): PlayerMatchStats {
  let s = team.players.get(playerIdx);
  if (s === undefined) {
    s = newPlayerStats(playerIdx);
    team.players.set(playerIdx, s);
  }
  return s;
}

/** Aggregate a team's player stats into a single team-level line. */
export function aggregateTeam(team: TeamMatchStats): PlayerMatchStats {
  const total = newPlayerStats(-1);
  for (const s of team.players.values()) {
    total.servesTotal += s.servesTotal;
    total.serveAces += s.serveAces;
    total.serveErrors += s.serveErrors;
    total.receptionsTotal += s.receptionsTotal;
    total.receptionPerfect += s.receptionPerfect;
    total.receptionPositive += s.receptionPositive;
    total.receptionPoor += s.receptionPoor;
    total.receptionErrors += s.receptionErrors;
    total.attacksTotal += s.attacksTotal;
    total.attackKills += s.attackKills;
    total.attackErrors += s.attackErrors;
    total.attackBlocked += s.attackBlocked;
    total.blockPoints += s.blockPoints;
    total.blockTouches += s.blockTouches;
    total.blockErrors += s.blockErrors;
    total.digsTotal += s.digsTotal;
    total.digErrors += s.digErrors;
    total.setsMade += s.setsMade;
    total.setAssists += s.setAssists;
    total.setErrors += s.setErrors;
  }
  return total;
}

/**
 * Season-long accumulation. Kept separate from match stats because a fifty-season
 * career cannot retain every box score, but must retain the aggregates.
 */
export interface SeasonStatLine extends PlayerMatchStats {
  matches: number;
  sets: number;
}

export function newSeasonLine(playerIdx: number): SeasonStatLine {
  return { ...newPlayerStats(playerIdx), matches: 0, sets: 0 };
}

export function addToSeason(dst: SeasonStatLine, src: PlayerMatchStats, setsPlayed: number): void {
  dst.matches += 1;
  dst.sets += setsPlayed;
  dst.servesTotal += src.servesTotal;
  dst.serveAces += src.serveAces;
  dst.serveErrors += src.serveErrors;
  dst.receptionsTotal += src.receptionsTotal;
  dst.receptionPerfect += src.receptionPerfect;
  dst.receptionPositive += src.receptionPositive;
  dst.receptionPoor += src.receptionPoor;
  dst.receptionErrors += src.receptionErrors;
  dst.attacksTotal += src.attacksTotal;
  dst.attackKills += src.attackKills;
  dst.attackErrors += src.attackErrors;
  dst.attackBlocked += src.attackBlocked;
  dst.blockPoints += src.blockPoints;
  dst.blockTouches += src.blockTouches;
  dst.blockErrors += src.blockErrors;
  dst.digsTotal += src.digsTotal;
  dst.digErrors += src.digErrors;
  dst.setsMade += src.setsMade;
  dst.setAssists += src.setAssists;
  dst.setErrors += src.setErrors;
  dst.ralliesPlayed += src.ralliesPlayed;
  dst.plusMinus += src.plusMinus;
}
