/**
 * The assistant's review after each of the manager's matches: what worked, what didn't, and what to
 * change for the next one — read off the box score the save keeps: the attackers' efficiency, the
 * passing, the serving, the blocks, and how each rotation sided out.
 */

import { StaffRole } from '../model/staff.ts';
import { aggregateTeam, type PlayerMatchStats, type TeamMatchStats } from '../match/stats.ts';
import { competitionStats } from './competitionStats.ts';
import { postMessage } from './inbox.ts';
import { reportResult } from './matchReports.ts';
import type { Fixture, World } from './world.ts';

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Kills less errors and blocks, over attacks. */
function attackEff(s: PlayerMatchStats): number {
  return s.attacksTotal > 0 ? (s.attackKills - s.attackErrors - s.attackBlocked) / s.attacksTotal : 0;
}

/** Perfect and positive passes, over passes. */
function goodPasses(s: PlayerMatchStats): number {
  return s.receptionsTotal > 0 ? (s.receptionPerfect + s.receptionPositive) / s.receptionsTotal : 0;
}

/** Who the assistant is — his name, if the club has one. */
function assistantName(world: World, clubId: number): string {
  const a = world.staff.find((s) => s.clubId === clubId && s.role === StaffRole.AssistantCoach);
  return a !== undefined ? `${a.firstName} ${a.lastName}` : 'Assistant Coach';
}

export interface Review {
  worked: string[];
  failed: string[];
  change: string[];
}

/** The review of one match from the manager's side's box score: `next` is his next opponent, if any. */
export function reviewMatch(world: World, team: TeamMatchStats, sets: number, next: { name: string; threat: string | null } | null): Review {
  const store = world.players;
  const name = (p: number): string => store.fullName(p);
  const worked: string[] = [];
  const failed: string[] = [];
  const change: string[] = [];
  const all = aggregateTeam(team);
  const players = [...team.players.values()];

  // The attack.
  const hitters = players.filter((s) => s.attacksTotal >= 8).sort((a, b) => attackEff(b) - attackEff(a));
  const best = hitters[0];
  if (best !== undefined && attackEff(best) >= 0.3) {
    worked.push(`${name(best.playerIdx)} was our best weapon: ${best.attackKills} kills from ${best.attacksTotal} swings, ${pct(attackEff(best))} efficiency.`);
  }
  const worst = hitters[hitters.length - 1];
  if (worst !== undefined && worst !== best && attackEff(worst) < 0.12) {
    failed.push(`${name(worst.playerIdx)} struggled in attack — ${pct(attackEff(worst))} efficiency, ${worst.attackErrors + worst.attackBlocked} errors and blocks.`);
    change.push(`Fewer sets to ${name(worst.playerIdx)} next time, or a fresh pair of legs from the bench.`);
  }
  // Passing.
  const passing = goodPasses(all);
  if (all.receptionsTotal >= 15) {
    if (passing >= 0.55) worked.push(`The passing held up: ${pct(passing)} good passes gave the setter options.`);
    else if (passing < 0.42) {
      failed.push(`Our reception broke down: only ${pct(passing)} good passes.`);
      change.push('Work on reception in training this week — and think about a defensive libero or a steadier passer in the six.');
    }
  }
  // Serving.
  const serveErr = all.servesTotal > 0 ? all.serveErrors / all.servesTotal : 0;
  if (all.serveAces >= Math.max(4, sets * 1.3)) worked.push(`The serve hurt them: ${all.serveAces} aces.`);
  if (serveErr >= 0.18 && all.servesTotal >= 20) {
    failed.push(`We gave too much away from the line: ${all.serveErrors} service errors (${pct(serveErr)} of our serves).`);
    change.push('Take a little off the serve — safer targets, fewer free points.');
  }
  // The block.
  if (all.blockPoints >= Math.max(6, sets * 2.4)) worked.push(`The block was a wall: ${all.blockPoints} stuff blocks.`);
  // Rotations.
  const rot = team.rotations
    .map((r, i) => ({ i, rallies: r.receiveRallies, sideOut: r.receiveRallies > 0 ? r.sideOutsWon / r.receiveRallies : 0 }))
    .filter((r) => r.rallies >= 6);
  if (rot.length > 0) {
    const top = rot.reduce((a, b) => (b.sideOut > a.sideOut ? b : a));
    const low = rot.reduce((a, b) => (b.sideOut < a.sideOut ? b : a));
    if (top.sideOut >= 0.68) worked.push(`Rotation P${top.i + 1} sided out ${pct(top.sideOut)} of the time.`);
    if (low.sideOut < 0.5) {
      failed.push(`Rotation P${low.i + 1} got stuck: ${pct(low.sideOut)} side-out.`);
      change.push(`Look at P${low.i + 1} in the Rotations screen — a different first-choice attacker there, or a different starting rotation to spend less time in it.`);
    }
  }
  if (next !== null) {
    change.push(next.threat !== null
      ? `Next up is ${next.name}. Watch ${next.threat} — their main threat this season.`
      : `Next up is ${next.name}.`);
  }
  if (worked.length === 0) worked.push('Not much, if I am honest. We have to be better.');
  if (failed.length === 0) failed.push('Nothing glaring — a solid, all-round performance.');
  if (change.length === 0) change.push('Keep the same plan. It is working.');
  return { worked, failed, change };
}

/** After one of the manager's matches: the assistant's review, in the inbox. */
export function postMatchReview(world: World, fixture: Fixture): void {
  const clubId = world.userClubId;
  if (clubId < 0 || (fixture.home !== clubId && fixture.away !== clubId)) return;
  const report = world.matchReports?.get(fixture.id);
  if (report === undefined) return;
  const result = reportResult(fixture, report);
  const home = fixture.home === clubId;
  const team = home ? result.stats.home : result.stats.away;
  const won = home ? fixture.homeSets > fixture.awaySets : fixture.awaySets > fixture.homeSets;
  const oppId = home ? fixture.away : fixture.home;
  const opp = world.clubs[oppId];
  // The next opponent, and the man to stop.
  const upcoming = world.fixtures
    .filter((f) => !f.played && f.day > fixture.day && (f.home === clubId || f.away === clubId))
    .sort((a, b) => a.day - b.day)[0];
  let next: { name: string; threat: string | null } | null = null;
  if (upcoming !== undefined) {
    const nextId = upcoming.home === clubId ? upcoming.away : upcoming.home;
    const top = competitionStats(world, upcoming.competitionId).players
      .filter((p) => p.clubId === nextId)
      .sort((a, b) => b.kills - a.kills)[0];
    next = { name: world.clubs[nextId]?.name ?? 'our next opponent', threat: top !== undefined && top.kills > 0 ? world.players.fullName(top.p) : null };
  }
  const r = reviewMatch(world, team, fixture.setScores.length, next);
  const score = home ? `${fixture.homeSets}–${fixture.awaySets}` : `${fixture.awaySets}–${fixture.homeSets}`;
  const list = (items: string[]): string => items.map((t) => `• ${t}`).join('\n');
  postMessage(world, {
    category: 'staff',
    from: assistantName(world, clubId),
    clubId: oppId,
    subject: `Match review: ${won ? 'won' : 'lost'} ${score} against ${opp?.shortName ?? 'them'}`,
    body: `What worked\n${list(r.worked)}\n\nWhat went wrong\n${list(r.failed)}\n\nWhat I would change\n${list(r.change)}`,
  });
}
