/**
 * Help: what every part of the game does, a topic at a time — and the short
 * tour a new manager gets on his first day, once per browser.
 */

import { useState, type JSX, type ReactNode } from 'react';
import { Icon } from './icons.tsx';
import { useGame, type ScreenId } from './state.ts';

interface HelpTopic {
  id: string;
  title: string;
  /** Where in the game it is, for a button there. */
  screen?: ScreenId;
  body: ReactNode;
}

const TOPICS: readonly HelpTopic[] = [
  {
    id: 'start', title: 'Getting started',
    body: (
      <>
        <p>You are the head coach. The board has set you a target for the season — finish where they expect, or better — and judges you on it.</p>
        <p>Each day, <b>Continue</b> moves the calendar on until something needs you: a message, a match, a decision. When it says <b>Next unread</b> or <b>Play match</b>, that is what the day needs.</p>
        <p>The <b>Inbox</b> is where everything arrives: offers, injuries, the board, the press. Messages marked <i>Action needed</i> wait for your answer.</p>
      </>
    ),
  },
  {
    id: 'squad', title: 'Squad and dressing room', screen: 'squad',
    body: (
      <>
        <p>The <b>Squad</b> screen lists your players: ability, condition, morale, contract. Click a player for his profile.</p>
        <p>On a profile, <b>Talk</b> lets you speak to him one to one — praise him when he is playing well, criticise him when he is not (if he can take it), lift him when he is down, or promise him games. Keep your promises: a broken one makes him want out. A player unhappy for weeks asks to leave.</p>
        <p>Some players have <b>traits</b> — the gold tags by their position: a big jump server, a setter who runs the floor, a libero who digs everything. Each makes him a little better at it.</p>
        <p>The <b>Dressing Room</b> shows who the squad listens to, and how well it holds together. A tight squad plays a little above itself; one full of new faces, or that has just lost a leader, a little below. Pick your captain there.</p>
      </>
    ),
  },
  {
    id: 'lineup', title: 'Lineup and tactics', screen: 'lineup',
    body: (
      <>
        <p>The <b>Team Sheet</b> is your six, your liberos and your bench. Drag players into their places.</p>
        <p><b>Instructions</b> set how you play: the system (5-1 or 4-2), tempo, combinations, serving and the block. <b>Rotations</b> fine-tune each of the six rotations.</p>
        <p>The opposition learns your tactics as you use them — change them now and then.</p>
      </>
    ),
  },
  {
    id: 'match', title: 'The match',
    body: (
      <>
        <p>Before kick-off and at every set break, give a <b>team talk</b>. What lands depends on the moment — favourites or underdogs, a set won or thrown away — and on the players: each reacts in his own way, and the leaders count most.</p>
        <p>During the match the coach&apos;s bar has your <b>timeouts</b> (two a set), your <b>substitutions</b> (six a set; play stops while the panel is open), a <b>shout</b> from the touchline, the <b>tactics</b>, and the <b>video challenge</b>: two a set — a wrong call is overturned and you keep the challenge; a right one costs it. It lights up when a close one goes against you.</p>
        <p>Click one of your players beside the court for quick changes, or any player for his profile. The speaker button turns the match&apos;s sound on or off.</p>
      </>
    ),
  },
  {
    id: 'transfers', title: 'Transfers and loans', screen: 'transfers',
    body: (
      <>
        <p>Signing a player under contract is two talks: a fee with his club, then terms with him. Every answer comes back days later, in the inbox — and other clubs may be after him too.</p>
        <p>Players under contract move only in a transfer window; a deal agreed while it is shut goes through when it opens.</p>
        <p>You can borrow players on loan, and send yours out — to an <b>affiliate</b>, without haggling.</p>
      </>
    ),
  },
  {
    id: 'staff', title: 'Staff', screen: 'staff',
    body: (
      <>
        <p>Your backroom develops the players, keeps them fit, scouts and analyses. Hiring works like signing a player: someone at another club means agreeing his compensation with them, then his terms.</p>
        <p>Other clubs come in for your best staff. Let them talk to him, ask for more, or keep him — and list anyone you are happy to let go.</p>
      </>
    ),
  },
  {
    id: 'training', title: 'Training', screen: 'training',
    body: <p>Plan each week&apos;s sessions, set each player&apos;s own programme, and teach players new positions. Games are where training sticks — a young player needs them, which is what a loan is for.</p>,
  },
  {
    id: 'club', title: 'Finances and the club', screen: 'finances',
    body: (
      <>
        <p><b>Finances</b> shows the books. Lose money three seasons running and the club is in real trouble.</p>
        <p><b>Tickets &amp; Sponsors</b>: set the ticket price — cheaper fills the arena, dearer takes more from fewer — and pick each summer&apos;s shirt sponsor: a steady fee, a smaller one with bonuses for winning, or a three-season deal.</p>
        <p><b>Facilities</b>: ask the board for a better training ground, youth set-up or medical centre. They say yes if the club can afford it and they trust you.</p>
        <p><b>Affiliates</b>: up to two smaller clubs who take your young players on loan and let theirs come to you a quarter cheaper.</p>
      </>
    ),
  },
  {
    id: 'world', title: 'The world', screen: 'competitions',
    body: (
      <>
        <p>Every league, cup and international tournament is played out, whether you watch or not. Open any competition for its table, results and statistics.</p>
        <p>National team jobs come up too: you can manage a nation alongside a club. Its squad, team sheet and tactics are its own.</p>
        <p>Press <b>Ctrl+K</b> anywhere to search for a player, club or nation.</p>
      </>
    ),
  },
];

/** The help: topics down the side, the one chosen beside them. */
export function HelpDialog(): JSX.Element | null {
  const g = useGame();
  const [topic, setTopic] = useState(TOPICS[0].id);
  if (!g.helpOpen) return null;
  const t = TOPICS.find((x) => x.id === topic) ?? TOPICS[0];
  return (
    <div className="hol-overlay" onClick={() => g.closeHelp()}>
      <div className="hol-card help-card" role="dialog" aria-label="Help" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs"><Icon name="help" size={13} /> <b>Help</b></span>
          <button className="icon-btn" onClick={() => g.closeHelp()} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="help-body">
          <nav className="help-topics">
            {TOPICS.map((x) => (
              <button key={x.id} className={x.id === t.id ? 'active' : ''} onClick={() => setTopic(x.id)}>{x.title}</button>
            ))}
            <button className="help-tour" onClick={() => { g.closeHelp(); g.startWelcome(); }}>
              <Icon name="playOutline" size={13} /> The welcome tour
            </button>
          </nav>
          <article className="help-text">
            <h2>{t.title}</h2>
            {t.body}
            {t.screen !== undefined && g.club !== null && (
              <button className="sm" onClick={() => { g.closeHelp(); g.go(t.screen!); }}>Go there <Icon name="arrowRight" size={12} /></button>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}

const TOUR: ReadonlyArray<{ title: string; icon: Parameters<typeof Icon>[0]['name']; text: string }> = [
  { title: 'Welcome to the club', icon: 'home', text: 'You are the head coach. The board has set a target for the season — your Home screen shows it, with your next match and the league table.' },
  { title: 'The inbox', icon: 'inbox', text: 'Everything arrives here: offers, injuries, the board, the press. Messages marked Action needed wait for your answer.' },
  { title: 'Moving time on', icon: 'play', text: 'Continue runs the calendar until something needs you. When it says Play match, it is match day.' },
  { title: 'Your team', icon: 'squad', text: 'Squad, Dressing Room, Lineup and Training are your team. Talk to your players, pick your six, set your tactics.' },
  { title: 'Help is always here', icon: 'help', text: 'The ? at the top opens the help, a topic at a time — and this tour again, whenever you want it.' },
];

/** A new manager's first look round: five steps, once per browser. */
export function WelcomeTour(): JSX.Element | null {
  const g = useGame();
  const [step, setStep] = useState(0);
  if (!g.welcomeOpen) return null;
  const s = TOUR[step];
  const last = step === TOUR.length - 1;
  const done = (): void => { setStep(0); g.closeWelcome(); };
  return (
    <div className="hol-overlay">
      <div className="hol-card tour-card" role="dialog" aria-label="Welcome">
        <div className="tour-icon"><Icon name={s.icon} size={30} /></div>
        <h2 className="hol-title">{s.title}</h2>
        <p className="hol-sub">{s.text}</p>
        <div className="tour-dots">{TOUR.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}</div>
        <footer className="tour-foot">
          <button className="ghost" onClick={done}>Skip</button>
          <span className="flex-spacer" />
          {step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
          <button className="primary" onClick={() => (last ? done() : setStep(step + 1))}>{last ? 'Start' : 'Next'}</button>
        </footer>
      </div>
    </div>
  );
}
