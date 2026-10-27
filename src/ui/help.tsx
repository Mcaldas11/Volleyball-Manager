/**
 * Help: what every part of the game does, a topic at a time — and the way
 * back into the tutorial (tutorial.tsx).
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
        <p>Each player wears his own <b>shirt number</b>: click it in the squad list or on his profile to give him another — one a team-mate wears swaps the two. The shirts in the match wear them.</p>
        <p>The <b>Squad Planner</b> looks two seasons ahead: contracts running out, players who may retire, academy players coming through, and the gaps that leaves at each position. Mark transfer targets against the gaps.</p>
        <p>Turn down a bid one of your players wanted and he comes to see you. Tell him he is too important to sell, that the right offer will see him go, that a better contract is coming, or that he is staying — and be ready to keep your word. Leave him waiting a week and he takes the silence as an answer.</p>
      </>
    ),
  },
  {
    id: 'lineup', title: 'Lineup and tactics', screen: 'lineup',
    body: (
      <>
        <p>The <b>Team Sheet</b> is your six, your liberos and your bench. Drag players into their places.</p>
        <p><b>Instructions</b> set how you play: the system (5-1 or 4-2), tempo, combinations, serving and the block. <b>Rotations</b> fine-tune each of the six rotations. The <b>Block plan</b> (Out of Possession, or from Rotations) sets, over a 3D court, where the block goes against the outside, the opposite and the pipe — and how many go up: pick a preset, or drag the blockers along the net and the defenders on the floor.</p>
        <p>The opposition learns your tactics as you use them — change them now and then.</p>
      </>
    ),
  },
  {
    id: 'match', title: 'The match',
    body: (
      <>
        <p>Before kick-off and at every set break, give a <b>team talk</b>. What lands depends on the moment — favourites or underdogs, a set won or thrown away — and on the players: each reacts in his own way, and the leaders count most.</p>
        <p>During the match the coach&apos;s bar has your <b>timeouts</b> (two a set — asked for with the ball in play, the referee gives it at the next dead ball), your <b>substitutions</b> (six a set; play stops while the panel is open), a <b>shout</b> from the touchline, the <b>tactics</b>, and the <b>video challenge</b>: two a set — a wrong call is overturned and you keep the challenge; a right one costs it. It lights up when a close one goes against you, play holds while you choose, and a set&apos;s last point can be challenged too — the set only ends once the video has had its say.</p>
        <p>Click one of your players beside the court for quick changes, or any player for his profile. The speaker button turns the match&apos;s sound on or off.</p>
        <p>In 3D, the <b>camera</b> menu on the court changes the view: Broadcast (the main TV camera), Dynamic (closer, following the ball), Professional (a TV director cutting between shots), Sky (straight down), Behind (behind your end line) and Courtside (down by the court). Your choice is kept for the next match.</p>
      </>
    ),
  },
  {
    id: 'transfers', title: 'Transfers and loans', screen: 'transfers',
    body: (
      <>
        <p>Signing a player under contract is two talks: a fee with his club, then terms with him. Every answer comes back days later, in the inbox — and other clubs may be after him too.</p>
        <p>Players under contract move only in a transfer window; a deal agreed while it is shut goes through when it opens. A player&apos;s price depends on his contract: years left cost more, a deal running out much less.</p>
        <p><b>Scouting</b> searches for players; <b>Scout Missions</b> send the scouts out with a brief, and every week they bring new names to your <b>Shortlist</b> and inbox.</p>
        <p>Every player has an <b>agent</b>: his commission, whether he asks for release clauses, and how readily he takes clients elsewhere when their contracts run out. Agents also offer you their clients for the gaps in your squad.</p>
        <p><b>Deadline Day</b>, the last day of each window, has its own screen: the clock to midnight, the late deals and rumours, last-minute bids.</p>
        <p>A <b>Director of Football</b> negotiates for you within the limits you set. Under <b>Director &amp; Delegation</b> choose who handles renewals, friendlies, training and press conferences.</p>
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
        <p>On the 3rd of each month the <b>Staff Meeting</b> brings their suggestions — a contract to renew, a position short, a player heading for an injury, a youngster ready. Take each one or leave it; what is left lapses at the next meeting.</p>
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
        <p><b>Social</b>, under News, is the volleyball world's timeline; <b>Coaches</b>, under Stats, ranks the head coaches and keeps each club's and country's coaching legends; the <b>Data Hub</b>, under Analysis, measures every side in a league.</p>
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
            {g.club !== null && (
              <button className="help-tour" onClick={() => { g.closeHelp(); g.startTutorial(); }}>
                <Icon name="playOutline" size={13} /> The tutorial
              </button>
            )}
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
