/**
 * Before the first serve: the coin toss (who serves first, so the coach knows which rotation to
 * start in), and the walk onto the court once he kicks off, shown while the match is set up, so the
 * screen never just hangs.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { Segmented } from './components.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

/**
 * The toss, made as the team sheet opens; the winner picks serve or receive. Drawn like the other
 * controls in the banner (a label over a small control), so it takes no more room than they do.
 */
export function CoinToss(): JSX.Element | null {
  const g = useGame();
  const md = g.matchday;
  const [spinning, setSpinning] = useState(md?.toss === undefined);
  // Tossed once, as the sheet opens; the coin spins a moment before it lands.
  useEffect(() => { if (g.matchday?.toss === undefined) g.tossCoin(); }, [g]);
  useEffect(() => {
    if (!spinning) return;
    const t = setTimeout(() => setSpinning(false), 1100);
    return () => clearTimeout(t);
  }, [spinning]);
  if (md === null || md.stage !== 'lineup') return null;
  const toss = md.toss;
  const opponent = md.sides[md.userIsHome ? 1 : 0];
  if (toss === undefined || spinning) {
    return (
      <div className="md-formation coin-toss" title="The referee tosses the coin: the winner chooses to serve or receive first.">
        <span className="faint">Coin toss</span>
        <span className="coin-toss-result"><span className="coin spinning" aria-hidden="true"><Icon name="ball" size={12} /></span>Tossing…</span>
      </div>
    );
  }
  const serves = toss.userServes === true;
  const rotation = `Start in the rotation for ${serves ? 'serving' : 'receiving'}.`;
  if (toss.userWon) {
    const choosing = toss.userServes === null;
    return (
      <div className={`md-formation coin-toss${choosing ? ' choosing' : ''}`}
        title={choosing ? 'You won the toss: serve or receive the first point?' : `You won the toss and chose to ${serves ? 'serve' : 'receive'}. ${rotation}`}>
        <span className={choosing ? 'coin-toss-call' : 'faint'}>{choosing ? 'You won the toss' : 'First serve'}</span>
        <Segmented<'serve' | 'receive' | ''>
          size="sm"
          options={[['serve', 'Serve'], ['receive', 'Receive']]}
          value={choosing ? '' : serves ? 'serve' : 'receive'}
          onChange={(v) => g.chooseFirstServe(v === 'serve')}
        />
      </div>
    );
  }
  return (
    <div className="md-formation coin-toss"
      title={`${opponent.shortName} won the toss and chose to ${serves ? 'receive' : 'serve'}. ${rotation}`}>
      <span className="faint">{opponent.shortName} won the toss</span>
      <span className={`coin-toss-result${serves ? ' serve' : ''}`}>
        <span className="coin" aria-hidden="true"><Icon name="ball" size={12} /></span>{serves ? 'You serve' : 'You receive'}
      </span>
    </div>
  );
}

const WALK_OUT = [
  'The players are getting ready in the dressing room…',
  'The teams walk out onto the court…',
  'The referees check the net and the ball…',
  'Everyone takes their place for the first serve…',
] as const;

/** How long the walk-out shows before the match is set up behind it, in ms. */
const WALK_OUT_MS = 1800;

/** The Kick off button: on a click, the walk onto the court, then the match. */
export function KickOffButton({ disabled, title }: { disabled?: boolean; title?: string }): JSX.Element {
  const g = useGame();
  const [walking, setWalking] = useState(false);
  const [step, setStep] = useState(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  const start = (): void => {
    if (walking) return;
    setWalking(true);
    const each = WALK_OUT_MS / WALK_OUT.length;
    WALK_OUT.forEach((_, i) => { if (i > 0) timers.current.push(window.setTimeout(() => setStep(i), each * i)); });
    // The match is set up at the end: the bar keeps moving (it runs off the main thread) while it is.
    timers.current.push(window.setTimeout(() => g.kickOff(), WALK_OUT_MS));
  };
  return (
    <>
      <button className="primary lg" onClick={start} data-tour="kickoff" disabled={disabled === true || walking} title={title}>
        <Icon name="whistle" size={18} /> Kick off
      </button>
      {walking && (
        <div className="walk-out" role="status" aria-live="polite">
          <div className="walk-out-card">
            <Icon name="whistle" size={28} />
            <b>Kick off</b>
            <span>{WALK_OUT[step]}</span>
            <span className="walk-out-bar"><span style={{ animationDuration: `${WALK_OUT_MS + 1400}ms` }} /></span>
            <small className="faint">{Math.min(100, Math.round(((step + 1) / WALK_OUT.length) * 90))}%</small>
          </div>
        </div>
      )}
    </>
  );
}
