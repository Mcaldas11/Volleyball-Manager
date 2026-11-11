/**
 * Between matches, the tactical side of the Analysis: the assistant's
 * diagnosis of the last few matches — each finding with a change that can be
 * made, its cost in familiarity shown, and undone — with every change made on
 * his word kept; and the preparation lab, the next opponent as the staff read
 * him and practice matches to try things against him.
 */

import { useState, type JSX } from 'react';
import { PREP_VARIANTS, OFFENSE_NAMES, SERVE_NAMES, TEMPO_NAMES } from '../../engine/world/prepLab.ts';
import { DiagnosisNumbers, FindingRow } from '../assistantPanel.tsx';
import { Card, ClubCrest, ClubLink, Empty, PlayerLink } from '../components.tsx';
import { Dropdown } from '../dropdown.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

export function DiagnosisScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const { d, matches } = g.seasonDiagnosis();
  const undoable = g.undoableAnalysisChange();
  const history = g.tacticDecisions();
  const inMatch = g.matchday !== null && g.matchday.stage !== 'lineup';
  return (
    <div className="tl-lab">
      <Card title="Tactical Diagnosis" icon="stats" className="tl-lab-main"
        actions={<span className="faint">{matches.length === 0 ? 'no matches yet' : `the last ${matches.length} match${matches.length === 1 ? '' : 'es'} played in full`}</span>}>
        {matches.length === 0 || d === null ? <Empty>The assistant reads the matches you play in full. Play one, and his diagnosis is here.</Empty> : (
          <div className="as-report">
            <div className="tl-lab-matches">
              {matches.map((m) => (
                <span key={m.fixtureId} className={`tl-lab-match ${m.won ? 'won' : 'lost'}`} title={world.clubs[m.opponent]?.name}>
                  {m.won ? 'W' : 'L'} · {world.clubs[m.opponent]?.shortName ?? '?'}
                </span>
              ))}
            </div>
            <p className={`as-summary v-${d.verdict}`}><Icon name={d.verdict === 'adjust' ? 'alert' : 'check'} size={15} /> {d.summary}</p>
            <DiagnosisNumbers d={d} />
            <div className="as-findings">
              {d.findings.length === 0 && <p className="faint">Nothing to flag over these matches.</p>}
              {d.findings.map((f) => {
                const cost = f.change !== undefined ? g.familiarityCost(f.change) : 0;
                return (
                  <FindingRow key={f.id} f={f}
                    applied={f.change !== undefined && undoable === f.change.id}
                    onApply={() => { if (f.change !== undefined && !inMatch) g.applyTacticChange(f.title, f.change); }}
                    onUndo={() => g.undoAnalysisChange()}
                    extra={f.change !== undefined ? (
                      <span className="faint as-cost">{cost > 0 ? `Familiarity: −${cost} overall until it is learnt again in training` : 'No cost in familiarity'}</span>
                    ) : null} />
                );
              })}
            </div>
            <p className="faint as-foot">A change made here goes into the tactic for good — training brings the familiarity back. The diagnosis reads only what the matches show: a sample, not the truth.</p>
          </div>
        )}
      </Card>
      <Card title="Decision History" icon="schedule" flush className="tl-lab-side"
        actions={<span className="faint">kept with the career</span>}>
        {history.length === 0 ? <Empty>No changes made on the assistant's word yet.</Empty> : (
          <ul className="tl-history">
            {history.map((h) => (
              <li key={h.id} className={h.undone === true ? 'undone' : ''}>
                <span className="faint">{`${g.dateLabelForDay(h.day)} · ${h.where === 'live' ? (h.set !== undefined ? `in a match, before set ${h.set}` : 'in a match') : 'from the Analysis'}`}</span>
                <b>{h.change}</b>
                <span className="faint">{h.undone === true ? `${h.finding} · undone` : h.finding}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function PrepLabScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const prep = g.prepOpponent();
  const [variant, setVariant] = useState(PREP_VARIANTS[0].id);
  const [running, setRunning] = useState(false);
  if (prep === null) return <Empty>No match coming up to prepare for.</Empty>;
  const { opp, scouted, fixture } = prep;
  const result = g.labResult(variant);
  const chosen = PREP_VARIANTS.find((v) => v.id === variant)!;
  const sure = (ok: boolean): JSX.Element => <span className={`tl-sure ${ok ? 'yes' : 'no'}`}>{ok ? 'sure' : 'a guess'}</span>;
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const run = (): void => {
    setRunning(true);
    // A beat for the "running" state to show before the matches are played.
    window.setTimeout(() => { g.runPrepLab(variant); setRunning(false); }, 30);
  };
  return (
    <div className="tl-lab">
      <Card title="Preparation Lab" icon="tactics" className="tl-lab-main"
        actions={<span className="faint">practice matches against the opponent as the staff read him</span>}>
        <div className="as-report">
          <p className="faint">Try one change against your tactic as it stands: forty practice matches each, the same dice for both. A wrong read of the opponent makes for a wrong lesson.</p>
          <div className="tl-lab-run">
            <Dropdown<string> value={variant} options={PREP_VARIANTS.map((v) => ({ value: v.id, label: v.label }))} searchable={false} onChange={setVariant} />
            <button className="primary" disabled={running} onClick={run}><Icon name="play" size={14} /> {running ? 'Playing…' : 'Run practice matches'}</button>
          </div>
          {result === null ? <p className="faint">Not run yet.</p> : (
            <>
              <div className="tl-lab-compare">
                <div><span className="faint">As it is</span><b title="of the points">{pct(result.base.points)}</b><span className="faint">of the points</span><span className="faint">{`${pct(result.base.sets)} of sets · side-out ${pct(result.base.sideOut)}`}</span></div>
                <div><span className="faint">{chosen.label}</span><b>{pct(result.variant.points)}</b><span className="faint">of the points</span><span className="faint">{`${pct(result.variant.sets)} of sets · side-out ${pct(result.variant.sideOut)}`}</span></div>
              </div>
              <p className={`as-summary ${result.confidence === 'noise' ? 'v-early' : result.edge > 0 ? 'v-hold' : 'v-adjust'}`}>
                <Icon name={result.edge > 0 ? 'check' : 'alert'} size={15} />
                {result.confidence === 'noise'
                  ? `No real difference over ${result.matches} matches (${result.edge >= 0 ? '+' : ''}${result.edge.toFixed(1)} points per hundred) — it could go either way.`
                  : `${result.edge > 0 ? 'Better' : 'Worse'}: ${result.edge >= 0 ? '+' : ''}${result.edge.toFixed(1)} points per hundred rallies — ${result.confidence === 'clear' ? 'a clear difference' : 'likely, not certain'}.`}
              </p>
              {result.edge > 0 && result.confidence !== 'noise' && (
                <div className="tl-lab-run">
                  <button className="sm primary" disabled={g.undoableAnalysisChange() === chosen.id} onClick={() => g.applyTacticChange(`Prep lab against ${opp.name}`, chosen)}>
                    <Icon name="tactics" size={13} /> Use it in the tactic
                  </button>
                  {g.undoableAnalysisChange() === chosen.id && <button className="sm" onClick={() => g.undoAnalysisChange()}>Undo</button>}
                  <span className="faint">{`Familiarity: −${g.familiarityCost(chosen)} overall until it is learnt again in training`}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
      <Card title="Next Opponent" icon="scouting" className="tl-lab-side"
        actions={<span className="faint">{g.dateLabelForDay(fixture.day)}</span>}>
        <div className="tl-opp">
          <div className="tl-opp-head"><ClubCrest club={opp} size={34} /><b><ClubLink id={opp.id} /></b></div>
          <p className="faint">{`The staff's read — ${Math.round(scouted.accuracy * 100)}% sure on the whole. Better scouts and analysts read him better.`}</p>
          <dl className="tl-opp-facts">
            <dt>Attack</dt><dd>{OFFENSE_NAMES[scouted.offense]} {sure(scouted.offenseSure)}</dd>
            <dt>Tempo</dt><dd>{TEMPO_NAMES[scouted.tempo]} {sure(scouted.tempoSure)}</dd>
            <dt>Serve</dt><dd>{SERVE_NAMES[scouted.serve]} {sure(scouted.serveSure)}</dd>
            <dt>Danger man</dt><dd>{scouted.danger >= 0 ? <PlayerLink idx={scouted.danger} /> : '—'}</dd>
            <dt>Weakest passer</dt><dd>{scouted.weakPasser >= 0 ? <><PlayerLink idx={scouted.weakPasser} /> {sure(scouted.weakSure)}</> : '—'}</dd>
          </dl>
          {scouted.danger >= 0 && <p className="faint">{`${store.fullName(scouted.danger)} has done most of their scoring this season.`}</p>}
        </div>
      </Card>
    </div>
  );
}
