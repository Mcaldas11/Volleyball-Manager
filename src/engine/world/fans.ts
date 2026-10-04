/**
 * The fans have their say: under every story in the news, supporters of the
 * clubs — or the national teams — in it, reacting the way fans do. A signing
 * delights the club that made it and stings the one that lost him; a sacking
 * is overdue to some and harsh to others; a shock result has one end crowing
 * and the other furious; a rival's fans chip in, and enjoy it.
 *
 * A story records what its comments turn on — its `fans` brief: who it is
 * about, on which side, and the score, fee or name that matters — and the
 * comments are written from it as the story is read. They are drawn from a
 * generator seeded by the story, so they read the same every time and cost
 * the save nothing.
 */

import { Rng } from '../core/rng.ts';
import type { Club } from '../model/club.ts';
import { POSITION_NAMES, type Position } from '../model/positions.ts';
import { cityBankFor } from './cities.ts';
import { bankFor } from './names.ts';
import { NATIONS } from './nations.ts';
import type { World } from './world.ts';

/** What a story is, as the fans see it. */
export type FanStory =
  | 'rumour' | 'signing' | 'extension' | 'sacked' | 'appointed' | 'injury' | 'shock' | 'top'
  | 'playerAward' | 'coachAward' | 'title' | 'match'
  | 'nationTitle' | 'nationShock' | 'nationMatch' | 'nationCoachIn' | 'nationCoachOut' | 'tournament' | 'qualified';

/** What a story's comments turn on. */
export interface FanBrief {
  story: FanStory;
  /** The club the story is mostly about — the buyer, the winner, the leader — and the other side of it. */
  club?: number;
  other?: number;
  /** The same for national teams. */
  nation?: number;
  otherNation?: number;
  player?: number;
  /** A coach's name — the one thing the world can't give back later. */
  coach?: string;
  /** From the winners' side: "3-1". */
  score?: string;
  fee?: number;
  weeks?: number;
  /** The competition, by name. */
  comp?: string;
}

export type FanMood = 'delighted' | 'happy' | 'neutral' | 'worried' | 'angry';

export interface FanComment {
  handle: string;
  /** Whose fan: a club's, or a nation's. */
  clubId?: number;
  nation?: number;
  text: string;
  likes: number;
  mood: FanMood;
}

/** Who is talking: the main side's fans, the other side's, a rival's, or a neutral's. */
type Side = 'club' | 'other' | 'rival' | 'nation' | 'otherNation' | 'neutral';
type Line = readonly [FanMood, string];

/**
 * What each side says, by story. Placeholders: {p} the player's surname,
 * {pos} his position, {c} and {o} the two clubs, {n} and {on} the two
 * nations, {coach}, {score}, {fee}, {weeks}, {comp}.
 */
const VOICES: Readonly<Record<FanStory, Partial<Record<Side, readonly Line[]>>>> = {
  rumour: {
    club: [
      ['delighted', 'Get {p} signed! Exactly the {pos} we need.'],
      ['happy', "If we can get {p} on a free, that's a no-brainer."],
      ['neutral', "Heard this one before. I'll believe it when he's in our shirt."],
      ['worried', 'Is {p} really an upgrade on what we have? Not sure.'],
      ['happy', '{p} in our colours next season? Yes please.'],
      ['neutral', 'Would rather we spent the money on a proper middle blocker.'],
    ],
    other: [
      ['worried', "Please don't let {p} walk for nothing..."],
      ['angry', 'If {p} wants to leave, fine. Nobody is bigger than {o}.'],
      ['worried', 'The board need to tie {p} down NOW.'],
      ['neutral', 'Same story every summer. He stays.'],
      ['angry', 'Typical {c}, sniffing around our best players again.'],
    ],
    rival: [
      ['neutral', '{c} can have him. Overrated anyway.'],
      ['happy', '{o} fans in pieces over a rumour, love it.'],
    ],
  },
  signing: {
    club: [
      ['delighted', 'WHAT A SIGNING. {p} is ours!'],
      ['happy', 'Solid business. {p} fills a real gap at {pos}.'],
      ['delighted', 'Calling it now: {p} wins us something this year.'],
      ['worried', '{fee} for {p}? Hope he is worth it.'],
      ['neutral', "Need to see him play a full match before I get excited."],
      ['happy', "Welcome {p}! Can't wait to see you in our arena."],
    ],
    other: [
      ['worried', 'Gutted to lose {p}. Good luck, mate.'],
      ['angry', '{p} off to {c}... no loyalty in this sport any more.'],
      ['happy', 'Good money for {p}. The board did well there.'],
      ['neutral', 'Thanks for everything, {p}.'],
      ['angry', 'Who replaces {p}? Nobody. Brilliant planning.'],
    ],
    rival: [
      ['neutral', '{c} spending big again.'],
      ['angry', 'Of course {p} goes to {c}. Same old.'],
      ['happy', "{p} at {c}? He'll be on their bench by Christmas."],
    ],
  },
  extension: {
    club: [
      ['delighted', '{p} staying! Best news all week.'],
      ['happy', 'Great to see {p} commit. Build the team around him.'],
      ['neutral', 'About time. Should have been done months ago.'],
      ['happy', 'One of us. Thank you {p}!'],
    ],
    rival: [
      ['worried', 'Damn, I was hoping {p} would come to us.'],
      ['neutral', 'Fair play to {c}, keeping their best players.'],
    ],
  },
  sacked: {
    club: [
      ['angry', 'About time. Should have happened months ago.'],
      ['happy', 'Thank you {coach}, but it was the right call.'],
      ['worried', "Who's coming in now? The board had better have a plan."],
      ['angry', 'Harsh. The players should be taking the blame, not {coach}.'],
      ['neutral', 'Sad way to end. {coach} gave everything for this club.'],
    ],
    rival: [
      ['happy', 'Chaos at {c}. Love to see it.'],
      ['neutral', "{coach} will find another job quickly. Decent coach."],
    ],
  },
  appointed: {
    club: [
      ['happy', "Welcome {coach}! Let's go!"],
      ['worried', "{coach}? Not convinced, but I'll give him a chance."],
      ['delighted', 'Great appointment. Exactly the coach we needed.'],
      ['neutral', 'Results will tell. Welcome anyway.'],
      ['worried', 'Never heard of {coach}. Prove me wrong.'],
      ['happy', 'Fresh ideas, fresh energy. Welcome to {c}, {coach}!'],
    ],
    rival: [
      ['neutral', 'Interesting choice by {c}.'],
      ['happy', '{coach} at {c}? That should keep them mid-table.'],
    ],
  },
  injury: {
    club: [
      ['worried', '{weeks} weeks without {p}?! There goes the season.'],
      ['worried', 'Get well soon, {p}. We need you back for the run-in.'],
      ['angry', 'The medical team need to answer some questions.'],
      ['neutral', 'Next man up. The squad is deep enough.'],
    ],
    rival: [
      ['happy', 'Bad news for {c}, good news for the rest of us.'],
      ['neutral', 'Never nice to see. Get well, {p}.'],
    ],
  },
  shock: {
    club: [
      ['delighted', 'WHAT A NIGHT! {score} against {o}!!'],
      ['delighted', "Nobody gave us a chance. Who's laughing now?"],
      ['happy', "That's the {c} I know. Proud of every player."],
      ['happy', 'Frame that scoreboard.'],
    ],
    other: [
      ['angry', 'Embarrassing. Absolutely embarrassing.'],
      ['angry', 'Losing to {c}? Coach out.'],
      ['worried', "Worrying signs. That's not the {o} we know."],
      ['angry', 'Some of these players should be ashamed of themselves.'],
    ],
    rival: [
      ['happy', '{o} losing to {c}. My weekend is made.'],
    ],
  },
  top: {
    club: [
      ['delighted', 'TOP OF THE LEAGUE! Stay there, lads!'],
      ['happy', 'Top spot, and fully deserved.'],
      ['neutral', 'Long way to go. Feet on the ground.'],
      ['happy', 'Look at the table. Just look at it.'],
    ],
    other: [
      ['worried', 'Lost top spot. We need a reaction.'],
      ['angry', 'Thrown away. Again.'],
    ],
    rival: [
      ['neutral', "{c} top? Let's see where they are in April."],
    ],
  },
  playerAward: {
    club: [
      ['delighted', '{p} deserves it! Best in the league right now.'],
      ['happy', 'Well deserved, {p}. Keep it going!'],
      ['happy', 'Told you all he was the real deal.'],
    ],
    rival: [
      ['angry', '{p}? Robbed. Ours was better all month.'],
      ['neutral', "Fair enough, he's been brilliant."],
    ],
  },
  coachAward: {
    club: [
      ['happy', 'Coach of the month, and deserved!'],
      ['delighted', 'In {coach} we trust!'],
      ['neutral', 'Nice, but the trophies are what count.'],
    ],
    rival: [
      ['neutral', "Let's see if he can keep it up."],
      ['angry', 'The curse of coach of the month. Watch them lose next week.'],
    ],
  },
  title: {
    club: [
      ['delighted', 'CHAMPIONS!!! What a season!'],
      ['delighted', "I've waited years for this. I'm actually crying."],
      ['delighted', '{comp} champions... say it again!'],
      ['happy', 'Every player, every coach: legends, all of them.'],
      ['happy', 'Party in the city tonight!'],
    ],
    rival: [
      ['angry', 'Congrats, I guess. Next season is ours.'],
      ['neutral', 'Deserved, to be fair. Best team all year.'],
    ],
  },
  match: {
    club: [
      ['delighted', 'Get in! {score}!'],
      ['happy', 'Three points, job done.'],
      ['happy', '{p} was unreal tonight.'],
      ['happy', 'Great performance from everyone.'],
      ['neutral', 'Not pretty, but a win is a win.'],
    ],
    other: [
      ['angry', 'Not good enough. Again.'],
      ['worried', "Sort out the reception, it's killing us."],
      ['angry', 'The coach has to answer for that one.'],
      ['neutral', 'Bad night. On to the next one.'],
      ['worried', "We can't keep giving away sets like that."],
    ],
    rival: [
      ['neutral', 'Expected result, to be honest.'],
    ],
  },
  nationTitle: {
    nation: [
      ['delighted', 'CHAMPIONS! So proud of this team!'],
      ['delighted', '{n} on top of the world!'],
      ['happy', '{p} — what a tournament!'],
      ['delighted', 'Best day of my life. Thank you, boys!'],
    ],
    otherNation: [
      ['worried', 'So close. Heads up, {on}.'],
      ['angry', 'We bottled the final.'],
      ['neutral', 'Silver is still a medal. Proud of them.'],
    ],
    neutral: [
      ['neutral', '{n} deserved it. Best team all tournament.'],
    ],
  },
  nationShock: {
    nation: [
      ['delighted', 'Giant killers! Come on {n}!'],
      ['happy', 'Best result in years for us.'],
    ],
    otherNation: [
      ['angry', 'Losing to {n}?! Disgraceful.'],
      ['worried', 'Big worries before the knockouts.'],
    ],
    neutral: [
      ['happy', 'This is why we love tournaments.'],
    ],
  },
  nationMatch: {
    nation: [
      ['delighted', '{score}! Come on {n}!'],
      ['happy', 'Job done. On to the next one.'],
      ['happy', '{p} was everywhere tonight.'],
    ],
    otherNation: [
      ['angry', 'No fight. Nothing.'],
      ['worried', 'We have to be much better than that.'],
      ['neutral', 'Lost to the better team tonight.'],
    ],
  },
  nationCoachIn: {
    nation: [
      ['happy', 'New coach, new hope.'],
      ['worried', 'I hope the federation got this one right.'],
      ['neutral', 'Give him time. A national team is not built in a summer.'],
      ['delighted', 'Finally someone with ideas!'],
    ],
  },
  nationCoachOut: {
    nation: [
      ['angry', 'Should have gone after the last tournament.'],
      ['neutral', 'Thanks for the effort. Time for a change.'],
      ['worried', "Who on earth do we get now?"],
    ],
  },
  qualified: {
    nation: [
      ['delighted', "We're in! Job done, {n}!"],
      ['happy', 'Never in doubt. Now for the real thing.'],
      ['neutral', 'Qualifying is the minimum. Let us see what we do there.'],
    ],
    otherNation: [
      ['angry', 'Missing out again. Embarrassing for a country like ours.'],
      ['worried', 'The federation has to look at itself after this.'],
      ['neutral', 'We were not good enough. Simple as that.'],
    ],
    neutral: [
      ['neutral', 'Some big names stayed at home this time.'],
    ],
  },
  tournament: {
    nation: [
      ['happy', 'Home crowd will carry us all the way!'],
      ['neutral', 'Tricky group, but doable.'],
      ['delighted', 'Our year. I can feel it.'],
    ],
    neutral: [
      ['neutral', "Can't wait for this one."],
      ['happy', 'Dark horses this year: watch out for us.'],
    ],
  },
};

/** How many comments a story draws. */
const COMMENTS: Readonly<Record<FanStory, number>> = {
  rumour: 4, signing: 5, extension: 3, sacked: 4, appointed: 4, injury: 3, shock: 5, top: 4,
  playerAward: 3, coachAward: 3, title: 6, match: 5,
  nationTitle: 6, nationShock: 4, nationMatch: 5, nationCoachIn: 3, nationCoachOut: 3, tournament: 4, qualified: 4,
};

/** Words in a club's name that say nothing about it. */
const GENERIC = new Set(['VC', 'Volley', 'Volleyball', 'Volleyball Club', 'Sport', 'Sports', 'VB', 'Volley-Ball', 'Pallavolo', 'Club']);

/**
 * A club the way its fans say it: the name without the city — "Resovia",
 * "Thunders", "Sir Safety" — or the city, when the rest is only "Volley".
 */
export function fanName(club: Club): string {
  const def = NATIONS[club.nation];
  const city = def === undefined
    ? undefined
    : cityBankFor(def.cityGroup ?? def.nameGroup).cities.find((c) => club.name.includes(c));
  if (city === undefined) return club.name;
  const rest = club.name.replace(city, '').trim();
  return rest.length >= 4 && !GENERIC.has(rest) ? rest : city;
}

function fill(world: World, b: FanBrief, text: string): string {
  const store = world.players;
  const p = b.player !== undefined && b.player >= 0 ? b.player : -1;
  const club = (id: number | undefined): string => {
    const c = id !== undefined ? world.clubs[id] : undefined;
    return c !== undefined ? fanName(c) : '';
  };
  const nation = (id: number | undefined): string => (id !== undefined ? NATIONS[id]?.name ?? '' : '');
  const fee = b.fee !== undefined && b.fee > 0
    ? b.fee >= 1_000_000 ? `€${(b.fee / 1_000_000).toFixed(1)}M` : `€${Math.round(b.fee / 1000)}k`
    : 'That money';
  return text
    .replaceAll('{p}', p >= 0 ? store.surname(p) : 'him')
    .replaceAll('{pos}', p >= 0 ? POSITION_NAMES[store.position[p] as Position].toLowerCase() : 'player')
    .replaceAll('{c}', club(b.club))
    .replaceAll('{o}', club(b.other))
    .replaceAll('{n}', nation(b.nation))
    .replaceAll('{on}', nation(b.otherNation))
    .replaceAll('{coach}', b.coach ?? 'the coach')
    .replaceAll('{score}', b.score ?? '')
    .replaceAll('{fee}', fee)
    .replaceAll('{weeks}', String(b.weeks ?? 'Six'))
    .replaceAll('{comp}', b.comp ?? 'League');
}

/** A fan's name online, from the names of his country: "kamil_resovia", "Marta88", "TrueSkra". */
function handle(rng: Rng, nation: number, club: Club | undefined): string {
  const bank = bankFor(NATIONS[nation]?.nameGroup ?? '');
  const first = rng.pick(bank.first);
  const last = rng.pick(bank.last);
  const tag = (club !== undefined ? fanName(club) : NATIONS[nation]?.code ?? 'Volley').replace(/[^\p{L}\p{N}]/gu, '');
  switch (rng.int(0, 6)) {
    case 0: return `${first}${rng.int(70, 99)}`;
    case 1: return `${first.toLowerCase()}_${tag.toLowerCase()}`;
    case 2: return club !== undefined ? `True${tag}` : `${tag}Fan${rng.int(1, 99)}`;
    case 3: return `${first} ${last.charAt(0)}.`;
    case 4: return `${first.toLowerCase()}.${last.toLowerCase()}`;
    case 5: return club !== undefined ? `${tag}Ultra${rng.int(1, 12)}` : `${tag}_${first}`;
    default: return `${last}${rng.int(1, 9)}${rng.int(0, 9)}`;
  }
}

/** A rival of a club: another in its league, the bigger ones likelier. */
function rivalOf(world: World, rng: Rng, clubId: number | undefined, not: ReadonlyArray<number | undefined>): Club | undefined {
  const club = clubId !== undefined ? world.clubs[clubId] : undefined;
  if (club === undefined) return undefined;
  const pool = world.clubs
    .filter((c) => c.leagueId === club.leagueId && !not.includes(c.id))
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, 6);
  return pool.length > 0 ? rng.pick(pool) : undefined;
}

/** A neutral's nation: one of the volleyball countries not in the story. */
function neutralNation(rng: Rng, not: ReadonlyArray<number | undefined>): number {
  const pool = NATIONS.map((_, i) => i).filter((i) => !not.includes(i) && NATIONS[i].strength >= 70);
  return pool.length > 0 ? rng.pick(pool) : 0;
}

/**
 * The comments under a story: most from its main side, some from the other
 * side and from rivals or neutrals, the most liked first. Empty for a story
 * with no brief — one from before fans had their say.
 */
export function fanComments(world: World, story: { id: number; fans?: FanBrief }): FanComment[] {
  const b = story.fans;
  if (b === undefined) return [];
  const voices = VOICES[b.story];
  const rng = new Rng(story.id * 7919 + 17);
  const count = COMMENTS[b.story];
  const sides = (Object.keys(voices) as Side[]).filter((s) => {
    if (s === 'club') return b.club !== undefined && world.clubs[b.club] !== undefined;
    if (s === 'other') return b.other !== undefined && world.clubs[b.other] !== undefined;
    if (s === 'nation') return b.nation !== undefined && b.nation >= 0;
    if (s === 'otherNation') return b.otherNation !== undefined && b.otherNation >= 0;
    return true;
  });
  if (sides.length === 0) return [];
  // The main side has most to say.
  const weight = (s: Side): number => (s === 'club' || s === 'nation' ? 5 : s === 'other' || s === 'otherNation' ? 3 : 1.5);
  const used = new Map<Side, Set<number>>();
  const rival = rivalOf(world, rng, b.club ?? b.other, [b.club, b.other]);
  const out: FanComment[] = [];
  for (let k = 0; k < count * 3 && out.length < count; k++) {
    const side = sides[rng.weightedIndex(sides.map(weight))];
    const lines = voices[side]!;
    const seen = used.get(side) ?? new Set<number>();
    if (seen.size >= lines.length) continue;
    let i = rng.int(0, lines.length - 1);
    while (seen.has(i)) i = (i + 1) % lines.length;
    seen.add(i);
    used.set(side, seen);
    const [mood, text] = lines[i];
    // Who is talking, and how many agree.
    let clubId: number | undefined;
    let nation: number | undefined;
    if (side === 'club') clubId = b.club;
    else if (side === 'other') clubId = b.other;
    else if (side === 'rival') clubId = rival?.id;
    else if (side === 'nation') nation = b.nation;
    else if (side === 'otherNation') nation = b.otherNation;
    else nation = neutralNation(rng, [b.nation, b.otherNation]);
    if (side === 'rival' && clubId === undefined) continue;
    const club = clubId !== undefined ? world.clubs[clubId] : undefined;
    const reach = club !== undefined ? 20 + club.reputation / 40 : nation !== undefined ? 60 + (NATIONS[nation]?.strength ?? 50) * 2 : 40;
    const likes = Math.round(reach * rng.float() * (mood === 'delighted' || mood === 'angry' ? 1.6 : 1));
    out.push({
      handle: handle(rng, club?.nation ?? nation ?? 0, club),
      clubId, nation, text: fill(world, b, text), likes, mood,
    });
  }
  return out.sort((a, b2) => b2.likes - a.likes);
}
