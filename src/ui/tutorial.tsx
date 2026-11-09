/**
 * The tutorial: a manager's first week, done rather than read about.
 *
 * Each step points at one thing on the screen — the rest dimmed — and says
 * what it is for and what to do with it; most then wait until the player has
 * actually done it: opened the inbox, called a player into the office,
 * changed an instruction, set the week's training, got through to match day,
 * called a timeout. While a step waits, nothing but the thing it points at
 * can be clicked (and whatever that opens), so nobody gets lost; a step that
 * is only telling shows a Next button. If the player wanders off a screen a
 * step needs, it takes him back a step. It can be left at any point, and
 * started again from the help.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { nextTournamentFor, userNation } from '../engine/world/internationals.ts';
import { planOf } from '../engine/world/training.ts';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

type Game = ReturnType<typeof useGame>;

export interface TutorialStep {
  id: string;
  /** The part of the game it is about. */
  chapter: string;
  title: string;
  /** What it is, and why it matters. */
  body: string;
  /** What to do — for a step that waits until it is done. */
  todo?: string;
  /** What to point at: the first visible element it matches — the first selector that finds one, of several. */
  target?: string | readonly string[];
  /** Done once this holds. Absent: the player reads it and presses Next. */
  done?: (g: Game, start: StepStart) => boolean;
  /** For a step that waits on a change: what to compare against when it began. */
  snapshot?: (g: Game) => string;
  /** What the step needs on screen — and the step to go back to when it isn't there. */
  needs?: (g: Game) => boolean;
  backTo?: string;
  /** Let anything be clicked while it waits — for a step that goes through screens of its own. */
  free?: boolean;
}

/** What a step started from. */
export interface StepStart {
  step: number;
  snap: string;
  day: number;
}

const userTeam = (g: Game): 0 | 1 => (g.matchday?.userIsHome === false ? 1 : 0);
const plainScreen = (g: Game, screen: string): boolean =>
  g.screen === screen && g.selectedPlayer === null && g.selectedClub === null && g.selectedCompetition === null &&
  g.playerTalk === null && g.matchday === null;

export const TUTORIAL: readonly TutorialStep[] = [
  // ---- Welcome ----
  {
    id: 'welcome', chapter: 'Welcome', title: 'Welcome, coach',
    body: 'This tutorial takes you through your first week in charge — and you do every part of it yourself. The lit-up part of the screen is what to use; the card tells you what it does and what to do. You can leave it at any point, and start it again from the Help (?).',
  },
  {
    id: 'home', chapter: 'Welcome', title: 'Home',
    target: '.home-page',
    body: 'Your club at a glance: the next match, the league table, the player to watch, your form, the board\'s mood and the money. Come back here whenever you want the big picture.',
    needs: (g) => plainScreen(g, 'home'),
  },
  // ---- The inbox ----
  {
    id: 'inbox', chapter: 'The inbox', title: 'Everything arrives in the inbox',
    body: 'Offers for your players, injuries, the board, the press, your scouts — it all comes in as a message.',
    todo: 'Open the Inbox.',
    target: '[data-tour="nav-inbox"]',
    done: (g) => plainScreen(g, 'inbox'),
  },
  {
    id: 'message', chapter: 'The inbox', title: 'Read a message',
    body: 'Unread ones are in bold. A red dot means Action needed: an offer, a contract, a player who wants a word or asks to leave — something that waits for your answer. Before every match, the preview is here too: the odds, the form and what the fans think.',
    todo: 'Click any message to read it.',
    target: '.mail-list',
    needs: (g) => g.screen === 'inbox',
    backTo: 'inbox',
    done: (g) => g.inboxSelected !== null,
  },
  // ---- Your players ----
  {
    id: 'squad', chapter: 'Your players', title: 'Your squad',
    body: 'The players are the club. Squad lists every one of them.',
    todo: 'Open Squad.',
    target: '[data-tour="nav-squad"]',
    done: (g) => plainScreen(g, 'squad'),
  },
  {
    id: 'squad-table', chapter: 'Your players', title: 'Reading the squad',
    target: '.squad-players',
    body: 'Position, age, height, the stars for how good he is now and could become, his condition (tired players play worse and get hurt), his morale and his form. Click a column to sort by it.',
    needs: (g) => plainScreen(g, 'squad'),
    backTo: 'squad',
  },
  {
    id: 'player', chapter: 'Your players', title: 'A player\'s profile',
    body: 'Everything about one player is in his profile.',
    todo: 'Click a player\'s name.',
    target: '.squad-players',
    needs: (g) => g.screen === 'squad' && g.playerTalk === null,
    backTo: 'squad',
    done: (g) => g.selectedPlayer !== null,
  },
  {
    id: 'attributes', chapter: 'Your players', title: 'Attributes',
    target: '.profile-attrs',
    body: 'Each attribute runs from 1 to 20 — technical (serving, attacking, blocking, passing), mental and physical. They are what the match engine plays with: a 17 in Reception passes better than a 9, every rally. Traits like Quick-attack specialist show under his name.',
    needs: (g) => g.selectedPlayer !== null,
    backTo: 'player',
  },
  {
    id: 'talk', chapter: 'Your players', title: 'A word with him',
    body: 'Morale matters: a happy player plays better, an unhappy one asks to leave. You can talk to any of your players.',
    todo: 'Click Talk.',
    target: '[data-tour="talk"]',
    needs: (g) => g.selectedPlayer !== null || g.playerTalk !== null,
    backTo: 'player',
    done: (g) => g.playerTalk !== null,
  },
  {
    id: 'say', chapter: 'Your players', title: 'Say something',
    body: 'Praise works on a player in form; criticism can lift a professional having a bad spell — or upset him; a promise of games buys goodwill now, and he will hold you to it. Watch what it does to his morale.',
    todo: 'Pick something to say.',
    target: '.ptalk-options',
    needs: (g) => g.playerTalk !== null,
    backTo: 'player',
    done: (g) => (g.playerTalk?.lines.length ?? 0) > 1,
  },
  {
    id: 'leave-talk', chapter: 'Your players', title: 'That\'s that',
    body: 'One real talk with the same player a fortnight: say too much and it stops meaning anything.',
    todo: 'End the conversation.',
    target: '.ptalk-leave',
    needs: (g) => g.playerTalk !== null,
    backTo: 'player',
    done: (g) => g.playerTalk === null,
  },
  {
    id: 'dressing', chapter: 'Your players', title: 'The dressing room',
    body: 'Some players count for more than others in a dressing room.',
    todo: 'Open the Dressing Room tab — from Squad, if the tab is not showing.',
    target: ['[data-tour="tab-dressing"]', '[data-tour="nav-squad"]'],
    needs: (g) => g.screen === 'squad' || g.screen === 'dressing' || g.selectedPlayer !== null,
    backTo: 'squad',
    done: (g) => plainScreen(g, 'dressing'),
  },
  {
    id: 'room', chapter: 'Your players', title: 'Leaders and cohesion',
    target: '.room-grid',
    body: 'The leaders\' mood spreads through the squad, and a side that has been together for years holds together — that cohesion is worth a little on court. Sell a leader and the room is shaken for a while. Make your captain one of them.',
    needs: (g) => plainScreen(g, 'dressing'),
    backTo: 'dressing',
  },
  {
    id: 'planner', chapter: 'Your players', title: 'Planning ahead',
    body: 'The Squad Planner looks two seasons ahead: who is still under contract, whose deal runs out, who may retire, the academy players coming through — and where that leaves you short.',
    todo: 'Open the Squad Planner tab — from Squad, if the tab is not showing.',
    target: ['[data-tour="tab-planner"]', '[data-tour="nav-squad"]'],
    needs: (g) => g.screen === 'squad' || g.screen === 'dressing' || g.screen === 'planner' || g.selectedPlayer !== null,
    backTo: 'squad',
    done: (g) => plainScreen(g, 'planner'),
  },
  {
    id: 'plan', chapter: 'Your players', title: 'Gaps and targets',
    target: '.plan-grid',
    body: 'Each season, position by position, against the depth a side needs — a gap shows in red. Mark a transfer target against a gap, from a player\'s profile or from the scouts\' list, and the wage bill for each season stays in view.',
    needs: (g) => plainScreen(g, 'planner'),
    backTo: 'planner',
  },
  // ---- Picking the team ----
  {
    id: 'lineup', chapter: 'Picking the team', title: 'The team sheet',
    body: 'Lineup is where you pick who plays.',
    todo: 'Open Lineup.',
    target: '[data-tour="nav-lineup"]',
    done: (g) => plainScreen(g, 'lineup'),
  },
  {
    id: 'sheet', chapter: 'Picking the team', title: 'Six, a libero and the bench',
    target: '.lineup-page',
    body: 'The six on the court start in these zones and rotate every time you win the serve back. The libero comes on for a middle blocker in the back row. Drag a player onto another to swap them; the bench is who you can bring on — six substitutions a set.',
    needs: (g) => plainScreen(g, 'lineup'),
    backTo: 'lineup',
  },
  {
    id: 'instructions', chapter: 'Picking the team', title: 'How you play',
    body: 'Instructions tell the team how to play: the system, who the setter looks for, the tempo, the combinations — and, out of possession, where the defence stands and how you serve.',
    todo: 'Open the Instructions tab.',
    target: '[data-tour="tab-tactics"]',
    needs: (g) => g.screen === 'lineup' || g.screen === 'tactics',
    backTo: 'lineup',
    done: (g) => plainScreen(g, 'tactics'),
  },
  {
    id: 'instruction', chapter: 'Picking the team', title: 'Change one',
    body: 'Every instruction goes straight into the rally engine: there is no hidden team rating. Faster tempo beats the block but goes wrong more; combinations need a good pass.',
    todo: 'Click any instruction card, then pick a different option.',
    target: '.tboard-body',
    needs: (g) => plainScreen(g, 'tactics'),
    backTo: 'instructions',
    // The instructions of the team on screen: the club's, or the national team's.
    snapshot: (g) => JSON.stringify(g.activeTactics()),
    done: (g, s) => JSON.stringify(g.activeTactics()) !== s.snap,
  },
  {
    id: 'rotations', chapter: 'Picking the team', title: 'Rotation by rotation',
    body: 'Each of the six rotations can have its own combination play — the between, the up and down, the scissors, the pipe — and its own preferred attacker, serve target and block. The setter at the net leaves only two attackers up front.',
    todo: 'Open the Rotations tab.',
    target: '[data-tour="tab-rotations"]',
    needs: (g) => g.screen === 'tactics' || g.screen === 'rotations' || g.screen === 'lineup',
    backTo: 'lineup',
    done: (g) => plainScreen(g, 'rotations'),
  },
  // ---- Training ----
  {
    id: 'training', chapter: 'Training', title: 'The week\'s training',
    body: 'Training is where players get better — and where they get tired.',
    todo: 'Open Training.',
    target: '[data-tour="nav-training"]',
    done: (g) => plainScreen(g, 'training'),
  },
  {
    id: 'focus', chapter: 'Training', title: 'Set the focus',
    body: 'The weekly focus decides what the sessions work on; the intensity, how hard. Harder develops more and tires more — before a match, keep it light. The card on the right shows how ready the squad is.',
    todo: 'Change the Weekly focus.',
    target: '[data-tour="train-focus"]',
    needs: (g) => plainScreen(g, 'training'),
    backTo: 'training',
    snapshot: (g) => (g.club !== null ? JSON.stringify(planOf(g.club)) : ''),
    done: (g, s) => g.club !== null && JSON.stringify(planOf(g.club)) !== s.snap,
  },
  // ---- Recruitment ----
  {
    id: 'scouting', chapter: 'Recruitment', title: 'Finding players',
    body: 'Scouting searches every player your scouts know about, by position, age, height, potential and price. A player\'s profile has the buttons to make an offer or put him on your shortlist.',
    todo: 'Open Scouting.',
    target: '[data-tour="nav-scouting"]',
    done: (g) => plainScreen(g, 'scouting'),
  },
  {
    id: 'missions', chapter: 'Recruitment', title: 'Send the scouts out',
    body: 'Or give the scouts a brief — "an opposite aged 24 or under, up to €200k" — and they go looking. Every week each mission brings back new names, onto your Shortlist and into the inbox.',
    todo: 'Open the Scout Missions tab.',
    target: ['[data-tour="tab-missions"]', '[data-tour="nav-scouting"]'],
    needs: (g) => g.screen === 'scouting' || g.screen === 'shortlist' || g.screen === 'missions',
    backTo: 'scouting',
    done: (g) => plainScreen(g, 'missions'),
  },
  {
    id: 'brief', chapter: 'Recruitment', title: 'A brief',
    target: '.rc-missions',
    body: 'Pick a position, an age, a price, a level and a region — or free agents only — and send them. Up to four missions at once; call one off once you have your man. The Shortlist tab keeps everyone they name, and anyone you add yourself.',
    needs: (g) => plainScreen(g, 'missions'),
    backTo: 'missions',
  },
  {
    id: 'transfers', chapter: 'Recruitment', title: 'Transfers',
    body: 'Your budgets, the bids for your players and your own deals. A player with years left on his contract costs more; one whose deal is running out goes cheaply. Turn down a move one of your players wanted, and he will come and ask you why.',
    todo: 'Open Transfers.',
    target: '[data-tour="nav-transfers"]',
    done: (g) => plainScreen(g, 'transfers'),
  },
  {
    id: 'deadline', chapter: 'Recruitment', title: 'Deadline day',
    target: '[data-tour="tab-deadline"]',
    body: 'The last day of every window has a screen of its own: a clock running down to midnight, the late deals and rumours as they break, last-minute bids for your players — and whatever you still have open.',
    needs: (g) => g.screen === 'transfers' || g.screen === 'deadline' || g.screen === 'director',
    backTo: 'transfers',
  },
  {
    id: 'director', chapter: 'Recruitment', title: 'You don\'t have to do it all',
    body: 'Some of the job can be handed over.',
    todo: 'Open the Director & Delegation tab.',
    target: '[data-tour="tab-director"]',
    needs: (g) => g.screen === 'transfers' || g.screen === 'deadline' || g.screen === 'director',
    backTo: 'transfers',
    done: (g) => plainScreen(g, 'director'),
  },
  {
    id: 'delegate', chapter: 'Recruitment', title: 'The director, and who does what',
    target: '.rc-director',
    body: 'Hire a Director of Football (from Staff) and he does deals for you: hand him a signing or a renewal from a player\'s profile, with the most he may pay, and he reports back. Below, choose who handles renewals, friendlies, training and the press — you, your assistant or the director.',
    needs: (g) => plainScreen(g, 'director'),
    backTo: 'director',
  },
  // ---- The club ----
  {
    id: 'meeting', chapter: 'The club', title: 'The staff meeting',
    body: 'On the 3rd of every month your staff bring their suggestions: a key contract to renew, a position short for next season, a player heading for an injury, a youngster ready for the first team. Take each one, or leave it.',
    todo: 'Open Staff, then the Staff Meeting tab.',
    target: ['[data-tour="tab-meeting"]', '[data-tour="nav-staff"]'],
    done: (g) => plainScreen(g, 'meeting'),
  },
  {
    id: 'finances', chapter: 'The club', title: 'The money',
    body: 'The board gives you a wage budget and a transfer budget. Go over them and its confidence in you drops — and so does your job security. Tickets, sponsors and facilities are in the tabs here too.',
    todo: 'Open Finances.',
    target: '[data-tour="nav-finances"]',
    done: (g) => plainScreen(g, 'finances'),
  },
  // ---- Matchday ----
  {
    id: 'continue', chapter: 'Matchday', title: 'Moving time on',
    body: 'Nothing happens until you move the calendar on. Continue goes a day at a time, and stops whenever something needs you — a message to answer, a press conference, a match.',
    todo: 'Press Continue.',
    target: '[data-tour="continue"]',
    free: true,
    done: (g, s) => (g.world?.day ?? 0) > s.day || g.matchday !== null,
  },
  {
    id: 'to-match', chapter: 'Matchday', title: 'To match day',
    body: 'When there is a match today, the button says Play match. The arrow beside it can take you straight there — a holiday until the next match.',
    todo: 'Get to your next match and press Play match. Answer anything that comes up on the way.',
    target: '[data-tour="continue"]',
    free: true,
    done: (g) => g.matchday !== null,
  },
  {
    id: 'team-talk', chapter: 'Matchday', title: 'The team talk',
    body: 'Before the match, and at every set break, you can talk to the team. What works depends on the moment — favourites or underdogs, winning or losing — and on who is listening.',
    todo: 'Give your team talk.',
    target: '[data-tour="team-talk"]',
    needs: (g) => g.matchday !== null,
    backTo: 'to-match',
    done: (g) => g.matchday?.talks?.prematch !== undefined || g.matchday?.stage === 'live',
  },
  {
    id: 'kickoff', chapter: 'Matchday', title: 'Kick off',
    body: 'The team sheet is the one you picked; you can still change it here.',
    todo: 'Kick off.',
    target: '[data-tour="kickoff"]',
    needs: (g) => g.matchday !== null,
    backTo: 'to-match',
    done: (g) => g.matchday?.stage === 'live',
  },
  {
    id: 'live', chapter: 'Matchday', title: 'The match',
    target: '.lv-court',
    body: 'Every rally is played out by the engine: serve, pass, set, attack, block, dig. Beside the court, each player\'s live rating; below, the point by point. 3D or 2D, names or ratings, the camera — the buttons on the court.',
    needs: (g) => g.matchday?.stage === 'live',
    backTo: 'to-match',
  },
  {
    id: 'camera', chapter: 'Matchday', title: 'Pick your camera',
    body: 'Broadcast is the main TV camera. Dynamic follows the ball up close; Professional cuts between shots like a TV director; Sky looks straight down; Behind sits behind your end line; Courtside is down by the court. The menu shows in 3D.',
    todo: 'Choose a different camera.',
    target: '.lv-court-tools',
    needs: (g) => g.matchday?.stage === 'live',
    backTo: 'to-match',
    snapshot: (g) => g.courtCamera,
    done: (g, s) => g.courtCamera !== s.snap,
  },
  {
    id: 'timeout', chapter: 'Matchday', title: 'Timeout',
    body: 'Two a set. Use one to stop the other side\'s run of points — or to make changes in peace.',
    todo: 'Call a timeout.',
    target: '[data-tour="timeout"]',
    needs: (g) => g.matchday !== null,
    backTo: 'to-match',
    done: (g) => g.matchday === null || g.matchday.timeoutActive !== null || (g.matchday.timeoutsUsed[userTeam(g)] ?? 0) > 0,
  },
  {
    id: 'resume', chapter: 'Matchday', title: 'Back to it',
    body: 'During a timeout you can bring players on and change the instructions. When you are ready, play on — or wait for the 30 seconds to run out.',
    todo: 'Resume play.',
    target: '[data-tour="resume-timeout"]',
    free: true,
    done: (g) => g.matchday === null || g.matchday.timeoutActive === null,
  },
  {
    id: 'subs', chapter: 'Matchday', title: 'Substitutions',
    target: '[data-tour="subs"]',
    body: 'Six a set. A tired or struggling player plays worse — bring someone fresh on. Clicking one of your players beside the court shows who could replace him.',
    needs: (g) => g.matchday !== null,
    backTo: 'to-match',
  },
  {
    id: 'challenge', chapter: 'Matchday', title: 'The video challenge',
    target: '[data-tour="challenge"]',
    body: 'When a close call goes against you, ask for the video — and say what it should look at: the line, a touch off the block, the net. Right, and the point is yours and you keep the challenge; wrong, and you lose it. Two a set.',
    needs: (g) => g.matchday !== null,
    backTo: 'to-match',
  },
  {
    id: 'finish-match', chapter: 'Matchday', title: 'Play it out',
    body: 'Watch at 1×, 1.5× or 2× — or skip to the result. At the set breaks you get the team sheet and another team talk.',
    todo: 'Finish the match — play it out, or press Skip to result.',
    // A final has its trophy lifted first, and its own Continue to the report.
    target: ['.trophy-banner .primary', '[data-tour="skip-result"]'],
    free: true,
    done: (g) => g.matchday === null,
  },
  // ---- Done ----
  {
    id: 'after', chapter: 'After the match', title: 'The report',
    body: 'Every match has its report: the box score, every player\'s rating, how each rotation did. Fixtures & Results keeps them all, season by season — click a match to open it.',
  },
  {
    id: 'done', chapter: 'All set', title: 'Over to you',
    body: 'That is the job: keep the players happy, pick the team, set the training, plan the squad, win matches — and keep the board on your side. The ? at the top opens the help any time, and this tutorial again.',
  },
];

// ---- The national team ----------------------------------------------------------------------

const clubStep = (id: string): TutorialStep => TUTORIAL.find((s) => s.id === id)!;
const nationalScreen = (g: Game, screen: string): boolean => plainScreen(g, screen) && g.nationalView();
const frameOf = (g: Game): string => JSON.stringify(g.world?.internationals?.frame?.players ?? []);
/** The squad named for the national team's next tournament — or none ahead to name one for. */
const squadNamed = (g: Game): boolean => {
  const world = g.world;
  if (world === null) return false;
  const t = nextTournamentFor(world, userNation(world));
  return t === undefined || t.status !== 'planned' || world.internationals?.chosen?.tournamentId === t.id;
};

/** The national team's own screens: its squad, the players in contention, its team sheet, its tournaments. */
const NATIONAL_CHAPTER: readonly TutorialStep[] = [
  {
    id: 'nat-squad', chapter: 'Your national team', title: 'The national squad',
    body: 'Anyone who can play for your country, wherever he plays his club volleyball, can be called up.',
    todo: 'Open Squad.',
    target: '[data-tour="nav-squad"]',
    done: (g) => nationalScreen(g, 'squad'),
  },
  {
    id: 'nat-pool', chapter: 'Your national team', title: 'Who goes',
    target: '.nat-squad-grid',
    body: 'On the left, the fourteen your assistant would take now — the squad itself, once you have named it. On the right, everyone in contention for a place: his club, his ability, his form and his caps.',
    needs: (g) => nationalScreen(g, 'squad'),
    backTo: 'nat-squad',
  },
  {
    id: 'nat-frame', chapter: 'Your national team', title: 'The provisional squad',
    body: 'Up to 25 names you are keeping an eye on — your assistant picks from them first. The button beside the star sends you to watch his club\'s matches, so you know his form.',
    todo: 'Click a star to put a player in your provisional squad.',
    target: '.nat-squad-grid',
    needs: (g) => nationalScreen(g, 'squad'),
    backTo: 'nat-squad',
    snapshot: frameOf,
    done: (g, s) => frameOf(g) !== s.snap,
  },
];

const NATIONAL_TOURNAMENTS: readonly TutorialStep[] = [
  {
    id: 'nat-tournaments', chapter: 'Your national team', title: 'The tournaments',
    body: 'Your nation\'s summer and spring: the Nations Cup, the continental championships, the World Championship and the Summer Games.',
    todo: 'Open Competitions, then the International tab.',
    target: ['[data-tour="tab-internationals"]', '[data-tour="nav-competitions"]'],
    done: (g) => plainScreen(g, 'internationals'),
  },
  {
    id: 'nat-calendar', chapter: 'Your national team', title: 'Groups, knockouts and the ranking',
    body: 'Every tournament on the calendar, the draw, the groups and the knockout rounds — click one for all of it. Every result moves your nation up or down the world ranking, and the ranking decides who qualifies.',
    needs: (g) => plainScreen(g, 'internationals'),
    backTo: 'nat-tournaments',
  },
];

/** A national team only: its squad and team sheet, its tournaments, the call-up — and its first match. */
const NATIONAL_TOUR: readonly TutorialStep[] = [
  {
    id: 'welcome', chapter: 'Welcome', title: 'Welcome, coach',
    body: 'This tutorial takes you through your first weeks with the national team — and you do every part of it yourself. The lit-up part of the screen is what to use; the card tells you what it does and what to do. You can leave it at any point, and start it again from the Help (?).',
  },
  {
    id: 'home', chapter: 'Welcome', title: 'Home',
    target: '.home-page',
    body: 'Your national team at a glance: the next tournament, when the squad is due, the world ranking and the federation\'s mood. Come back here whenever you want the big picture.',
    needs: (g) => plainScreen(g, 'home'),
  },
  clubStep('inbox'),
  clubStep('message'),
  ...NATIONAL_CHAPTER,
  {
    id: 'nat-player', chapter: 'Your national team', title: 'A player\'s profile',
    body: 'Everything about one player is in his profile.',
    todo: 'Click a player\'s name.',
    target: '.nat-squad-grid',
    needs: (g) => g.screen === 'squad' && g.playerTalk === null,
    backTo: 'nat-squad',
    done: (g) => g.selectedPlayer !== null,
  },
  {
    id: 'nat-attributes', chapter: 'Your national team', title: 'Attributes',
    target: '.profile-attrs',
    body: 'Each attribute runs from 1 to 20 — technical, mental and physical — and they are what the match engine plays with. He belongs to his club: you can\'t talk him round or sign him. What you can do is pick him, or leave him out.',
    needs: (g) => g.selectedPlayer !== null,
    backTo: 'nat-player',
  },
  { ...clubStep('lineup'), body: 'The national team has a team sheet of its own — the starting point for every national match, from the fourteen named for the tournament.' },
  clubStep('sheet'),
  clubStep('instructions'),
  clubStep('instruction'),
  clubStep('rotations'),
  ...NATIONAL_TOURNAMENTS,
  clubStep('continue'),
  {
    id: 'callup', chapter: 'Your national team', title: 'Name your fourteen',
    body: 'A week before each tournament the federation asks for your squad, and Continue stops on the day. The arrow beside it can take you there on holiday. Leave it to the holiday and your assistant names it.',
    todo: 'Get to the day the squad is due, and name your fourteen in the federation\'s message — your own, or the Assistant\'s pick — then Confirm squad.',
    target: '[data-tour="continue"]',
    free: true,
    done: squadNamed,
  },
  {
    ...clubStep('to-match'),
    body: 'On a match day the button says Play match. The arrow beside it can take you straight there — a holiday until the next match.',
  },
  ...TUTORIAL.slice(TUTORIAL.findIndex((s) => s.id === 'team-talk'), TUTORIAL.findIndex((s) => s.id === 'done')),
  {
    id: 'done', chapter: 'All set', title: 'Over to you',
    body: 'That is the job: watch the players, name the right fourteen, pick the team, win matches — and climb the world ranking. The ? at the top opens the help any time, and this tutorial again.',
  },
];

/** A club and a country: the club's tutorial, with the national team's chapter before the first match. */
const BOTH_TOUR: readonly TutorialStep[] = [
  ...TUTORIAL.slice(0, TUTORIAL.findIndex((s) => s.id === 'continue')),
  {
    id: 'nat-switch', chapter: 'Your national team', title: 'Club and country',
    body: 'You run a club and a national team. This switch says which of the two the team screens — Squad and Lineup — are about. A club match always shows the club, a national one the country.',
    todo: 'Switch to the national team.',
    target: '.side-team-switch',
    done: (g) => g.nationalView(),
  },
  ...NATIONAL_CHAPTER.map((s) => ({ ...s, needs: s.needs === undefined ? undefined : (g: Game) => g.nationalView() && s.needs!(g) })),
  {
    id: 'nat-lineup', chapter: 'Your national team', title: 'Its own team sheet',
    body: 'The national team has its own team sheet and instructions, kept apart from the club\'s — the starting point for every national match.',
    todo: 'Open Lineup.',
    target: '[data-tour="nav-lineup"]',
    needs: (g) => g.nationalView(),
    backTo: 'nat-switch',
    done: (g) => nationalScreen(g, 'lineup'),
  },
  ...NATIONAL_TOURNAMENTS,
  {
    id: 'nat-back', chapter: 'Your national team', title: 'Back to the club',
    body: 'Squads are named a week before each tournament — the federation asks in the inbox, and Continue stops for it. Until then the club comes first.',
    todo: 'Switch back to the club.',
    target: '.side-team-switch',
    done: (g) => !g.nationalView(),
  },
  ...TUTORIAL.slice(TUTORIAL.findIndex((s) => s.id === 'continue')),
];

/** The tutorial for the career in play: a club's, a national team's, or both. */
export function tourFor(g: Game): readonly TutorialStep[] {
  const world = g.world;
  if (world === null) return TUTORIAL;
  const nation = userNation(world) >= 0;
  if (g.club === null) return nation ? NATIONAL_TOUR : TUTORIAL;
  return nation ? BOTH_TOUR : TUTORIAL;
}

/** Whether there is a tutorial to give now: a team to manage, and no draft still to be made. */
export function tutorialAvailable(g: Game): boolean {
  const world = g.world;
  return world !== null && world.draft === undefined && (g.club !== null || userNation(world) >= 0);
}

/**
 * What the card must never sit on: what a step's target opens, and what the game asks of the player
 * on the way — a press conference's answers, a final's trophy and its Continue, a dialog.
 */
const AVOID = '.press-answers, .trophy-banner, .trophy-card, .hol-card, .menu-pop, .dd-menu';

interface Box { left: number; top: number; right: number; bottom: number }

function overlap(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

/**
 * Where the card goes: beside what it points at, on whichever side has room — else in a corner —
 * the first place that covers neither the target nor anything in `avoid`, or the one that covers least.
 */
function cardPlace(rect: Box | null, w: number, h: number, avoid: readonly Box[]): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 18;
  const m = 16;
  const clampTop = (t: number): number => Math.max(12, Math.min(vh - h - 12, t));
  const clampLeft = (l: number): number => Math.max(12, Math.min(vw - w - 12, l));
  const spots: Array<[number, number]> = [];
  if (rect === null) {
    spots.push([(vw - w) / 2, Math.max(m, (vh - h) / 2)]);
  } else {
    const midTop = clampTop((rect.top + rect.bottom) / 2 - h / 2);
    const midLeft = clampLeft((rect.left + rect.right) / 2 - w / 2);
    if (rect.right + gap + w < vw - 8) spots.push([rect.right + gap, midTop]);
    if (rect.left - gap - w > 8) spots.push([rect.left - gap - w, midTop]);
    if (rect.bottom + gap + h < vh - 8) spots.push([midLeft, rect.bottom + gap]);
    if (rect.top - gap - h > 8) spots.push([midLeft, rect.top - gap - h]);
  }
  spots.push([vw - w - m, vh - h - m], [m, vh - h - m], [vw - w - m, m], [m, m]);
  let best = spots[0];
  let bestCost = Infinity;
  for (const [left, top] of spots) {
    const card = { left, top, right: left + w, bottom: top + h };
    const cost = (rect !== null ? overlap(card, rect) * 4 : 0) + avoid.reduce((s, a) => s + overlap(card, a), 0);
    if (cost < bestCost) {
      best = [left, top];
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return { left: best[0], top: best[1] };
}

/** Not yet faded in — a final's trophy banner waits for the lift — or faded out: there, but not to be seen. */
function faded(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n !== null && n !== document.body; n = n.parentElement) {
    if (Number(getComputedStyle(n).opacity) < 0.1) return true;
  }
  return false;
}

/** The first match of `selector` that is on screen. */
function findTarget(selector: string | readonly string[] | undefined): HTMLElement | null {
  if (selector === undefined) return null;
  for (const sel of typeof selector === 'string' ? [selector] : selector) {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2 && !faded(el)) return el;
    }
  }
  return null;
}

/** Whatever the target opens that has to stay usable: its menus, lists and dialogs. */
const OPENED = '.menu-pop, .dd-menu, [role="listbox"], .hol-overlay, .tut-card';

/** Same rectangle, near enough. */
function same(a: DOMRect | null, b: DOMRect | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

/** The tutorial over the game: the spotlight, the card, and the hold on everything else. */
export function TutorialOverlay(): JSX.Element | null {
  const g = useGame();
  const world = g.world;
  const index = world?.tutorial;
  // A club's, a national team's, or both — and nothing at all while a created club still drafts its
  // squad: its screen is the draft, and a tutorial over it could neither be done nor get out of the way.
  const tour = tourFor(g);
  const step = index !== undefined && tutorialAvailable(g) ? tour[index] : undefined;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });
  const targetRef = useRef<HTMLElement | null>(null);
  const [avoid, setAvoid] = useState<{ key: string; boxes: Box[] }>({ key: '', boxes: [] });
  // A step gone back to with Back: read again, on with Next — never straight on again because it is
  // done already, which would make Back do nothing.
  const [review, setReview] = useState<number | null>(null);
  const reviewing = review !== null && review === index;

  // A new career: the tutorial, once the manager has a team — and a created club its players.
  useEffect(() => {
    if (g.welcomeOpen && tutorialAvailable(g) && world !== null && world.tutorial === undefined) g.startTutorial();
  });

  // Keep the spotlight on the target as the screen moves under it.
  useEffect(() => {
    if (step === undefined) return;
    let raf = 0;
    const tick = (): void => {
      const el = findTarget(step.target);
      targetRef.current = el;
      const r = el?.getBoundingClientRect() ?? null;
      setRect((old) => (same(old, r) ? old : r));
      const boxes: Box[] = [];
      for (const a of document.querySelectorAll(AVOID)) {
        if (a.closest('.tut') !== null) continue;
        const b = a.getBoundingClientRect();
        if (b.width > 2 && b.height > 2) boxes.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
      }
      const key = boxes.map((b) => `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}`).join(';');
      setAvoid((old) => (old.key === key ? old : { key, boxes }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step?.id]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el !== null && (Math.abs(el.offsetWidth - cardSize.w) > 1 || Math.abs(el.offsetHeight - cardSize.h) > 1)) {
      setCardSize({ w: el.offsetWidth, h: el.offsetHeight });
    }
  });
  // Its size changes behind React's back too — the text put into Portuguese or Spanish after it is
  // drawn — and a card placed by its old height runs off the window.
  const cardOn = step !== undefined;
  useEffect(() => {
    const el = cardRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setCardSize((old) => (Math.abs(el.offsetWidth - old.w) > 1 || Math.abs(el.offsetHeight - old.h) > 1 ? { w: el.offsetWidth, h: el.offsetHeight } : old));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cardOn]);

  // Done — or wandered off what the step needs: on, or back.
  useEffect(() => {
    if (step === undefined || index === undefined) return;
    // A new step: note what it starts from, before anything can count as done. Then read on in the
    // same pass — nothing may redraw until the player does something, and a step that is off its
    // screen already has to send him back now, not on his next click.
    if (g.tutorialStart.step !== index) g.markTutorialStart(index, step.snapshot?.(g) ?? '');
    if (reviewing) return;
    if (step.needs !== undefined && step.backTo !== undefined && !step.needs(g) && !(step.done?.(g, g.tutorialStart) ?? false)) {
      const back = tour.findIndex((s) => s.id === step.backTo);
      if (back >= 0 && back < (index ?? 0)) g.tutorialGoTo(back);
      return;
    }
    if (step.done !== undefined && step.done(g, g.tutorialStart)) {
      const t = setTimeout(() => (index + 1 < tour.length ? g.tutorialGoTo(index + 1) : g.endTutorial()), 350);
      return () => clearTimeout(t);
    }
  });

  // While a step waits on the player, only what it points at can be used.
  const waiting = step?.done !== undefined && rect !== null && step.free !== true && !reviewing;
  const reading = step !== undefined && (step.done === undefined || reviewing);
  useEffect(() => {
    if (!waiting && !reading) return;
    const hold = (e: Event): void => {
      const t = e.target as Element | null;
      if (t === null) return;
      if (t.closest(OPENED) !== null) return;
      if (waiting && targetRef.current !== null && targetRef.current.contains(t)) return;
      e.stopPropagation();
      e.preventDefault();
    };
    const kinds = ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu'];
    for (const k of kinds) document.addEventListener(k, hold, true);
    return () => { for (const k of kinds) document.removeEventListener(k, hold, true); };
  }, [waiting, reading, step?.id]);

  const goTo = (to: number, again: boolean): void => {
    setReview(again ? to : null);
    g.tutorialGoTo(to);
  };

  if (world === null || step === undefined || index === undefined) return null;
  const total = tour.length;
  const first = index === 0;
  const last = index === total - 1;
  const pad = 6;
  const hole = rect !== null
    ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;
  // Steps through screens of their own leave the screen undimmed.
  const shade = !(step.free === true && step.done !== undefined);
  const place = cardPlace(
    hole !== null ? { left: hole.left, top: hole.top, right: hole.left + hole.width, bottom: hole.top + hole.height } : null,
    cardSize.w, cardSize.h, avoid.boxes,
  );

  return (
    <div className="tut">
      {hole !== null && shade && (
        // The screen dimmed all round what the step points at: four panels about the hole.
        <>
          <div className="tut-shade" style={{ left: 0, top: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div className="tut-shade" style={{ left: 0, top: hole.top + hole.height, right: 0, bottom: 0 }} />
          <div className="tut-shade" style={{ left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height }} />
          <div className="tut-shade" style={{ left: hole.left + hole.width, top: hole.top, right: 0, height: hole.height }} />
        </>
      )}
      {hole !== null && <div className={`tut-hole${step.done !== undefined ? ' act' : ''}`} style={hole} />}
      {hole === null && shade && <div className="tut-shade" style={{ inset: 0 }} />}
      <div ref={cardRef} className="tut-card" style={place} role="dialog" aria-label="Tutorial" data-step={step.id}>
        <div className="tut-top">
          <span className="tut-chapter">{step.chapter}</span>
          <span className="tut-count">{index + 1} / {total}</span>
        </div>
        <div className="tut-bar"><i style={{ width: `${((index + 1) / total) * 100}%` }} /></div>
        <h3 className="tut-title">{step.title}</h3>
        <p className="tut-body">{step.body}</p>
        {step.todo !== undefined && (
          <p className="tut-todo"><Icon name="arrowRight" size={13} /> {step.todo}</p>
        )}
        {step.target !== undefined && rect === null && step.done !== undefined && !reviewing && (
          <p className="tut-lost faint">Can't see it on this screen? Go back a step.</p>
        )}
        <footer className="tut-foot">
          {confirmSkip ? (
            <>
              <span className="tut-skip-q">Leave the tutorial?</span>
              <button className="sm" onClick={() => setConfirmSkip(false)}>Stay</button>
              <button className="sm danger" onClick={() => { setConfirmSkip(false); g.endTutorial(); }}>Leave</button>
            </>
          ) : (
            <>
              {first
                ? <button className="sm ghost" onClick={() => g.endTutorial()}>I know the game</button>
                : <button className="sm ghost" onClick={() => setConfirmSkip(true)}>Skip tutorial</button>}
              <span className="flex-spacer" />
              {!first && <button className="sm" onClick={() => goTo(index - 1, true)}><Icon name="back" size={12} /> Back</button>}
              {(step.done === undefined || reviewing) && (
                <button className="sm primary" onClick={() => (last ? g.endTutorial() : goTo(index + 1, false))}>
                  {first ? 'Start the tutorial' : last ? 'Finish' : 'Next'}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
