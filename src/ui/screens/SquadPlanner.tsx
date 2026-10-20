/**
 * The squad planner: the squad by position over this season and the next two — who is under
 * contract, whose deal runs out, who may stop, the academy coming through — the gaps that leaves,
 * and the transfer targets marked against them.
 */

import { useMemo, useState, type JSX } from 'react';
import { POSITION_NAMES, Position, POSITIONS } from '../../engine/model/positions.ts';
import { contractEndSeason } from '../../engine/world/world.ts';
import { PLAN_DEPTH, type PlanCell, type PlanEntry, type PlanTag } from '../../engine/world/squadPlanner.ts';
import { abilityClass, Card, ClubCrest, Empty, money, Pos, StarMeter, useDismiss } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { seasonLabel } from './Squad.tsx';

const TAG_META: Readonly<Record<PlanTag, { label: string; tone: string; title: string }>> = {
  expires: { label: 'Expires', tone: 'warn', title: 'His contract ends with this season' },
  retiring: { label: 'Retiring', tone: 'bad', title: 'He stops at the end of this season' },
  mayRetire: { label: 'May retire', tone: 'dim-bad', title: 'Old enough by then that he may stop' },
  loanIn: { label: 'Loan', tone: 'dim', title: 'Here on loan: back to his club at the season\'s end' },
  loanOut: { label: 'Out on loan', tone: 'info', title: 'Ours, out on loan this season — back for the next' },
  listed: { label: 'Listed', tone: 'dim', title: 'On the transfer list' },
  joining: { label: 'Joining', tone: 'good', title: 'Signed — joins when the window opens' },
};

export function SquadPlannerScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const plan = g.squadPlan();
  const [picking, setPicking] = useState<{ position: Position; season: number } | null>(null);
  if (plan === null) return <Empty>No club.</Empty>;

  return (
    <>
      <div className="plan-seasons">
        {plan.summary.map((s, i) => (
          <div key={s.season} className={`plan-season${i === 0 ? ' now' : ''}`}>
            <div className="plan-season-head">
              <b>{seasonLabel(world, s.season)}</b>
              <span>{i === 0 ? 'This season' : i === 1 ? 'Next season' : 'In two seasons'}</span>
            </div>
            <div className="plan-season-stats">
              <span title="Senior players under contract"><b>{s.squad}</b> squad</span>
              <span className={s.gaps > 0 ? 'bad' : 'good'} title="Places short of the depth each position wants"><b>{s.gaps}</b> {s.gaps === 1 ? 'gap' : 'gaps'}</span>
              <span className={s.expiring > 0 ? 'warn' : ''} title="Contracts ending with this season"><b>{s.expiring}</b> expiring</span>
              <span className={s.retiring > 0 ? 'bad' : ''} title="Retiring, or old enough that they may"><b>{s.retiring}</b> may stop</span>
            </div>
            <div className="plan-season-wages" title="Wages of the players under contract that season, against today's wage budget">
              Wages <b className={s.wages > s.budget ? 'bad' : ''}>{money(s.wages)}</b> of {money(s.budget)}
            </div>
          </div>
        ))}
      </div>

      <Card title="Squad plan" icon="squad" flush className="plan-card"
        actions={<span className="plan-legend">Stars: ability projected for that season · <i className="plan-chip warn">Expires</i> last season of his deal · <i className="plan-chip gold">Target</i> marked to sign</span>}>
        <div className="plan-grid">
          <div className="plan-corner">Position</div>
          {plan.seasons.map((s, i) => <div key={s} className="plan-col-head">{seasonLabel(world, s)}{i === 0 && <small>now</small>}</div>)}
          {POSITIONS.map((position, r) => (
            <PlanRow key={position} position={position} cells={plan.cells[r]} onPick={(season) => setPicking({ position, season })} />
          ))}
        </div>
      </Card>

      {picking !== null && <TargetPicker position={picking.position} season={picking.season} onClose={() => setPicking(null)} />}
    </>
  );
}

function PlanRow({ position, cells, onPick }: { position: Position; cells: PlanCell[]; onPick: (season: number) => void }): JSX.Element {
  return (
    <>
      <div className="plan-pos">
        <Pos pos={position} />
        <span>{POSITION_NAMES[position]}s</span>
        <small>{PLAN_DEPTH[position]} wanted</small>
      </div>
      {cells.map((c) => <PlanCellView key={c.season} cell={c} onPick={() => onPick(c.season)} />)}
    </>
  );
}

function PlanCellView({ cell, onPick }: { cell: PlanCell; onPick: () => void }): JSX.Element {
  const covered = cell.gaps > 0 && cell.targets.length >= cell.gaps;
  const open = Math.max(0, cell.gaps - cell.targets.length);
  return (
    <div className={`plan-cell${cell.gaps > 0 ? covered ? ' covered' : ' short' : ''}`}>
      {cell.players.map((e) => <PlanPlayer key={e.p} e={e} />)}
      {cell.targets.map((e) => <PlanPlayer key={`t${e.p}`} e={e} target />)}
      {Array.from({ length: open }, (_, i) => (
        <button key={`gap${i}`} className="plan-gap" onClick={onPick} title="Mark a transfer target for this place">
          <span>Gap</span><Icon name="search" size={12} /> Add target
        </button>
      ))}
      {cell.academy.map((e) => <PlanPlayer key={`a${e.p}`} e={e} academy />)}
      {open === 0 && (
        <button className="plan-add" onClick={onPick} title="Mark a transfer target for this position and season">
          + Target
        </button>
      )}
    </div>
  );
}

function PlanPlayer({ e, target = false, academy = false }: { e: PlanEntry; target?: boolean; academy?: boolean }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const delta = e.ability - e.now;
  const club = target && store.clubId[e.p] >= 0 ? world.clubs[store.clubId[e.p]] : undefined;
  return (
    <div className={`plan-p${target ? ' target' : ''}${academy ? ' academy' : ''}`}>
      <span className="plan-p-name player-link" onClick={() => g.select(e.p)} title={store.fullName(e.p)}>
        {club !== undefined && <ClubCrest club={club} size={13} />}
        {store.shortName(e.p)}
      </span>
      <span className="plan-p-age" title="Age at that season's end">{e.age}</span>
      <span className="plan-p-ab" title={`Ability ${e.now} now${delta !== 0 ? `, ${e.ability} projected` : ''}`}>
        <StarMeter value={e.ability} size={10} />
        {Math.abs(delta) >= 40 && <i className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? '▲' : '▼'}</i>}
      </span>
      <span className="plan-p-tags">
        {target && <i className="plan-chip gold" title={club !== undefined ? `At ${club.name} · value ${money(store.value[e.p])}` : 'Free agent'}>Target</i>}
        {academy && <i className="plan-chip green" title="Academy player old enough to step up by then">Academy</i>}
        {e.tags.map((t) => <i key={t} className={`plan-chip ${TAG_META[t].tone}`} title={TAG_META[t].title}>{TAG_META[t].label}</i>)}
        {target && (
          <button className="plan-x" title="Take him off the plan" onClick={() => g.removePlanTarget(e.p)}><Icon name="close" size={11} /></button>
        )}
      </span>
    </div>
  );
}

/** The scouts' list for a gap: within reach first, then the nearly-good-enough, then the dear. */
function TargetPicker({ position, season, onClose }: { position: Position; season: number; onClose: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const [query, setQuery] = useState('');
  const ref = useDismiss(true, onClose);
  const all = useMemo(() => g.planCandidates(position, season), [g, position, season]);
  const q = query.trim().toLowerCase();
  const list = q === '' ? all : all.filter((p) => store.fullName(p).toLowerCase().includes(q));
  const budget = g.club?.finances.transferBudget ?? 0;
  return (
    <div className="settings-backdrop">
      <div className="plan-picker" ref={ref} role="dialog" aria-label="Choose a target">
        <header className="plan-picker-head">
          <div>
            <h3><Pos pos={position} /> Targets: {POSITION_NAMES[position].toLowerCase()} for {seasonLabel(world, season)}</h3>
            <p>The scouts' list — within reach first (a fee you can find, a free agent, or a contract that will have run out), then the nearly good enough, then the ones it would take more money or a bigger club to land.</p>
          </div>
          <button className="ghost" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="plan-picker-search">
          <Icon name="search" size={14} />
          <input autoFocus placeholder="Filter by name" value={query} onChange={(ev) => setQuery(ev.target.value)} />
          <span>Transfer budget {money(budget)}</span>
        </div>
        <div className="plan-picker-list">
          {list.length === 0 && <Empty>Nobody on the scouts' list{q !== '' ? ' by that name' : ''}.</Empty>}
          {list.map((p) => {
            const clubId = store.clubId[p];
            const club = clubId >= 0 ? world.clubs[clubId] : undefined;
            const free = clubId < 0 || contractEndSeason(store.contractUntil[p]) < season;
            const on = g.isPlanTarget(p);
            return (
              <div key={p} className="plan-cand">
                <span className="plan-cand-name player-link" onClick={() => { onClose(); g.select(p); }}>{store.fullName(p)}</span>
                <span className="plan-cand-club">{club !== undefined ? <><ClubCrest club={club} size={14} /> {club.shortName}</> : 'Free agent'}</span>
                <span className="num">{store.ageOn(p, world.year, 181)}</span>
                <span className="plan-cand-ab"><StarMeter value={store.currentAbility[p]} size={11} /> <b className={abilityClass(store.currentAbility[p])}>{store.currentAbility[p]}</b></span>
                <span className={`num${free ? ' good' : store.value[p] > budget ? ' bad' : ''}`}
                  title={clubId < 0 ? 'A free agent' : free ? 'His contract runs out before then: no fee' : store.value[p] > budget ? 'More than your transfer budget' : 'His value'}>
                  {clubId < 0 ? 'Free' : free ? 'Free then' : money(store.value[p])}
                </span>
                <button className={on ? '' : 'primary'} disabled={on} onClick={() => { g.addPlanTarget(p, position, season); onClose(); }}>
                  {on ? 'On the plan' : 'Add'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
