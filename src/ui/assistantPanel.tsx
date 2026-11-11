/**
 * The assistant's report in a match — at a set break, at a pause, or when
 * coaching mode stops play: what he reads in the numbers, the changes worth
 * making (one click, for this match; undone as easily), what the other bench
 * has changed against us, and the switch for coaching mode.
 */

import type { JSX } from 'react';
import type { Diagnosis, Finding } from '../engine/match/assistant.ts';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

const SEVERITY: Readonly<Record<Finding['severity'], { label: string; cls: string }>> = {
  3: { label: 'Costing points', cls: 'bad' },
  2: { label: 'Worth acting on', cls: 'warn' },
  1: { label: 'Worth knowing', cls: '' },
};

const pct = (x: number | null): string => (x === null ? '—' : `${Math.round(x * 100)}%`);

/** The headline numbers the reading rests on. */
export function DiagnosisNumbers({ d }: { d: Diagnosis }): JSX.Element {
  const n = d.numbers;
  return (
    <div className="as-numbers">
      <span><b>{pct(n.sideOut)}</b><span className="faint">Side-out</span></span>
      <span><b>{pct(n.breakPoint)}</b><span className="faint">Break point</span></span>
      <span><b>{n.attackEff === null ? '—' : n.attackEff.toFixed(3)}</b><span className="faint">Attack eff.</span></span>
      <span><b>{n.passQ === null ? '—' : Math.round(n.passQ * 100)}</b><span className="faint">Pass quality</span></span>
      <span><b>{pct(n.serveErrors)}</b><span className="faint">Serve errors</span></span>
    </div>
  );
}

/** One finding: what he sees, and the change if there is one. */
export function FindingRow({ f, applied, onApply, onUndo, extra }: {
  f: Finding;
  applied: boolean;
  onApply: () => void;
  onUndo?: () => void;
  extra?: JSX.Element | null;
}): JSX.Element {
  const sev = SEVERITY[f.severity];
  return (
    <div className={`as-finding sev-${f.severity}`}>
      <div className="as-finding-main">
        <span className={`as-sev ${sev.cls}`}>{sev.label}</span>
        <b>{f.title}</b>
        <span className="faint">{f.detail}</span>
        {extra}
      </div>
      {f.change !== undefined && (
        <div className="as-finding-act">
          {applied ? (
            <>
              <span className="as-done"><Icon name="check" size={13} /> {f.change.label}</span>
              {onUndo !== undefined && <button className="sm" onClick={onUndo}>Undo</button>}
            </>
          ) : (
            <button className="sm primary" onClick={onApply} title={f.change.label}>
              <Icon name="tactics" size={13} /> {f.change.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The assistant's report on the match so far. */
export function AssistantReport(): JSX.Element {
  const g = useGame();
  const md = g.matchday!;
  const d = g.liveDiagnosis();
  const moves = g.opponentMovesThisMatch();
  const applied = md.assistantApplied ?? {};
  return (
    <div className="as-report">
      {md.assistantPrompt != null && <p className="as-prompt"><Icon name="whistle" size={14} /> {md.assistantPrompt}</p>}
      {d === null ? <p className="faint">The assistant has nothing to go on yet.</p> : (
        <>
          <p className={`as-summary v-${d.verdict}`}>
            <Icon name={d.verdict === 'adjust' ? 'alert' : 'check'} size={15} /> {d.summary}
          </p>
          <DiagnosisNumbers d={d} />
          <div className="as-findings">
            {d.findings.length === 0 && d.verdict !== 'early' && <p className="faint">Nothing to flag.</p>}
            {d.findings.map((f) => (
              <FindingRow key={f.id} f={f} applied={f.change !== undefined && applied[f.change.id] !== undefined}
                onApply={() => g.applyAssistantChange(f)}
                onUndo={f.change !== undefined ? () => g.undoAssistantChange(f.change!.id) : undefined} />
            ))}
          </div>
        </>
      )}
      {moves.length > 0 && (
        <div className="as-opponent">
          <span className="as-opponent-title"><Icon name="swap" size={13} /> The other bench</span>
          {moves.map((m) => <span key={m.id} className="as-opponent-move">{m.during === true ? `During set ${m.set}: ${m.message}` : `Before set ${m.set}: ${m.message}`}</span>)}
        </div>
      )}
      <label className="as-mode" title="The assistant stops play after a run of points against, and as a set goes tight, so you can look at it">
        <input type="checkbox" checked={g.coachingMode} onChange={(e) => g.setCoachingMode(e.target.checked)} />
        <span>Coaching mode — stop play at the key moments</span>
      </label>
      <p className="faint as-foot">Changes are for this match only, from the next rally — the tactic goes back to how it was at kickoff afterwards.</p>
    </div>
  );
}

/** The assistant's report as a dialog — at a set break. */
export function AssistantDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const md = useGame().matchday!;
  return (
    <div className="hol-overlay" onClick={onClose}>
      <div className="hol-card as-card" role="dialog" aria-label="The assistant's report" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs">{`End of set ${md.snapshot?.set ?? 0}`} <Icon name="chevronRight" size={12} /> <b>Assistant</b></span>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <h2 className="hol-title">The Assistant's Report</h2>
        <AssistantReport />
      </div>
    </div>
  );
}
