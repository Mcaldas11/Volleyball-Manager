/**
 * Recruitment and the jobs the manager hands out: the shortlist, the scouts' missions, the
 * Director of Football and who does what at the club.
 */

import { useState, type JSX } from 'react';
import { POSITION_NAMES, POSITION_SHORT, POSITIONS, type Position } from '../../engine/model/positions.ts';
import { staffRating } from '../../engine/model/staff.ts';
import { contractEndSeason, seasonEndYear } from '../../engine/world/world.ts';
import { HANDLER_NAMES, TASK_HANDLERS, TASK_NAMES, type DelegableTask } from '../../engine/world/delegation.ts';
import { missionLabel, MAX_MISSIONS, type MissionSpec } from '../../engine/world/recruitment.ts';
import type { DirectorTask } from '../../engine/world/director.ts';
import type { Confederation } from '../../engine/world/nations.ts';
import { Card, ClubCrest, Empty, money, MoneyInput, Pos, Segmented, StarMeter, useDismiss } from '../components.tsx';
import { Dropdown } from '../dropdown.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

// ---- The Director of Football: hand him a deal ----------------------------------------

/** Hand a deal to the Director of Football: the most he may pay, and the most a season in wages. */
export function DirectorDialog({ p, kind, onClose }: { p: number; kind: DirectorTask['kind']; onClose: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const ref = useDismiss(true, onClose);
  const [fee, setFee] = useState(Math.round((store.value[p] * 1.15) / 10_000) * 10_000);
  const [wage, setWage] = useState(Math.round((store.wage[p] * (kind === 'renewal' ? 1.25 : 1.3)) / 1000) * 1000);
  const director = g.director();
  const block = g.directorBlock(p, kind);
  const free = store.clubId[p] < 0;
  return (
    <div className="settings-backdrop">
      <div className="dir-dialog" ref={ref} role="dialog" aria-label="Hand it to the Director of Football">
        <header>
          <h3><Icon name="contract" size={16} /> {kind === 'renewal' ? 'New contract' : 'Sign'}: {store.fullName(p)}</h3>
          <button className="ghost" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <p className="dir-dialog-lead">
          {director !== undefined
            ? `${director.firstName} ${director.lastName} runs the talks for you and reports back. He never goes past the limits you set — a good negotiator often comes in under them.`
            : 'The club has no Director of Football. Hire one on the Staff screen to hand him deals.'}
        </p>
        {kind === 'transfer' && !free && (
          <label className="dir-field">
            <span>Most he may pay {world.clubs[store.clubId[p]]?.name ?? 'his club'} <small>value {money(store.value[p])}</small></span>
            <MoneyInput value={fee} onChange={setFee} />
          </label>
        )}
        <label className="dir-field">
          <span>Most a season in wages <small>earns {money(store.wage[p])} now</small></span>
          <MoneyInput value={wage} onChange={setWage} />
        </label>
        {block !== null && <p className="dir-block"><Icon name="alert" size={13} /> {block}</p>}
        <footer>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={block !== null} onClick={() => { g.delegateDeal(p, kind, free ? 0 : fee, wage); onClose(); }}>
            <Icon name="check" size={14} /> Hand it to him
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---- The shortlist ---------------------------------------------------------------------

export function ShortlistScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const list = g.shortlist();
  const [dialog, setDialog] = useState<number | null>(null);
  return (
    <>
      <Card title={`Shortlist · ${list.length}`} icon="star" flush className="rc-card"
        actions={<button className="sm" onClick={() => g.go('missions')}><Icon name="scouting" size={13} /> Scout missions</button>}>
        {list.length === 0 ? (
          <Empty>Nobody on your shortlist yet. Add players from their profile (☆ Shortlist), or send the scouts on a mission — what they find comes straight here.</Empty>
        ) : (
          <div className="table-wrap rc-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Player</th><th>Pos</th><th className="num">Age</th><th>Club</th><th className="num">Value</th>
                  <th>Contract</th><th>Scouts' rating</th><th />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const clubId = store.clubId[p];
                  const club = clubId >= 0 ? world.clubs[clubId] : undefined;
                  const ends = contractEndSeason(store.contractUntil[p]);
                  const task = g.directorTaskFor(p);
                  return (
                    <tr key={p}>
                      <td><span className="player-link" onClick={() => g.select(p)}>{store.fullName(p)}</span></td>
                      <td><Pos pos={store.position[p] as Position} /></td>
                      <td className="num">{store.ageOn(p, world.year, 181)}</td>
                      <td>{club !== undefined ? <span className="rc-club"><ClubCrest club={club} size={16} /> {club.shortName}</span> : <span className="good">Free agent</span>}</td>
                      <td className="num">{club === undefined ? '—' : money(store.value[p])}</td>
                      <td className={club !== undefined && ends <= world.season ? 'warn-text' : 'faint'}>{club === undefined ? '—' : `June ${seasonEndYear(world, ends)}`}</td>
                      <td><StarMeter value={g.scoutEstimate(p)} size={11} /></td>
                      <td className="rc-actions">
                        {task !== undefined
                          ? <span className="rc-task"><Icon name="contract" size={12} /> Director on it</span>
                          : (
                            <>
                              <button className="sm primary" onClick={() => g.startNegotiation(p)}>{club === undefined ? 'Offer contract' : 'Make offer'}</button>
                              <button className="sm" disabled={g.director() === undefined} title={g.director() === undefined ? 'Hire a Director of Football first' : 'Let the Director of Football do the deal'} onClick={() => setDialog(p)}>Director</button>
                            </>
                          )}
                        <button className="sm ghost" title="Off the shortlist" onClick={() => g.toggleShortlist(p)}><Icon name="close" size={12} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {dialog !== null && <DirectorDialog p={dialog} kind="transfer" onClose={() => setDialog(null)} />}
    </>
  );
}

// ---- Scout missions --------------------------------------------------------------------

const AGES: ReadonlyArray<readonly [number, string]> = [[0, 'Any age'], [21, '21 or under'], [23, '23 or under'], [25, '25 or under'], [28, '28 or under'], [31, '31 or under']];
const VALUES: ReadonlyArray<readonly [number, string]> = [[0, 'Any price'], [50_000, 'Up to €50k'], [100_000, 'Up to €100k'], [200_000, 'Up to €200k'], [500_000, 'Up to €500k'], [1_000_000, 'Up to €1M'], [2_000_000, 'Up to €2M']];
const LEVELS: ReadonlyArray<readonly [number, string]> = [[0, 'Better than our weakest'], [800, '2★ or better'], [1000, '2.5★ or better'], [1200, '3★ or better'], [1400, '3.5★ or better'], [1600, '4★ or better']];
const REGIONS: ReadonlyArray<readonly [string, string]> = [['', 'Everywhere'], ['CEV', 'Europe (CEV)'], ['CSV', 'South America (CSV)'], ['NORCECA', 'North America (NORCECA)'], ['AVC', 'Asia (AVC)'], ['CAVB', 'Africa (CAVB)']];

export function MissionsScreen(): JSX.Element {
  const g = useGame();
  const missions = g.scoutMissions();
  const [position, setPosition] = useState<number>(-1);
  const [maxAge, setMaxAge] = useState(0);
  const [maxValue, setMaxValue] = useState(0);
  const [minAbility, setMinAbility] = useState(0);
  const [region, setRegion] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const spec: MissionSpec = {
    position: position < 0 ? null : position as Position,
    maxAge: maxAge > 0 ? maxAge : null,
    maxValue: maxValue > 0 ? maxValue : null,
    minAbility: minAbility > 0 ? minAbility : null,
    freeOnly,
    region: region === '' ? null : region as Confederation,
  };
  return (
    <div className="rc-missions">
      <Card title="A new mission" icon="scouting">
        <p className="rc-lead">Tell the scouts what you are looking for. Every week they report the best new names that fit — straight onto your shortlist and into your inbox.</p>
        <div className="rc-form">
          <label><span>Position</span>
            <Dropdown value={position} onChange={setPosition}
              options={[{ value: -1, label: 'Any position' }, ...POSITIONS.map((p) => ({ value: p as number, label: POSITION_NAMES[p], hint: POSITION_SHORT[p] }))]} />
          </label>
          <label><span>Age</span><Dropdown value={maxAge} onChange={setMaxAge} options={AGES.map(([value, label]) => ({ value, label }))} /></label>
          <label><span>Price</span><Dropdown value={maxValue} onChange={setMaxValue} options={VALUES.map(([value, label]) => ({ value, label }))} /></label>
          <label><span>Level</span><Dropdown value={minAbility} onChange={setMinAbility} options={LEVELS.map(([value, label]) => ({ value, label }))} /></label>
          <label><span>Where</span><Dropdown value={region} onChange={setRegion} options={REGIONS.map(([value, label]) => ({ value, label }))} /></label>
          <label className="filter-check rc-check">
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
            Free agents and contracts running out only
          </label>
        </div>
        <div className="rc-brief"><Icon name="task" size={14} /> {missionLabel(spec)}</div>
        <button className="primary" disabled={missions.length >= MAX_MISSIONS} onClick={() => g.addScoutMission(spec)}>
          <Icon name="scouting" size={14} /> Send the scouts
        </button>
        {missions.length >= MAX_MISSIONS && <p className="faint rc-note">The scouts are running {MAX_MISSIONS} missions — call one off to start another.</p>}
      </Card>
      <Card title={`Missions under way · ${missions.length}/${MAX_MISSIONS}`} icon="task" flush className="rc-card">
        {missions.length === 0 ? <Empty>No missions out. Set one up on the left.</Empty> : (
          <div className="rc-mission-list">
            {missions.map((m) => (
              <div key={m.id} className="rc-mission">
                <div className="rc-mission-main">
                  <b>{missionLabel(m)}</b>
                  <small>Since {g.longDateLabel(m.created)} · next report {g.longDateLabel(m.nextReport)} · {m.found.length} name{m.found.length === 1 ? '' : 's'} so far</small>
                </div>
                <button className="sm" onClick={() => g.cancelScoutMission(m.id)}>Call off</button>
              </div>
            ))}
          </div>
        )}
        <div className="rc-foot faint">Reports come every 7 days. The scouts' ratings are as good as their knowledge of where a player plays.</div>
      </Card>
    </div>
  );
}

// ---- The director and who does what --------------------------------------------------------

const TASK_HINT: Readonly<Record<DelegableTask, string>> = {
  renewals: 'The director goes through the contracts running out each winter: keeps whoever is worth it, within the wage budget, and tells you who he lets go.',
  friendlies: 'Books three pre-season friendlies at the right level.',
  training: 'The assistant runs the whole programme — weekly focus, intensity, everyone\'s individual work. Your own settings stop counting.',
  press: 'The assistant fronts the press conferences: calm, nothing to win or lose. No journalist feels stood up.',
};

const STATUS: Readonly<Record<DirectorTask['status'], string>> = { working: 'In hand', done: 'Done', failed: 'Walked away', cancelled: 'Taken back' };

export function DirectorScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const director = g.director();
  const delegation = g.delegation();
  const tasks = g.directorTasks();
  if (delegation === null) return <Empty>No club.</Empty>;
  return (
    <div className="rc-director">
      <div className="rc-col">
        <Card title="Director of Football" icon="contract">
          {director !== undefined ? (
            <div className="rc-dof">
              <div className="rc-dof-name"><b>{director.firstName} {director.lastName}</b><StarMeter value={staffRating(director)} max={20} size={13} /></div>
              <p className="faint">Does your deals for you: hand him a signing from a player's profile or your shortlist, or one of your own to renew — with the most he may spend. He reports to the inbox.</p>
            </div>
          ) : (
            <div className="rc-dof">
              <p>The club has no Director of Football. With one, you can hand him signings and renewals with a budget, and the contract renewals altogether.</p>
              <button className="primary" onClick={() => g.go('staff')}><Icon name="staff" size={14} /> Hire one on the Staff screen</button>
            </div>
          )}
        </Card>
        <Card title="Responsibilities" icon="staff" className="rc-resp">
          {(Object.keys(TASK_NAMES) as DelegableTask[]).map((task) => (
            <div key={task} className="rc-resp-row">
              <div className="rc-resp-text">
                <b>{TASK_NAMES[task]}</b>
                <small>{TASK_HINT[task]}</small>
              </div>
              <Segmented size="sm" value={delegation[task]}
                onChange={(h) => g.setDelegation(task, h)}
                options={TASK_HANDLERS[task].map((h) => [h, g.canDelegateTo(h) ? HANDLER_NAMES[h] : <span className="faint" title={h === 'director' ? 'Hire a Director of Football first' : 'No assistant coach'}>{HANDLER_NAMES[h]}</span>] as const)} />
            </div>
          ))}
        </Card>
      </div>
      <Card title={`Deals handed to the director · ${tasks.filter((t) => t.status === 'working').length} in hand`} icon="transfers" flush className="rc-card">
        {tasks.length === 0 ? <Empty>No deals handed over yet. Use "Director" on a player's profile or your shortlist.</Empty> : (
          <div className="table-wrap rc-scroll">
            <table className="data-table">
              <thead><tr><th>Player</th><th>Deal</th><th>Limits</th><th>Status</th><th>What came of it</th><th /></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td><span className="player-link" onClick={() => g.select(t.p)}>{store.fullName(t.p)}</span></td>
                    <td>{t.kind === 'renewal' ? 'New contract' : 'Signing'}</td>
                    <td className="faint">{t.kind === 'transfer' && t.maxFee > 0 ? `${money(t.maxFee)} fee · ` : ''}{money(t.maxWage)}/season</td>
                    <td><span className={`rc-status ${t.status}`}>{STATUS[t.status]}</span></td>
                    <td className="rc-outcome">{t.outcome ?? 'Talks under way.'}</td>
                    <td>{t.status === 'working' && <button className="sm" onClick={() => g.cancelDirectorTask(t.id)}>Take back</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
