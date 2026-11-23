/**
 * The players have their say. A volleyball dressing room is not silent: the
 * captain speaks when the coach goes, the player of the month dedicates it to
 * someone, the hitter who put the last ball of a tie-break out says he will
 * take it again, the debutant thanks whoever gave him the chance, the
 * veteran on his hundredth match remembers his first.
 *
 * Every word comes from who the player is: his professionalism, temper, way
 * with the media, ambition and loyalty, and from what he has lived under the
 * coach: his minutes, his mood, whether that coach signed him. The lines are
 * drawn from the day and the player, never from the world's dice, so a voice
 * never changes how the season plays out.
 *
 * Each word goes in the paper (a story of its own, or a line under one), on
 * the social feed (see socialFeed.ts) and, when it is one of the manager's
 * own players, in his inbox.
 */

import { PlayerFlag, InjuryType } from '../model/players.ts';
import { POSITION_NAMES, type Position } from '../model/positions.ts';
import { StaffRole, type Staff } from '../model/staff.ts';
import type { Club } from '../model/club.ts';
import type { MatchResult } from '../match/engine.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import { postMessage } from './inbox.ts';
import { stillSettling } from './playerTalks.ts';
import { followed, postNews, type NewsItem } from './news.ts';
import { NATIONS } from './nations.ts';
import { hash01 } from './offerStance.ts';
import type { FanBrief } from './fans.ts';
import type { Fixture, World } from './world.ts';

/** A player's own words, kept with the story they were said in. */
export interface PlayerQuote {
  p: number;
  text: string;
}

// ---- Who he is --------------------------------------------------------------------------

/** His character, each trait about -1 to 1 around the average player. */
interface Persona {
  pro: number;
  /** High: calm, takes things well. Low: a short fuse. */
  calm: number;
  media: number;
  ambition: number;
  loyalty: number;
  confidence: number;
  teamwork: number;
  composure: number;
}

function persona(world: World, p: number): Persona {
  const s = world.players;
  const a = (n: Parameters<typeof s.getAttr>[1]): number => (s.getAttr(p, n) - 10.5) / 9.5;
  return {
    pro: a('professionalism'), calm: a('temperament'), media: a('mediaHandling'), ambition: a('ambition'),
    loyalty: a('loyalty'), confidence: a('confidence'), teamwork: a('teamwork'), composure: a('composure'),
  };
}

// ---- The dice that are not the world's ----------------------------------------------------

/** A number 0-1 for this player, today, for this purpose: the same every time it is asked. */
function roll(world: World, p: number, salt: number): number {
  return hash01(world.day * 131 + salt, p * 17 + 3);
}

function pick<T>(list: readonly T[], world: World, p: number, salt: number): T {
  return list[Math.floor(roll(world, p, salt) * list.length) % list.length];
}

/** Two or three pieces, each from its own list, put together. */
function compose(world: World, p: number, salt: number, ...parts: ReadonlyArray<readonly string[]>): string {
  return parts.map((list, i) => pick(list, world, p, salt + i * 7)).filter((x) => x !== '').join(' ');
}

// ---- Whose player he is -------------------------------------------------------------------

/** The manager's own: at his club, or in his national squad. */
export function isOurs(world: World, p: number): boolean {
  if (world.userClubId >= 0 && world.players.clubId[p] === world.userClubId) return true;
  const n = world.career.nationalTeam;
  return n !== undefined && (world.nationalTeams.find((t) => t.nation === n)?.squad.includes(p) ?? false);
}

function managerName(world: World): string {
  return `${world.manager.firstName} ${world.manager.lastName}`;
}

/** He, him, his, for the manager. */
function mgr(world: World): { he: string; him: string; his: string } {
  return world.manager.gender === 'female' ? { he: 'she', him: 'her', his: 'her' } : { he: 'he', him: 'him', his: 'his' };
}

/** His or her, for the players of this world. */
function playerHis(world: World): string {
  return world.gender === 'women' ? 'her' : 'his';
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function headCoach(world: World, club: Club): Staff | undefined {
  for (const id of club.staff) {
    const s = world.staff[id];
    if (s !== undefined && s.role === StaffRole.HeadCoach) return s;
  }
  return undefined;
}

/** What the player calls his coach: the manager by surname at his club, the head coach elsewhere. */
function coachOf(world: World, clubId: number): string {
  if (clubId >= 0 && clubId === world.userClubId) return world.manager.lastName;
  const c = clubId >= 0 ? world.clubs[clubId] : undefined;
  const s = c !== undefined ? headCoach(world, c) : undefined;
  return s !== undefined ? s.lastName : 'the coach';
}

/** A teammate he would name: his setter, or for a setter his best hitter. */
function mateOf(world: World, p: number, clubId: number): string {
  const club = clubId >= 0 ? world.clubs[clubId] : undefined;
  if (club === undefined) return 'my teammates';
  const s = world.players;
  const setter = s.position[p] === 0;
  let best = -1;
  for (const q of club.players) {
    if (q === p || (setter ? s.position[q] === 0 : s.position[q] !== 0)) continue;
    if (best < 0 || s.currentAbility[q] > s.currentAbility[best]) best = q;
  }
  return best >= 0 ? s.surname(best) : 'my teammates';
}

function clubName(world: World, clubId: number | undefined): string {
  const c = clubId !== undefined && clubId >= 0 ? world.clubs[clubId] : undefined;
  return c?.name ?? 'the club';
}

function nationOf(n: number): string {
  return NATIONS[n]?.name ?? 'home';
}

/** A country as it reads after "back home in": "the United States", "Brazil". */
function homeIn(n: number): string {
  const name = nationOf(n);
  return /^(United |Netherlands|Czech Republic|Dominican Republic|Philippines)/.test(name) ? `the ${name}` : name;
}

/** "the outside hitter", "the setter". */
function role(world: World, p: number): string {
  return `the ${(POSITION_NAMES[world.players.position[p] as Position] ?? 'player').toLowerCase()}`;
}

/** The headline's piece of a quote: its first sentence, kept short. */
function firstLine(text: string): string {
  const m = /^(.*?[.!?])(\s|$)/.exec(text);
  const line = m !== null ? m[1] : text;
  return line.length <= 90 ? line : `${line.slice(0, 87).replace(/\s+\S*$/, '')}...`;
}

// ---- How often ----------------------------------------------------------------------------

/** How many quotes a club has had in the paper this past week. */
function quotesThisWeek(world: World, clubId: number | undefined): number {
  let n = 0;
  for (let i = world.news.length - 1; i >= 0; i--) {
    const x = world.news[i];
    if (x.day < world.day - 7) break;
    if (x.quote !== undefined && x.clubId === clubId) n++;
  }
  return n;
}

/** How many quotes from players the manager doesn't have the paper ran today. */
function othersToday(world: World): number {
  let n = 0;
  for (let i = world.news.length - 1; i >= 0; i--) {
    const x = world.news[i];
    if (x.day < world.day) break;
    if (x.quote !== undefined && !isOurs(world, x.quote.p)) n++;
  }
  return n;
}

/** A moment that happens often (a man of the match): about one in three is talked about, a couple a week at most. */
function commonMoment(world: World, p: number, clubId: number | undefined, salt: number): boolean {
  if (roll(world, p, salt) > 0.34) return false;
  const ours = isOurs(world, p);
  if (!ours && othersToday(world) >= 4) return false;
  return quotesThisWeek(world, clubId) < (ours ? 2 : 1);
}

/** A rarer moment: always for the manager's own, half the time elsewhere, a few a day and a couple a week a club. */
function rareMoment(world: World, p: number, salt: number): boolean {
  if (isOurs(world, p)) return true;
  const clubId = world.players.clubId[p];
  return roll(world, p, salt) < 0.5 && othersToday(world) < 5 && quotesThisWeek(world, clubId >= 0 ? clubId : undefined) < 2;
}

// ---- Into the world -----------------------------------------------------------------------

/** One of the manager's players to the press: his inbox hears it too. */
function tellManager(world: World, p: number, subject: string, lead: string, text: string, clubId?: number): void {
  if (!isOurs(world, p)) return;
  postMessage(world, {
    category: 'news', from: 'Press Office', playerIdx: p, clubId,
    subject, body: `${lead}\n\n"${text}"`,
  });
}

/** A story that is a player's words. */
function quoteStory(
  world: World, p: number, text: string,
  o: { headline?: string; lead: string; clubId?: number; nation: number; fans: FanBrief; competitionId?: number; kind?: NewsItem['kind']; subject?: string },
): void {
  const name = world.players.fullName(p);
  postNews(world, {
    kind: o.kind ?? 'press',
    headline: o.headline ?? `${name}: "${firstLine(text)}"`,
    body: `${o.lead} "${text}"`,
    nation: o.nation,
    clubId: o.clubId,
    playerIdx: p,
    competitionId: o.competitionId,
    fans: o.fans,
    quote: { p, text },
  });
  tellManager(world, p, o.subject ?? `${name} speaks to the press`, o.lead, text, o.clubId);
}

/** A player's words added under a story about him, before it goes to print. */
export function withQuote<T extends Omit<NewsItem, 'id' | 'day'>>(world: World, item: T, p: number, text: string, subject: string): T {
  const name = world.players.surname(p);
  tellManager(world, p, subject, item.body, text, item.clubId);
  return { ...item, body: `${item.body} ${name}: "${text}"`, quote: { p, text } };
}

// ---- The coach goes -----------------------------------------------------------------------

export type ManagerExit = 'sacked' | 'resigned' | 'expired' | 'moved';

/** How a player feels about the coach who has gone. */
type Stance = 'grateful' | 'sad' | 'professional' | 'relieved' | 'critical';

const OPEN: Record<ManagerExit, readonly string[]> = {
  sacked: [
    'It is a sad day.', 'Nobody in the dressing room wanted this.', 'This is football and volleyball, results decide everything.',
    'I found out like everyone else, this morning.', 'It hurts, because we are the ones on the court.',
  ],
  resigned: [
    'It came as a surprise to all of us.', 'I respect the decision, even if I did not see it coming.',
    'We knew something was in the air, but it is still a shock.', 'Nobody expected it.',
  ],
  expired: [
    'Contracts end, that is the business.', 'We all knew the contract was coming to an end.',
    'It is a pity it ends like this, with a contract simply running out.',
  ],
  moved: [
    'A new challenge was always going to come for a coach like that.', 'Good coaches get offers, it is normal.',
    'Everybody knew other clubs were watching.',
  ],
};

const STANCE_LINES: Record<Stance, readonly string[]> = {
  grateful: [
    '{Coach} gave me my chance when nobody else would. I will never forget that.',
    'I owe {coach} a lot. I am a better player today than when {he} arrived.',
    'From the first day {coach} believed in me. That kind of trust stays with you.',
    '{Coach} made me the player I am. I hope our paths cross again.',
    'Every session with {coach} taught me something. I will miss that.',
    'I came here because of {coach}. Now I have to show I deserved that trust.',
  ],
  sad: [
    'We are responsible too. We are the ones who did not win the points.',
    'As captain I feel this one. We let {coach} down on the court.',
    'The players have to look in the mirror first. {Coach} gave everything.',
    'It is a hard moment for the group. We had a good relationship with {coach}.',
    'I sent {coach} a message this morning. A great person, above all.',
  ],
  professional: [
    'We thank {coach} for the work. Now we have to stay focused and move on.',
    'Coaches come and go, the club stays. My job is to be ready for whoever comes next.',
    'I wish {coach} all the best. We have a season to finish and that is what matters now.',
    'It is not for me to judge. The club decides, the players play.',
    'Respect for {coach}. Now the page turns.',
  ],
  relieved: [
    'Maybe a change was needed. Something was not working any more.',
    'A new coach is a new start for everyone, me included.',
    'I did not play as much as I wanted. A new coach means a clean slate.',
    'I will not pretend, it was not always easy for me. I hope things change now.',
  ],
  critical: [
    'Honestly? I was not given a fair chance. I am not going to cry about it.',
    'Some decisions this season I never understood. I said so at the time.',
    'I sat on the bench without explanations. A coach has to talk to his players.',
    'I respect the person, but the way the group was managed was not right.',
    'Everyone has a different opinion. Mine is that we needed a change much earlier.',
  ],
};

const STANCE_CLOSE: Record<Stance, readonly string[]> = {
  grateful: ['Thank you, coach.', 'Good luck wherever you go.', '', 'This club was lucky to have that kind of coach.'],
  sad: ['Now we have to react.', '', 'We owe it to the fans to fight.'],
  professional: ['', 'Life goes on.', 'Next match.'],
  relieved: ['', 'I want to fight for my place.', 'Now it is up to me.'],
  critical: ['', 'That is my opinion, and I will not hide it.', 'Now let us look forward.'],
};

function fillCoach(world: World, s: string, coach: string): string {
  const m = mgr(world);
  return s.replaceAll('{Coach}', cap(coach)).replaceAll('{coach}', coach).replaceAll('{he}', m.he).replaceAll('{him}', m.him).replaceAll('{his}', m.his);
}

interface Reaction { p: number; stance: Stance; text: string }

/** What the room feels, from minutes and mood, who brought him in and who he is. */
function relationship(world: World, p: number, signed: ReadonlySet<number>): number {
  const s = world.players;
  let r = (s.morale[p] - 55) / 45 + (s.playingTime[p] - 50) / 60;
  if (signed.has(p)) r += 0.45;
  const age = s.ageOn(p, world.year, 181);
  if (age <= 23 && s.playingTime[p] >= 55) r += 0.35;
  return r;
}

function stanceOf(world: World, p: number, rel: number, captain: boolean): Stance {
  const me = persona(world, p);
  if (rel >= 0.55) return 'grateful';
  if (captain || (rel >= 0.1 && me.loyalty > 0.2)) return 'sad';
  if (rel > -0.35) return me.pro > 0.25 || me.media > 0.3 ? 'professional' : rel > 0 ? 'sad' : 'relieved';
  return me.calm < 0 && me.media < 0.3 ? 'critical' : 'relieved';
}

/** The reactions, from the room, after the coach goes: the captain, the ones closest to him, the one he left out. */
function pickReactions(world: World, players: readonly number[], captain: number, signed: ReadonlySet<number>, exit: ManagerExit, coach: string): Reaction[] {
  const s = world.players;
  const live = players.filter((p) => s.isActive(p));
  if (live.length === 0) return [];
  const rel = new Map(live.map((p) => [p, relationship(world, p, signed)]));
  const chosen: number[] = [];
  const take = (p: number | undefined): void => { if (p !== undefined && p >= 0 && rel.has(p) && !chosen.includes(p)) chosen.push(p); };
  take(captain);
  const byRel = [...live].sort((a, b) => rel.get(b)! - rel.get(a)!);
  take(byRel[0]);
  take(live.filter((p) => signed.has(p)).sort((a, b) => s.currentAbility[b] - s.currentAbility[a])[0]);
  // The one with most reason to be unhappy: a good player who did not play.
  const median = [...live].sort((a, b) => s.currentAbility[a] - s.currentAbility[b])[Math.floor(live.length / 2)];
  // A new arrival still settling in has nothing to say about his minutes yet.
  const dropped = byRel.filter((p) => s.currentAbility[p] >= s.currentAbility[median] && !stillSettling(world, p)).at(-1);
  if (dropped !== undefined && rel.get(dropped)! < -0.2) take(dropped);
  take(byRel[1]);
  return chosen.slice(0, 4).map((p, k) => {
    const raw = stanceOf(world, p, rel.get(p)!, p === captain);
    const stance: Stance = (raw === 'critical' || raw === 'relieved') && stillSettling(world, p) ? 'professional' : raw;
    const text = fillCoach(world, compose(world, p, 300 + k, k === 0 ? OPEN[exit] : [''], STANCE_LINES[stance], STANCE_CLOSE[stance]), coach);
    return { p, stance, text };
  });
}

const STANCE_WORD: Record<Stance, string> = {
  grateful: 'grateful', sad: 'saddened', professional: 'measured', relieved: 'relieved', critical: 'critical',
};

/**
 * The manager has left his club, whichever way: the players speak. Their words
 * in the paper and a digest in his inbox. Returns what it does to his name, a
 * factor on his reputation: a little lower for each who speaks against him, a
 * touch higher when the room is grateful.
 */
export function departureReactions(world: World, club: Club, exit: ManagerExit, startDay: number): number {
  const coach = world.manager.lastName;
  const signed = new Set(world.transferLog.filter((t) => t.toClub === club.id && t.day >= startDay).map((t) => t.playerIdx));
  const captain = club.captain ?? -1;
  const reactions = pickReactions(world, club.players, captain, signed, exit, coach);
  return publishDeparture(world, reactions, {
    where: club.name, clubId: club.id, nation: club.nation, captain, exit,
  });
}

/** The same for the national team he leaves: its last squad speaks. */
export function nationalDepartureReactions(world: World, nation: number, sacked: boolean): number {
  const team = world.nationalTeams.find((t) => t.nation === nation);
  if (team === undefined) return 1;
  const s = world.players;
  const squad = team.squad.filter((p) => s.isActive(p));
  const captain = [...squad].sort((a, b) => s.getAttr(b, 'leadership') - s.getAttr(a, 'leadership') || s.nationalCaps[b] - s.nationalCaps[a])[0] ?? -1;
  const reactions = pickReactions(world, squad, captain, new Set(), sacked ? 'sacked' : 'resigned', world.manager.lastName);
  return publishDeparture(world, reactions, { where: nationOf(nation), nation, captain, exit: sacked ? 'sacked' : 'resigned' });
}

function publishDeparture(
  world: World, reactions: Reaction[],
  o: { where: string; clubId?: number; nation: number; captain: number; exit: ManagerExit },
): number {
  if (reactions.length === 0) return 1;
  const s = world.players;
  const name = managerName(world);
  const gone = o.exit === 'sacked' ? 'sacking' : o.exit === 'resigned' ? 'resignation' : 'departure';
  for (const r of reactions) {
    const who = r.p === o.captain ? `${o.where} captain ${s.fullName(r.p)}` : `${s.fullName(r.p)}, ${role(world, r.p)},`;
    postNews(world, {
      kind: 'press',
      headline: `${s.fullName(r.p)} on ${name}: "${firstLine(r.text)}"`,
      body: `${cap(who)} sounded ${STANCE_WORD[r.stance]} speaking about ${name}'s ${gone}. "${r.text}"`,
      nation: o.nation,
      clubId: o.clubId,
      playerIdx: r.p,
      fans: { story: r.stance === 'critical' || r.stance === 'relieved' ? 'playerUpset' : 'coachFarewell', club: o.clubId, nation: o.clubId === undefined ? o.nation : undefined, player: r.p, coach: name },
      quote: { p: r.p, text: r.text },
    });
  }
  // One letter for the manager, with all of it.
  const warm = reactions.filter((r) => r.stance === 'grateful' || r.stance === 'sad').length;
  const cold = reactions.filter((r) => r.stance === 'critical').length;
  postMessage(world, {
    category: 'news', from: 'Press Office',
    clubId: o.clubId,
    subject: `${o.where}'s players react to your ${gone}`,
    body: `The ${o.clubId !== undefined ? 'dressing room' : 'squad'} at ${o.where} has spoken to the press about your ${gone}. ` +
      (warm > cold ? 'Most of what was said was warm.' : cold > 0 ? 'Not everyone was kind.' : 'The tone was measured.') + '\n\n' +
      reactions.map((r) => `${s.fullName(r.p)} (${STANCE_WORD[r.stance]}): "${r.text}"`).join('\n\n'),
  });
  return Math.max(0.985, Math.min(1.01, 1 + warm * 0.002 - cold * 0.005));
}

// ---- Awards and their dedications -------------------------------------------------------

const AWARD_OPEN_HUMBLE = [
  'I am very happy, but this belongs to the whole group.',
  'Individual awards are nice, but I would swap it for a trophy with the team any day.',
  'Honestly, I did not expect it.',
  'Without my teammates I would not be standing here with this.',
  'It is an honour. There are so many great players in this league.',
  'I am a bit embarrassed, to be honest. Volleyball is a team sport.',
];
const AWARD_OPEN_PROUD = [
  'I worked very hard for this and I am proud of it.',
  'I knew I could play at this level. Now I want more.',
  'This is only the start.',
  'I said at the start of the season that I wanted to be the best. I meant it.',
  'Nobody gave me this, I earned it in the gym.',
];
const DEDICATE_FAMILY = [
  'I dedicate it to my family, they have been with me since the very first day.',
  'This one is for my mum, who drove me to every training session when I was a kid.',
  'It is for my dad. He taught me to play in the garden.',
  'I dedicate it to my partner, who puts up with me after the bad nights.',
  'This is for my little one at home, who does not care about volleyball at all, and that keeps me sane.',
  'It goes to my brother. He played too, and he was better than me.',
];
const DEDICATE_LOSS = [
  'I want to dedicate it to my grandfather. He passed away last year and he never missed a match. I know he was watching.',
  'It is for my grandmother, who is not with us any more. She would have loved this.',
  'This one is for my uncle, who left us this season. He was my biggest fan.',
  'I dedicate it to my old coach from the youth team, who died in the summer. Everything started with him.',
];
const DEDICATE_TEAM = [
  'I want to share it with {mate}. Nobody sees the work done for me every single night.',
  'This is for {mate} and the rest of the group.',
  'It belongs to the guys who do not play much and push us every day in training.',
  'I have to thank {coach}, who trusted me from day one.',
  'This one is for the staff, the physios, everyone behind the scenes.',
];
const DEDICATE_FANS = [
  'It is for the fans of {club}. They have carried us all season.',
  'I dedicate it to the people of {club}. This club is my home.',
  'This is for everyone back home in {nation}.',
  'For the fans who travel everywhere with us. You are the best.',
];
const AWARD_CLOSE = ['', 'Tomorrow it is back to work.', 'Now let us win something together.', 'The next goal is a title.', ''];

/** A player on an award: how he takes it, and who he gives it to. */
export function awardQuote(world: World, p: number, award: string): string {
  const me = persona(world, p);
  const clubId = world.players.clubId[p];
  const open = me.ambition > 0.35 && me.confidence > 0.1 ? AWARD_OPEN_PROUD : AWARD_OPEN_HUMBLE;
  const r = roll(world, p, 41);
  const to = r < 0.12 ? DEDICATE_LOSS
    : me.loyalty > 0.3 && r < 0.5 ? DEDICATE_FANS
      : me.teamwork > 0.2 && r < 0.65 ? DEDICATE_TEAM
        : r < 0.75 ? DEDICATE_FANS : r < 0.85 ? DEDICATE_TEAM : DEDICATE_FAMILY;
  return compose(world, p, 40, open, to, AWARD_CLOSE)
    .replaceAll('{mate}', mateOf(world, p, clubId))
    .replaceAll('{coach}', coachOf(world, clubId))
    .replaceAll('{club}', clubName(world, clubId))
    .replaceAll('{nation}', homeIn(world.players.nation[p]))
    .replaceAll('{award}', award);
}

/** A season's award, a story of its own with the winner's words. */
export function seasonAwardStory(world: World, p: number, title: string, competitionId?: number): void {
  const s = world.players;
  const clubId = s.clubId[p];
  const club = clubId >= 0 ? world.clubs[clubId] : undefined;
  if (!isOurs(world, p) && !followed(world, club)) return;
  const text = awardQuote(world, p, title);
  quoteStory(world, p, text, {
    kind: 'award',
    headline: `${s.fullName(p)} is the ${title}`,
    lead: `${s.fullName(p)}${club !== undefined ? ` of ${club.name}` : ''} has been named the ${title}, and spoke after receiving it.`,
    clubId: club?.id, nation: club?.nation ?? s.nation[p], competitionId,
    fans: { story: 'playerAward', club: club?.id, player: p },
    subject: `${s.fullName(p)}, ${title}, speaks to the press`,
  });
}

// ---- After a match ------------------------------------------------------------------------

const MISS_OPEN: Partial<Record<NonNullable<MatchResult['lastPoint']>['kind'], readonly string[]>> = {
  serveError: ['I missed the serve on match point, and that is on me.', 'The last serve went into the net. I can see it every time I close my eyes.', 'I missed the serve at the worst moment.'],
  attackError: ['The last attack went out.', 'I had the last ball and I put it out.', 'I wanted to finish it, and it went long.'],
  blocked: ['They blocked me on the last ball.', 'I got stuffed on match point, it happens.', 'Their block read me on the last attack.'],
  receptionError: ['I could not control the last pass.', 'The last serve came to me and I did not get it up.', 'They served at me on match point and they were right to.'],
  setError: ['The last set was mine, and it was not good enough.', 'I made a mistake with the last set.'],
  digError: ['The last ball came at me and I could not keep it alive.', 'I was a fraction late on the last dig.'],
};
const MISS_BRAVE = [
  'But if the ball comes to me again in the same moment, I will take it again. That is my job.',
  'I am not afraid. Next time I want that ball.',
  'I would do exactly the same thing tomorrow. You do not win anything by hiding.',
  'Give me that ball a hundred times and I will take it a hundred times.',
  'It will not change the way I play. The big moments are why I play this sport.',
];
const MISS_HURT = [
  'It hurts. I let the team down at the worst moment. I will be back.',
  'I could not sleep. But I will work, and the next time will be different.',
  'I need a few days to digest it. Then I want the ball again.',
];
const MISS_PRO = [
  'But one point does not decide a match, there were two hundred before it. I accept my part.',
  'A tie-break is decided by details, and this detail was mine. We learn and we go again.',
  'The coach told me to keep my head up. That is what I will do.',
];
const BACKING = [
  'We win together and we lose together. {p} will take that ball again and win us the next one.',
  'Nobody in this dressing room blames {p}. Without {p} we would not even have reached the tie-break.',
  '{p} has won us dozens of points like that. One went the wrong way, that is all.',
  'I would give {p} the last ball again tomorrow.',
];

const WIN_LINES = [
  'What a night. The whole team was incredible.',
  'We suffered, but this group never gives up.',
  'I just tried to help the team. The points came.',
  'These are the matches you remember.',
  'I was feeling it tonight. My setter kept giving me good balls, so I kept hitting.',
  'Big win. Tomorrow we recover and start again.',
  'The crowd carried us. Thank you to everyone who came.',
];
const WIN_DEDICATE = [
  '', '', 'This one is for my family, who were in the stands.', 'I dedicate this win to the fans.',
  'This one is for {mate}, who played through pain tonight.', 'It is for a friend who is going through a hard time. Stay strong.',
];
const DEBUT_LINES = [
  'A dream come true. I have been waiting for this moment since I was a kid.',
  'I was so nervous before the first serve. After that, it was just volleyball.',
  'I want to thank {coach} for the chance. I will try to repay it.',
  'My family was in the stands. I could not stop smiling.',
  'I will keep the shirt from tonight for ever.',
  'The senior players helped me so much, they told me to just enjoy it.',
];
const DEBUT_CLOSE = ['', 'Now I want to earn a place.', 'This is only the first one.', 'I want many more.'];

/** The man of the match, the debutant, the milestone, and the one who gave the last point away. */
export function matchVoices(
  world: World, fixture: Fixture, homeStats: ReadonlyMap<number, PlayerMatchStats>, awayStats: ReadonlyMap<number, PlayerMatchStats>,
  lastPoint?: MatchResult['lastPoint'],
): void {
  const home = world.clubs[fixture.home];
  const away = world.clubs[fixture.away];
  if (home === undefined || away === undefined) return;
  const mine = fixture.home === world.userClubId || fixture.away === world.userClubId;
  if (!mine && !followed(world, home) && !followed(world, away)) return;
  const s = world.players;
  const homeWon = fixture.homeSets > fixture.awaySets;
  const score = homeWon ? `${fixture.homeSets}-${fixture.awaySets}` : `${fixture.awaySets}-${fixture.homeSets}`;
  // A tie-break: the loser took sets enough to make it the deciding one.
  const loserSets = Math.min(fixture.homeSets, fixture.awaySets);
  const decider = loserSets > 0 && Math.abs(fixture.homeSets - fixture.awaySets) === 1;

  if (lastPoint !== undefined && decider) {
    const p = lastPoint.player;
    const clubId = s.clubId[p];
    const club = world.clubs[clubId];
    const other = clubId === home.id ? away : home;
    if (club !== undefined && s.isActive(p) && rareMoment(world, p, 61)) {
      const me = persona(world, p);
      const bold = me.confidence + me.composure * 0.6 + me.calm * 0.3;
      const after = bold > 0.25 ? MISS_BRAVE : me.pro > 0.2 ? MISS_PRO : bold < -0.35 ? MISS_HURT : MISS_BRAVE;
      const text = compose(world, p, 60, MISS_OPEN[lastPoint.kind] ?? ['The last point was mine.'], after);
      quoteStory(world, p, text, {
        headline: `${s.fullName(p)}: "${firstLine(after === MISS_HURT ? text : pick(after, world, p, 67))}"`,
        lead: `${s.fullName(p)} gave away the last point of the deciding set as ${club.name} lost ${score} to ${other.name}. Afterwards:`,
        clubId, nation: club.nation,
        fans: { story: 'playerBrave', club: clubId, other: other.id, player: p },
        subject: `${s.fullName(p)} on the last point`,
      });
      // The captain stands by him.
      const capt = club.captain;
      if (capt !== undefined && capt !== p && s.isActive(capt) && s.clubId[capt] === clubId && roll(world, capt, 62) < 0.5) {
        const line = pick(BACKING, world, capt, 63).replaceAll('{p}', s.surname(p));
        quoteStory(world, capt, line, {
          lead: `${club.name} captain ${s.fullName(capt)} backed ${s.fullName(p)} after the defeat to ${other.name}:`,
          clubId, nation: club.nation,
          fans: { story: 'playerWord', club: clubId, player: capt },
        });
        if (isOurs(world, p)) s.morale[p] = Math.min(100, s.morale[p] + 3);
      }
    }
  }

  // The match winner.
  const mvp = fixture.mvp;
  if (mvp >= 0 && s.isActive(mvp)) {
    const clubId = s.clubId[mvp];
    const club = world.clubs[clubId];
    const other = clubId === home.id ? away : home;
    // His own club's matches; elsewhere, only a final.
    const big = fixture.importance >= 0.95;
    if (club !== undefined && (big || mine) && commonMoment(world, mvp, clubId, 71)) {
      const text = compose(world, mvp, 70, WIN_LINES, WIN_DEDICATE).replaceAll('{mate}', mateOf(world, mvp, clubId));
      quoteStory(world, mvp, text, {
        lead: `${s.fullName(mvp)} was the player of the match as ${club.name} beat ${other.name} ${score}.`,
        clubId, nation: club.nation,
        fans: { story: 'playerWord', club: clubId, other: other.id, player: mvp },
        subject: `${s.fullName(mvp)}, player of the match, speaks`,
      });
    }
  }

  // Debuts and milestones: the engine has counted the match already.
  for (const stats of [homeStats, awayStats]) {
    for (const [p, st] of stats) {
      if (st.ralliesPlayed === 0) continue;
      const n = s.careerMatches[p];
      if (n === 1) debutVoice(world, p);
      else if (n >= 100 && n % 100 === 0) milestoneVoice(world, p, n, 'matches');
    }
  }
}

function debutVoice(world: World, p: number): void {
  const s = world.players;
  const clubId = s.clubId[p];
  const club = world.clubs[clubId];
  if (club === undefined) return;
  // A first match counts for a youngster; a generated veteran's empty record is not a debut.
  if (s.ageOn(p, world.year, 181) > 20) return;
  const promising = s.potentialAbility[p] >= 1300;
  if (isOurs(world, p) ? quotesThisWeek(world, clubId) >= 3 : !(promising && followed(world, club) && rareMoment(world, p, 81))) return;
  const text = compose(world, p, 80, DEBUT_LINES, DEBUT_CLOSE).replaceAll('{coach}', coachOf(world, clubId));
  quoteStory(world, p, text, {
    lead: `${s.fullName(p)}, ${s.ageOn(p, world.year, 181)}, made a senior debut for ${club.name}.`,
    clubId, nation: club.nation,
    fans: { story: 'playerWord', club: clubId, player: p },
    subject: `${s.fullName(p)} on a first senior match`,
  });
}

const MILESTONE_LINES = [
  'I remember the first one like it was yesterday. Time flies.',
  'I never counted. My mum did, she has every match written down.',
  'It means I have been lucky with injuries, and that coaches trusted me.',
  'A number like that is for the people who helped me get here.',
  'I hope there are many more. I still feel like a kid when I walk out.',
  'Every one of them taught me something, the defeats most of all.',
];

function milestoneVoice(world: World, p: number, n: number, what: 'matches' | 'caps', nation?: number): void {
  const s = world.players;
  const clubId = s.clubId[p];
  const club = clubId >= 0 ? world.clubs[clubId] : undefined;
  const ours = isOurs(world, p);
  if (!ours && (what === 'matches' ? !followed(world, club) : s.currentAbility[p] < 1150)) return;
  const text = compose(world, p, 90, MILESTONE_LINES, what === 'caps' ? ['Wearing this shirt is the biggest honour there is.', 'Playing for my country never gets old.'] : ['', 'Now I want to make it a few more.']);
  quoteStory(world, p, text, {
    headline: what === 'caps' ? `${s.fullName(p)} wins cap number ${n}` : `${s.fullName(p)} reaches ${n} matches`,
    lead: what === 'caps'
      ? `${s.fullName(p)} has played ${n} times for ${nationOf(nation ?? s.nation[p])}.`
      : `${s.fullName(p)} has played ${n} senior matches.`,
    clubId: what === 'caps' ? undefined : club?.id, nation: what === 'caps' ? (nation ?? s.nation[p]) : club?.nation ?? s.nation[p],
    fans: { story: 'playerWord', club: what === 'caps' ? undefined : club?.id, nation: what === 'caps' ? (nation ?? s.nation[p]) : undefined, player: p },
    subject: `${s.fullName(p)}: ${n} ${what}`,
  });
}

/** A national match just played: the caps that are milestones, and the last point of a tie-break. */
export function intlMatchVoices(
  world: World, home: number, away: number, homeSets: number, awaySets: number, competition: string,
  played: readonly number[], lastPoint?: MatchResult['lastPoint'],
): void {
  const s = world.players;
  const mineNation = world.career.nationalTeam;
  for (const p of played) {
    const c = s.nationalCaps[p];
    if (c === 50 || c === 100 || c === 150 || c === 200) {
      const nation = world.nationalTeams.find((t) => t.squad.includes(p))?.nation ?? s.nation[p];
      milestoneVoice(world, p, c, 'caps', nation);
    }
  }
  const loserSets = Math.min(homeSets, awaySets);
  if (lastPoint === undefined || loserSets === 0 || Math.abs(homeSets - awaySets) !== 1) return;
  const lost = lastPoint.team === 0 ? home : away;
  const won = lastPoint.team === 0 ? away : home;
  const p = lastPoint.player;
  if (lost !== mineNation && won !== mineNation && s.currentAbility[p] < 1250) return;
  if (!rareMoment(world, p, 66)) return;
  const me = persona(world, p);
  const after = me.confidence + me.composure * 0.6 > 0.2 ? MISS_BRAVE : me.pro > 0.2 ? MISS_PRO : MISS_HURT;
  const text = compose(world, p, 65, MISS_OPEN[lastPoint.kind] ?? ['The last point was mine.'], after);
  quoteStory(world, p, text, {
    lead: `${s.fullName(p)} gave away the last point of the deciding set as ${nationOf(lost)} lost to ${nationOf(won)} at the ${competition}. Afterwards:`,
    nation: lost,
    fans: { story: 'playerBrave', nation: lost, otherNation: won, player: p },
    subject: `${s.fullName(p)} on the last point`,
  });
}

// ---- Back from injury ----------------------------------------------------------------------

const LONG_INJURIES: ReadonlySet<number> = new Set([
  InjuryType.ACLTear, InjuryType.AchillesTear, InjuryType.KneeCartilage, InjuryType.Back, InjuryType.Shoulder, InjuryType.FingerFracture,
]);

const COMEBACK = [
  'These were the hardest months of my career.',
  'There were days I thought about everything, even stopping.',
  'Watching from the stands is the worst thing for a player.',
  'I have been counting the days.',
  'Every morning in the gym alone, I thought about this moment.',
];
const COMEBACK_THANKS = [
  'I have to thank the medical staff, they were incredible.',
  'My family carried me through it.',
  'The messages from the fans kept me going.',
  'My teammates never let me feel left out.',
];
const COMEBACK_CLOSE = ['Now I am ready.', 'I am stronger than before.', 'I just want to play.', 'Step by step.'];

/** Fit again after a long one: he says how it was. `type` is the injury he is over. */
export function comebackVoice(world: World, p: number, type: number): void {
  if (!LONG_INJURIES.has(type)) return;
  const s = world.players;
  const clubId = s.clubId[p];
  const club = clubId >= 0 ? world.clubs[clubId] : undefined;
  if (club === undefined) return;
  // Elsewhere only the knee and the Achilles make the paper, and only for a name.
  const serious = type === InjuryType.ACLTear || type === InjuryType.AchillesTear || type === InjuryType.KneeCartilage;
  if (!isOurs(world, p) && !(serious && s.currentAbility[p] >= 1300 && followed(world, club) && rareMoment(world, p, 101))) return;
  const text = compose(world, p, 100, COMEBACK, COMEBACK_THANKS, COMEBACK_CLOSE);
  quoteStory(world, p, text, {
    lead: `${s.fullName(p)} is back in full training with ${club.name} after a long injury.`,
    clubId, nation: club.nation,
    fans: { story: 'playerWord', club: clubId, player: p },
    subject: `${s.fullName(p)} on the way back`,
  });
}

// ---- Moves, new deals, the bench ---------------------------------------------------------------

const ARRIVE = [
  'I am proud to be here. {club} is a big club and I came to win.',
  'When {club} called, I did not have to think twice.',
  'I spoke with {coach} and the project convinced me straight away.',
  'This is a new chapter. I cannot wait to meet the fans.',
  'I have heard so much about the atmosphere in this arena. Now I get to feel it.',
  'It is a step forward in my career, and I am ready for it.',
];
const ARRIVE_AMBITIOUS = ['I want titles, simple as that.', 'I did not come here to sit on the bench.', 'My goal is to be one of the best in the league.'];
const ARRIVE_MODEST = ['I will work hard and earn my place.', 'I just want to help the team.', 'First I have to adapt, then we will see.'];
const LEAVE = [
  'I want to thank everyone at {old}. You will always be in my heart.',
  'Leaving {old} was not easy. I gave everything for that shirt.',
  'Thank you, {old}. It was an honour.',
  '{old} made me the player I am. Thank you for everything.',
];
const LEAVE_COLD = ['It was time for a change.', 'I needed to play more, and here I will.', 'Some things did not work out at {old}. Now I look forward.'];

/** A player on his move: hello to the new club, and maybe a word for the old. Null when he says nothing. */
export function arrivalQuote(world: World, p: number, fromId: number, toId: number): string | null {
  const ours = isOurs(world, p) || fromId === world.userClubId;
  if (!ours && roll(world, p, 111) > 0.5) return null;
  const me = persona(world, p);
  const from = fromId >= 0 ? world.clubs[fromId] : undefined;
  const happyThere = world.players.morale[p] >= 45 || me.loyalty > 0.2;
  const text = compose(world, p, 110,
    from !== undefined && roll(world, p, 112) < 0.55 ? (happyThere ? LEAVE : LEAVE_COLD) : [''],
    ARRIVE, me.ambition > 0.3 ? ARRIVE_AMBITIOUS : ARRIVE_MODEST);
  return text.replaceAll('{club}', clubName(world, toId)).replaceAll('{coach}', coachOf(world, toId)).replaceAll('{old}', from?.name ?? 'my old club');
}

const RENEW = [
  'I am very happy here. {club} is my home.',
  'It was never about the money. I want to win here.',
  'There were other offers, but my heart is here.',
  'The project convinced me. We are building something.',
  'I signed in five minutes. I did not even need to read it.',
  'I want to give this club everything I have for the years to come.',
];
const RENEW_AMBITIOUS = ['Now we have to win a title together.', 'I stay because this club is as ambitious as I am.'];
const RENEW_CLOSE = ['Thanks to the fans for the love.', '', 'Now let us get back to work.'];

/** A player on his new contract. */
export function renewalQuote(world: World, p: number, clubId: number): string {
  const me = persona(world, p);
  return compose(world, p, 120, RENEW, me.ambition > 0.3 ? RENEW_AMBITIOUS : RENEW_CLOSE).replaceAll('{club}', clubName(world, clubId));
}

/** One of the manager's players renews: the paper hears it, so does the inbox. */
export function renewalStory(world: World, p: number, club: Club): void {
  const s = world.players;
  const text = renewalQuote(world, p, club.id);
  quoteStory(world, p, text, {
    kind: 'contract',
    headline: `${s.fullName(p)} signs a new deal with ${club.name}`,
    lead: `${s.fullName(p)} has extended ${playerHis(world)} stay at ${club.name}.`,
    clubId: club.id, nation: club.nation,
    fans: { story: 'extension', club: club.id, player: p },
    subject: `${s.fullName(p)} on the new contract`,
  });
}

const BENCH_PRO = [
  'I respect the coach\'s decisions. My job is to train hard and be ready.',
  'Of course I want to play more, every player does. I will keep working.',
  'The team is winning, that is what matters. My moment will come.',
  'I talk with the coach, it is all very clear. I just have to be better in training.',
];
const BENCH_UNHAPPY = [
  'I am not here to sit on the bench. I want to play.',
  'Nobody has explained to me why I am not playing. That is hard to accept.',
  'I did not come here to watch. If it cannot happen here, we will see in the summer.',
  'I feel I deserve more minutes. I have said it to the coach, now I am saying it to you.',
];

/** One of the manager's players, short of games, says so in public: patient or not, as he is. */
export function benchedVoice(world: World, p: number, club: Club): void {
  const s = world.players;
  const me = persona(world, p);
  const patient = me.pro + me.calm * 0.5 > 0.1;
  const text = pick(patient ? BENCH_PRO : BENCH_UNHAPPY, world, p, 130);
  quoteStory(world, p, text, {
    lead: `${s.fullName(p)} has barely played for ${club.name} lately, and was asked about it.`,
    clubId: club.id, nation: club.nation,
    fans: { story: patient ? 'playerWord' : 'playerUpset', club: club.id, player: p },
    subject: patient ? `${s.fullName(p)} on the lack of games` : `${s.fullName(p)} unhappy in public`,
  });
  // Saying it out loud does not help him in the dressing room.
  if (!patient) s.morale[p] = Math.max(0, s.morale[p] - 2);
}

// ---- Retirement ----------------------------------------------------------------------------

const RETIRE_ANNOUNCE = [
  'It is time. My body has been telling me for a while.',
  'I wanted to stop while I can still play at a good level.',
  'I have thought about it for months. It is the right moment.',
  'I want to enjoy this last season, every single match.',
];
const RETIRE_FINAL = [
  'Thank you, volleyball. You gave me everything.',
  'I played my last match today. I am not sad, I am grateful.',
  'I will miss the dressing room more than the matches.',
  'It is strange to think I will not serve again.',
];
const RETIRE_THANKS = [
  'Thank you to my family, who sacrificed so much.',
  'Thanks to every coach and teammate I had.',
  'To the fans: you made every night special.',
  'My kids can finally have their {parent} at home on weekends.',
];

/** A player on his retirement, as he announces it or as he goes. */
export function retirementQuote(world: World, p: number, final: boolean): string {
  return compose(world, p, final ? 140 : 145, final ? RETIRE_FINAL : RETIRE_ANNOUNCE, RETIRE_THANKS)
    .replace('{parent}', world.gender === 'women' ? 'mum' : 'dad');
}

/** Whether a player is someone who speaks at all, here: active and on someone's books. */
export function canSpeak(world: World, p: number): boolean {
  return p >= 0 && world.players.isActive(p) && !world.players.hasFlag(p, PlayerFlag.Retired);
}
