/**
 * How well the side knows its tactic, and how hard the tactic works it — two
 * pills on the team sheet, as FM keeps them over its tactic: each a ring of
 * petals that fills with it, and a card with the detail on hover. A change to
 * the tactic counts against familiarity at once, as it will cost the side in
 * its next match.
 */

import type { JSX } from 'react';
import {
  currentFamiliarity, FAMILIARITY_AREA_NAMES, FAMILIARITY_AREAS, familiarityWords, intensityFatigue, intensityLabel,
  overallFamiliarity, tacticIntensity,
} from '../engine/match/tacticFamiliarity.ts';
import type { TeamTactics } from '../engine/match/tactics.ts';
import { chemistryLabel } from '../engine/world/chemistry.ts';

const PETALS = 10;

/** A ring of petals, as many lit as `value` (0-1) of them, in `color`. */
function Petals({ value, color }: { value: number; color: string }): JSX.Element {
  const lit = Math.round(Math.min(1, Math.max(0, value)) * PETALS);
  return (
    <svg className="tpill-gauge" viewBox="-10 -10 20 20" aria-hidden="true">
      {Array.from({ length: PETALS }, (_, i) => (
        <ellipse key={i} cx="0" cy="-5.3" rx="2.1" ry="3.8" transform={`rotate(${(i * 360) / PETALS})`}
          fill={i < lit ? color : 'rgba(255, 255, 255, 0.14)'} />
      ))}
      <circle r="1.7" fill="rgba(255, 255, 255, 0.85)" />
    </svg>
  );
}

function familiarColor(v: number): string {
  return v >= 70 ? 'var(--good)' : v >= 45 ? 'var(--warn)' : 'var(--bad)';
}

function intensityColor(i: number): string {
  return i < 0.35 ? 'var(--good)' : i < 0.55 ? 'var(--gold)' : i < 0.72 ? 'var(--warn)' : 'var(--bad)';
}

/** `chemistry`: the six's setter–hitter understanding on average, for a third pill — none without it. */
export function TacticPills({ tactics: t, national = false, chemistry = null }: {
  tactics: TeamTactics; national?: boolean; chemistry?: number | null;
}): JSX.Element {
  const f = currentFamiliarity(t);
  const overall = overallFamiliarity(f);
  const intensity = tacticIntensity(t);
  const toll = Math.round((intensityFatigue(t) - 1) * 100);
  return (
    <div className="tpills">
      <div className="tpill" tabIndex={0}>
        <span>Familiarity</span>
        <Petals value={overall / 100} color={familiarColor(overall)} />
        <div className="tpill-card" role="tooltip">
          <div className="tpill-card-head">
            <b>Tactical familiarity</b>
            <span style={{ color: familiarColor(overall) }}>{overall}% · {familiarityWords(overall)}</span>
          </div>
          {FAMILIARITY_AREAS.map((a) => (
            <div key={a} className="tpill-row">
              <span>{FAMILIARITY_AREA_NAMES[a]}</span>
              <span className="tpill-bar"><i style={{ width: `${Math.round(f[a])}%`, background: familiarColor(f[a]) }} /></span>
              <b>{Math.round(f[a])}</b>
            </div>
          ))}
          <p>
            Learnt in training, a tactical session or a day's preparation the most, and by playing it. Changing an
            instruction costs familiarity in its part, the more the bigger the change. Not knowing it, the side sets,
            blocks, digs, passes and serves a little worse.
            {national && ' A national side learns it a little every day, keep the same system from one window to the next.'}
          </p>
        </div>
      </div>
      <div className="tpill" tabIndex={0}>
        <span>Intensity</span>
        <Petals value={intensity} color={intensityColor(intensity)} />
        <div className="tpill-card" role="tooltip">
          <div className="tpill-card-head">
            <b>Intensity</b>
            <span style={{ color: intensityColor(intensity) }}>{intensityLabel(intensity)} · {toll > 0 ? '+' : ''}{toll}% fatigue</span>
          </div>
          <p>
            How hard the tactic works the players, the tempo most, then the defence, the offence, the combinations
            and the serve. {toll === 0 ? 'They tire as fast as usual.' : `In a match they tire ${Math.abs(toll)}% ${toll > 0 ? 'faster' : 'slower'} than with the usual tactic.`}
          </p>
        </div>
      </div>
      {chemistry !== null && <ChemistryPill value={chemistry} national={national} />}
    </div>
  );
}

function chemistryColor(c: number): string {
  return c >= 0.6 ? 'var(--good)' : c >= 0.4 ? 'var(--gold)' : c >= 0.25 ? 'var(--warn)' : 'var(--bad)';
}

/**
 * How well the six's setters and hitters understand each other, on average — a third pill,
 * with what builds it on hover: at a club, matches together; at a national side, its windows.
 */
export function ChemistryPill({ value, national }: { value: number; national: boolean }): JSX.Element {
  const pct = Math.round(value * 100);
  return (
    <div className="tpill" tabIndex={0}>
      <span>Chemistry</span>
      <Petals value={value} color={chemistryColor(value)} />
      <div className="tpill-card" role="tooltip">
        <div className="tpill-card-head">
          <b>Setter–hitter chemistry</b>
          <span style={{ color: chemistryColor(value) }}>{pct}% · {chemistryLabel(value)}</span>
        </div>
        {national ? (
          <p>
            A national side builds it in bursts: every day the squad is together for a tournament, the week before it
            and every day of it, and most of all every match a setter and a hitter share on court. Club-mates bring
            their club's understanding with them, and players with many caps start ahead. Between windows it hardly
            fades, so calling up the same core year after year keeps what they built.
          </p>
        ) : (
          <p>
            Grows with every match a setter and a hitter play together, fast at first. It eases a little over the
            summer and is gone when one of them leaves, keeping the spine of the side together pays.
          </p>
        )}
        <p className="dim">The better they know each other, the more sets arrive on time, the quick most of all.</p>
      </div>
    </div>
  );
}
