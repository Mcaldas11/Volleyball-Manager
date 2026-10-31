import { useRef, useState, type CSSProperties, type JSX, type PointerEvent } from 'react';
import pkg from '../../package.json';
import logo from './logo.png';
import { lessMotion } from './preferences.ts';
import { playCrowd, playWhistle } from './sound.ts';

/**
 * The splash screen, as the game opens: an arena in the dark, the lights coming up on a court, a
 * ball set high and spiked down onto it, then the name. It waits there — the lights swaying, dust in
 * the beams — until the player clicks; then the referee's whistle, the crowd, and the main menu.
 * With less motion asked for, it is the name and the prompt alone, still.
 */

/** The fade into the menu, in ms. */
const FADE = 650;

/** Shown once a page load: going back to the menu later does not bring it back. */
let shown = false;

export function splashDue(): boolean {
  return !shown;
}

/** A fixed scatter, the same every time: 0-1 from an index and a salt. */
function scatter(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The dust caught in the lights. */
const DUST = Array.from({ length: 34 }, (_, i) => ({
  left: `${(scatter(i, 1) * 100).toFixed(1)}%`,
  top: `${(18 + scatter(i, 2) * 70).toFixed(1)}%`,
  size: 1.5 + scatter(i, 3) * 2.5,
  duration: 9 + scatter(i, 4) * 9,
  delay: -scatter(i, 5) * 14,
}));

/**
 * The court in perspective, seen from a camera H metres up and DZ behind the near baseline: depth z
 * from the near baseline (0) to the far one (18), height Y off the floor, m metres across from the
 * middle — so the lines, the net and its posts fall where they would.
 */
const F = 520;
const DZ = 10;
const H = 12;
const TOP = -164;
const yAt = (z: number, up = 0): number => TOP + (F * (H - up)) / (z + DZ);
const xAt = (z: number, m: number): number => 500 + (F * m) / (z + DZ);
const pt = (z: number, m: number, up = 0): string => `${xAt(z, m).toFixed(1)} ${yAt(z, up).toFixed(1)}`;
const across = (z: number, half = 4.5): string => `M${pt(z, -half)} L${pt(z, half)}`;
const COURT = `M${pt(0, -4.5)} L${pt(18, -4.5)} L${pt(18, 4.5)} L${pt(0, 4.5)} Z`;
const FREE = `M${pt(-2, -7.5)} L${pt(21, -7.5)} L${pt(21, 7.5)} L${pt(-2, 7.5)} Z`;
/** The net on the centre line: its tape 2.43 m up, a metre of mesh, its posts a metre outside the court. */
const NET = 9;
const MESH = `M${pt(NET, -5.5, 2.43)} L${pt(NET, 5.5, 2.43)} L${pt(NET, 5.5, 1.43)} L${pt(NET, -5.5, 1.43)} Z`;
const POSTS = `M${pt(NET, -5.5)} L${pt(NET, -5.5, 2.6)} M${pt(NET, 5.5)} L${pt(NET, 5.5, 2.6)}`;
const NET_BOTTOM = `M${pt(NET, -5.5, 1.43)} L${pt(NET, 5.5, 1.43)}`;
const TAPE = `M${pt(NET, -5.5, 2.43)} L${pt(NET, 5.5, 2.43)}`;
/** Where the spike comes down: deep in the near court, a little right of centre. */
const HIT = { x: xAt(3, 1.8), y: yAt(3) };

export function Splash({ onDone }: { onDone: () => void }): JSX.Element {
  const still = lessMotion();
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  const leave = (): void => {
    if (done.current) return;
    done.current = true;
    shown = true;
    // The click is the player's own, so the browser lets the sound play.
    playWhistle();
    playCrowd(0.7);
    setLeaving(true);
    window.setTimeout(onDone, still ? 120 : FADE);
  };

  // The scene leans a little with the mouse: the lights most, the name least.
  const lean = (e: PointerEvent<HTMLDivElement>): void => {
    if (still || root.current === null) return;
    root.current.style.setProperty('--mx', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
    root.current.style.setProperty('--my', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
  };

  // The landing spot on screen: the court is drawn into the bottom 40% of the window, by its height.
  const ballVars = {
    '--hit-x': `calc(50vw + ${(((HIT.x - 500) / 1050) * 100).toFixed(2)}vh)`,
    '--hit-y': `${(100 - ((420 - HIT.y) / 1050) * 100).toFixed(2)}vh`,
  } as CSSProperties;

  return (
    <div ref={root} className={`splash${leaving ? ' leaving' : ''}${still ? ' still' : ''}`} style={ballVars}
      onClick={leave} onPointerMove={lean} role="button" aria-label="Click anywhere to start">
      <div className="splash-beams" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="splash-glow" />
      <div className="splash-dust" aria-hidden="true">
        {DUST.map((d, i) => (
          <i key={i} style={{
            left: d.left, top: d.top, width: d.size, height: d.size,
            animationDuration: `${d.duration}s`, animationDelay: `${d.delay}s`,
          }} />
        ))}
      </div>

      {/* The court, in perspective: the floor lit, then its lines drawn one by one. */}
      <svg className="splash-court" viewBox="0 0 1000 420" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        <defs>
          <linearGradient id="splash-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2f74de" stopOpacity="0.16" />
            <stop offset="1" stopColor="#3a80ea" stopOpacity="0.42" />
          </linearGradient>
          <linearGradient id="splash-free" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0c2346" stopOpacity="0.35" />
            <stop offset="1" stopColor="#123264" stopOpacity="0.6" />
          </linearGradient>
          <radialGradient id="splash-pool">
            <stop offset="0" stopColor="#dbe7ff" stopOpacity="0.22" />
            <stop offset="1" stopColor="#dbe7ff" stopOpacity="0" />
          </radialGradient>
          <pattern id="splash-mesh" width="7" height="7" patternUnits="userSpaceOnUse">
            <path d="M0 0 L7 0 M0 0 L0 7" stroke="rgba(233,236,241,0.16)" strokeWidth="0.8" />
          </pattern>
        </defs>
        <path className="sc-free" d={FREE} />
        <path className="sc-floor" d={COURT} />
        <path className="sc-line" d={COURT} />
        <ellipse className="sc-pool" cx="500" cy={yAt(NET)} rx="300" ry="120" />
        <path className="sc-line sc-centre" d={across(NET)} />
        <path className="sc-line sc-att" d={across(6)} />
        <path className="sc-line sc-att" d={across(12)} />
        <ellipse className="sc-shadow" cx={HIT.x} cy={HIT.y} rx="16" ry="4.5" />
        <circle className="sc-impact" cx={HIT.x} cy={HIT.y} r="10" />
        <circle className="sc-impact sc-impact-2" cx={HIT.x} cy={HIT.y} r="10" />
        <path className="sc-mesh" d={MESH} />
        <path className="sc-post" d={POSTS} />
        <path className="sc-net" d={NET_BOTTOM} />
        <path className="sc-tape" d={TAPE} />
      </svg>

      {/* The ball, set high above the net and spiked down onto the court. */}
      <div className="splash-ball" aria-hidden="true">
        <img className="splash-ball-spin" src={logo} alt="" />
      </div>

      <div className="splash-brand">
        <img className="splash-badge" src={logo} alt="" />
        <h1 className="splash-name">
          <span className="splash-top">
            {'VOLLEYBALL'.split('').map((c, i) => (
              <i key={i} style={{ animationDelay: `${1550 + i * 45}ms, ${4300 + i * 70}ms` }}>{c}</i>
            ))}
          </span>
          <span className="splash-bottom" translate="no">Manager</span>
        </h1>
        <span className="splash-rule" />
        <p className="splash-tagline">Every rally. Every decision. Your club.</p>
      </div>

      <div className="splash-foot">
        <span className="splash-bar"><i /></span>
        <span className="splash-start">
          <span className="splash-start-line" />
          Click anywhere to start
          <span className="splash-start-line" />
        </span>
      </div>

      <span className="splash-corner left">© 2026 Miguel Caldas</span>
      <span className="splash-corner right">v{pkg.version}</span>
      <div className="splash-flash" aria-hidden="true" />
    </div>
  );
}
