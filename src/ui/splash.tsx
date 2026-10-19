import { useEffect, useRef, useState, type JSX } from 'react';
import { lessMotion } from './preferences.ts';

/**
 * The splash screen, as the game opens: a court drawn in light, a ball spiked down onto it, the
 * name, and a bar filling — then it fades into the main menu. A click or a key skips it; with less
 * motion asked for, it is the name alone, briefly.
 */

/** How long it runs before fading, and the fade, in ms. */
const RUN = 3400;
const FADE = 520;
const RUN_STILL = 1100;

/** Shown once a page load: going back to the menu later does not bring it back. */
let shown = false;

export function splashDue(): boolean {
  return !shown;
}

export function Splash({ onDone }: { onDone: () => void }): JSX.Element {
  const still = lessMotion();
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);

  const leave = (): void => {
    if (done.current) return;
    done.current = true;
    shown = true;
    setLeaving(true);
    window.setTimeout(onDone, still ? 0 : FADE);
  };

  useEffect(() => {
    const t = window.setTimeout(leave, still ? RUN_STILL : RUN);
    const key = (e: KeyboardEvent): void => {
      e.preventDefault();
      leave();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', key);
    };
  }, []);

  return (
    <div className={`splash${leaving ? ' leaving' : ''}${still ? ' still' : ''}`} onClick={leave} role="presentation">
      <div className="splash-glow" />

      {/* The court, in perspective, drawn line by line. */}
      <svg className="splash-court" viewBox="0 0 1000 420" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        <path className="sc-line" d="M210 400 L360 120 L640 120 L790 400 Z" />
        <path className="sc-line sc-mid" d="M262 302 L738 302" />
        <path className="sc-line sc-att" d="M320 196 L680 196" />
        <path className="sc-line sc-att" d="M236 352 L764 352" />
        <path className="sc-mesh" d="M286 182 L714 182 L714 258 L286 258 Z" />
        <path className="sc-net" d="M286 258 L714 258" />
        <path className="sc-post" d="M286 258 L286 182 M714 258 L714 182" />
        <path className="sc-tape" d="M286 182 L714 182" />
        <circle className="sc-impact" cx="566" cy="342" r="10" />
        <circle className="sc-impact sc-impact-2" cx="566" cy="342" r="10" />
      </svg>

      {/* The ball, set high and spiked down onto the court. */}
      <div className="splash-ball" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none" strokeLinecap="round">
          <circle cx="32" cy="32" r="28" fill="#f4f1ea" />
          <path d="M32 4 C 20 16 20 48 32 60" stroke="#d7a73f" strokeWidth="4" />
          <path d="M6 22 C 24 30 40 30 58 22" stroke="#2f5fc4" strokeWidth="4" />
          <path d="M7 44 C 24 35 40 35 57 44" stroke="#d7a73f" strokeWidth="4" />
          <circle cx="32" cy="32" r="28" stroke="#0c1521" strokeOpacity="0.25" strokeWidth="1.5" />
        </svg>
      </div>

      <div className="splash-brand">
        <span className="splash-badge">VM</span>
        <h1 className="splash-name">
          <span className="splash-top">
            {'VOLLEYBALL'.split('').map((c, i) => <i key={i} style={{ animationDelay: `${1180 + i * 45}ms` }}>{c}</i>)}
          </span>
          <span className="splash-bottom">Manager</span>
        </h1>
        <span className="splash-rule" />
        <p className="splash-tagline">Every rally. Every decision. Your club.</p>
      </div>

      <div className="splash-foot">
        <span className="splash-bar"><i /></span>
        <span className="splash-skip">Click or press any key</span>
      </div>
    </div>
  );
}
