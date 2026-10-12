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
    body: 'Unread ones are in bold. A red dot means Action needed: an offer, a contract, a player asking to leave — something that waits for your answer.',
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
    snapshot: (g) => JSON.stringify(g.club?.tactics ?? null),
    done: (g, s) => JSON.stringify(g.club?.tactics ?? null) !== s.snap,
  },
  {
    id: 'rotations', chapter: 'Picking the team', title: 'Rotation by rotation',
    body: 'Each of the six rotations can have its own preferred attacker, serve target and block — the setter at the net leaves only two attackers up front.',
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
  // ---- The club ----
  {
    id: 'transfers', chapter: 'The club', title: 'Transfers',
    body: 'Most moves happen as contracts run out. Your budget is at the top; Scouting finds players, and a player\'s profile has the button to make an offer.',
    todo: 'Open Transfers.',
    target: '[data-tour="nav-transfers"]',
    done: (g) => plainScreen(g, 'transfers'),
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
    body: 'Every rally is played out by the engine: serve, pass, set, attack, block, dig. Beside the court, each player\'s live rating; below, the point by point. 3D or 2D, names or ratings — the buttons on the court.',
    needs: (g) => g.matchday?.stage === 'live',
    backTo: 'to-match',
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
    target: '[data-tour="skip-result"]',
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
    body: 'That is the job: keep the players happy, pick the team, set the training, win matches — and keep the board on your side. The ? at the top opens the help any time, and this tutorial again.',
  },
];

/** Where a card goes beside what it points at — or, without room, centred low. */
function cardPlace(rect: DOMRect | null, w: number, h: number): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 18;
  if (rect === null) return { left: (vw - w) / 2, top: Math.max(16, (vh - h) / 2) };
  const clampTop = (t: number): number => Math.max(12, Math.min(vh - h - 12, t));
  const clampLeft = (l: number): number => Math.max(12, Math.min(vw - w - 12, l));
  if (rect.right + gap + w < vw - 8) return { left: rect.right + gap, top: clampTop(rect.top + rect.height / 2 - h / 2) };
  if (rect.left - gap - w > 8) return { left: rect.left - gap - w, top: clampTop(rect.top + rect.height / 2 - h / 2) };
  if (rect.bottom + gap + h < vh - 8) return { left: clampLeft(rect.left + rect.width / 2 - w / 2), top: rect.bottom + gap };
  if (rect.top - gap - h > 8) return { left: clampLeft(rect.left + rect.width / 2 - w / 2), top: rect.top - gap - h };
  return { left: vw - w - 20, top: vh - h - 20 };
}

/** The first match of `selector` that is on screen. */
function findTarget(selector: string | readonly string[] | undefined): HTMLElement | null {
  if (selector === undefined) return null;
  for (const sel of typeof selector === 'string' ? [selector] : selector) {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) return el;
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
  const step = index !== undefined ? TUTORIAL[index] : undefined;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });
  const targetRef = useRef<HTMLElement | null>(null);

  // A first career in this browser: the tutorial, once the manager has a club.
  useEffect(() => {
    if (g.welcomeOpen && g.club !== null && world !== null && world.tutorial === undefined) g.startTutorial();
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

  // Done — or wandered off what the step needs: on, or back.
  useEffect(() => {
    if (step === undefined || index === undefined) return;
    // A new step: note what it starts from, before anything can count as done.
    if (g.tutorialStart.step !== index) {
      g.markTutorialStart(index, step.snapshot?.(g) ?? '');
      return;
    }
    if (step.needs !== undefined && step.backTo !== undefined && !step.needs(g) && !(step.done?.(g, g.tutorialStart) ?? false)) {
      const back = TUTORIAL.findIndex((s) => s.id === step.backTo);
      if (back >= 0 && back < (index ?? 0)) g.tutorialGoTo(back);
      return;
    }
    if (step.done !== undefined && step.done(g, g.tutorialStart)) {
      const t = setTimeout(() => (index + 1 < TUTORIAL.length ? g.tutorialGoTo(index + 1) : g.endTutorial()), 350);
      return () => clearTimeout(t);
    }
  });

  // While a step waits on the player, only what it points at can be used.
  const waiting = step?.done !== undefined && rect !== null && step.free !== true;
  const reading = step !== undefined && step.done === undefined;
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

  if (world === null || step === undefined || index === undefined) return null;
  const total = TUTORIAL.length;
  const first = index === 0;
  const last = index === total - 1;
  const pad = 6;
  const hole = rect !== null
    ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;
  // Steps through screens of their own leave the screen undimmed.
  const shade = !(step.free === true && step.done !== undefined);
  const place = cardPlace(hole !== null ? new DOMRect(hole.left, hole.top, hole.width, hole.height) : null, cardSize.w, cardSize.h);

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
      <div ref={cardRef} className="tut-card" style={place} role="dialog" aria-label="Tutorial">
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
        {step.target !== undefined && rect === null && step.done !== undefined && (
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
              {!first && <button className="sm" onClick={() => g.tutorialGoTo(index - 1)}><Icon name="back" size={12} /> Back</button>}
              {step.done === undefined && (
                <button className="sm primary" onClick={() => (last ? g.endTutorial() : g.tutorialGoTo(index + 1))}>
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
