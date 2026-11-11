/**
 * The academy's three working tabs beside its players and its U19 league:
 * development programmes, youth searches and the youth facilities — money and
 * time put into the youngsters, with no promise of a star (see academy.ts).
 */

import { useState, type JSX } from 'react';
import {
  INTENSITY_NAMES, MAX_PROGRAMMES, MAX_SEARCHES, PROGRAMME_AREAS, PROGRAMME_DAYS, SCOPE_NAMES, SEARCH_DAYS,
  type ProgrammeArea, type ProgrammeIntensity, type SearchScope,
} from '../../engine/world/academy.ts';
import { buildDays, FACILITY_EFFECTS, FACILITY_NAMES, facilityLevel, upgradeCost, type FacilityKind } from '../../engine/world/facilities.ts';
import { FOCUS_LABELS } from '../../engine/world/training.ts';
import { Position, POSITION_NAMES, POSITIONS } from '../../engine/model/positions.ts';
import { abilityClass, Bar, Card, ClubLink, Empty, Flag, money, PlayerFace, Pos, StarMeter } from '../components.tsx';
import { Dropdown } from '../dropdown.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

/** The part of the game a prospect's programme starts on: what his position needs most. */
const DEFAULT_AREA: Readonly<Record<Position, ProgrammeArea>> = {
  [Position.Setter]: 'setting', [Position.Opposite]: 'attacking', [Position.OutsideHitter]: 'reception',
  [Position.MiddleBlocker]: 'blocking', [Position.Libero]: 'reception',
};

const AREA_OPTIONS = PROGRAMME_AREAS.map((a) => ({ value: a, label: FOCUS_LABELS[a] }));
const INTENSITY_OPTIONS = (['normal', 'intensive'] as const).map((i) => ({ value: i, label: INTENSITY_NAMES[i] }));

/** How far through its weeks something is: a gold bar of its own, never a warning's red. */
function Progress({ value, max }: { value: number; max: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return <span className="acx-prog"><span style={{ width: `${Math.max(2, pct)}%` }} /></span>;
}

/** The money strip along a tab's head. */
function Funds({ extra }: { extra?: string }): JSX.Element {
  const g = useGame();
  return (
    <span className="acx-funds">
      <span className="faint">Balance</span> <b>{money(g.club!.finances.balance)}</b>
      {extra !== undefined && <><span className="acx-dot">·</span>{extra}</>}
    </span>
  );
}

// ---- Development ----------------------------------------------------------------------

export function AcademyDevelopment(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const youth = g.youthSquad();
  const state = g.academyState();
  const [picks, setPicks] = useState<Record<number, { area: ProgrammeArea; intensity: ProgrammeIntensity; second: ProgrammeArea | 'none' }>>({});
  const active = state?.programmes ?? [];
  const pick = (p: number): { area: ProgrammeArea; intensity: ProgrammeIntensity; second: ProgrammeArea | 'none' } =>
    picks[p] ?? { area: DEFAULT_AREA[store.position[p] as Position] ?? 'physical', intensity: 'normal', second: 'none' };
  const set = (p: number, change: Partial<{ area: ProgrammeArea; intensity: ProgrammeIntensity; second: ProgrammeArea | 'none' }>): void =>
    setPicks((old) => ({ ...old, [p]: { ...pick(p), ...change } }));

  return (
    <Card title="Development Programmes" icon="training" flush className="academy-card acx-card"
      actions={<Funds extra={`${active.length}/${MAX_PROGRAMMES} running · ${state?.completed ?? 0} completed`} />}>
      <p className="acx-lead">
        Twelve weeks of a prospect's training pointed at one part of his game. What comes of it depends on his minutes for the U19s,
        your coaches, the man himself and his age. It never raises his potential, and nothing is guaranteed.
      </p>
      {youth.length === 0 ? <Empty>No prospects in the academy.</Empty> : (
        <div className="acx-rows">
          {youth.map((p) => {
            const prog = active.find((x) => x.playerIdx === p);
            const choice = pick(p);
            const block = g.programmeBlock(p, choice.intensity);
            const cost = g.programmeCost(choice.intensity);
            return (
              <div key={p} className={`acx-row${prog !== undefined ? ' on' : ''}`}>
                <button className="acx-who" onClick={() => g.select(p)}>
                  <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={30} />
                  <span>
                    <b>{store.fullName(p)}</b>
                    <span className="faint">
                      <Pos pos={store.position[p] as Position} /> {store.ageOn(p, world.year, 181)} · ability{' '}
                      <span className={abilityClass(store.currentAbility[p])}>{store.currentAbility[p]}</span> · potential {store.potentialAbility[p]}
                    </span>
                  </span>
                </button>
                {prog !== undefined ? (
                  <div className="acx-progress">
                    <span className="acx-status">
                      <b className="pos">In progress</b> · {FOCUS_LABELS[prog.area]}{prog.secondary !== undefined && <> + {FOCUS_LABELS[prog.secondary]} <span className="faint">(70/30)</span></>} · {INTENSITY_NAMES[prog.intensity]}
                      <span className="faint"> · {(() => { const d = store.currentAbility[p] - prog.startAbility; return `${d >= 0 ? '+' : ''}${d} ability since it began`; })()}</span>
                    </span>
                    <Progress value={world.day - prog.startDay} max={PROGRAMME_DAYS} />
                    <span className="faint acx-days">{`${Math.max(0, prog.endDay - world.day)} days left`}</span>
                  </div>
                ) : (
                  <div className="acx-controls">
                    <Dropdown<ProgrammeArea> size="sm" value={choice.area} options={AREA_OPTIONS} searchable={false}
                      onChange={(v) => set(p, { area: v })} title="The part of his game it works on" />
                    <Dropdown<ProgrammeArea | 'none'> size="sm" value={choice.second === choice.area ? 'none' : choice.second} searchable={false}
                      options={[{ value: 'none' as const, label: 'No second area' }, ...AREA_OPTIONS.filter((o) => o.value !== choice.area).map((o) => ({ value: o.value, label: `+ ${o.label} (30%)` }))]}
                      onChange={(v) => set(p, { second: v })} title="A second area for three steps in ten — 70/30" />
                    <Dropdown<ProgrammeIntensity> size="sm" value={choice.intensity} options={INTENSITY_OPTIONS} searchable={false}
                      onChange={(v) => set(p, { intensity: v })}
                      title="Intensive: more comes of it — and more tiredness, and more risk of a knock" />
                    <span className="acx-cost">{money(cost)}</span>
                    <button className="sm primary" disabled={block !== null} title={block ?? 'Start the twelve weeks'}
                      onClick={() => g.startProgramme(p, choice.area, choice.intensity, choice.second === 'none' || choice.second === choice.area ? undefined : choice.second)}>
                      Start
                    </button>
                    {block !== null && <span className="faint acx-why">{block}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="acx-foot faint">
        {`Up to ${MAX_PROGRAMMES} at a time, one per prospect a season, ${PROGRAMME_DAYS} days each. Intensive works him harder: more comes of it, ` +
          "and more tiredness, and a little more risk of a knock. Paid from the club's balance when it starts; a training report comes to the inbox every four weeks."}
      </p>
    </Card>
  );
}

// ---- Recruitment ----------------------------------------------------------------------

const SCOPE_OPTIONS = (['national', 'continental', 'world'] as const).map((s) => ({ value: s, label: SCOPE_NAMES[s] }));
const POSITION_OPTIONS = [{ value: -1, label: 'Any' }, ...POSITIONS.map((p) => ({ value: p as number, label: POSITION_NAMES[p] }))];

export function AcademyRecruitment(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const state = g.academyState();
  const [scope, setScope] = useState<SearchScope>('national');
  const [position, setPosition] = useState(-1);
  const block = g.searchBlock(scope);
  const search = state?.search;
  const found = state?.candidates ?? [];

  return (
    <div className="acx-split">
      <Card title="Youth Search" icon="scouting" className="academy-card acx-card"
        actions={<Funds extra={`${state?.searches ?? 0}/${MAX_SEARCHES} this season`} />}>
        <p className="acx-lead">
          {`Pay the scouts to look at other clubs' academies, and at youngsters with no club. The report takes ${Math.round(SEARCH_DAYS / 7)} weeks and may find nobody.`}
        </p>
        <div className="acx-search">
          <label className="acx-field"><span className="faint">Reach</span>
            <Dropdown<SearchScope> size="sm" value={scope} options={SCOPE_OPTIONS} searchable={false} onChange={setScope} />
          </label>
          <label className="acx-field"><span className="faint">Position</span>
            <Dropdown<number> size="sm" value={position} options={POSITION_OPTIONS} searchable={false} onChange={setPosition} />
          </label>
          <span className="acx-field"><span className="faint">Cost</span><b className="acx-cost">{money(g.searchCost(scope))}</b></span>
          <button className="sm primary" disabled={block !== null} title={block ?? 'Send the scouts out'} onClick={() => g.startSearch(scope, position)}>
            <Icon name="scouting" size={13} /> Fund search
          </button>
        </div>
        {block !== null && search === undefined && <p className="faint acx-why">{block}</p>}
        {search !== undefined && (
          <div className="acx-running">
            <span><b>Search under way</b> · {SCOPE_NAMES[search.scope]} · {search.position >= 0 ? POSITION_NAMES[search.position as Position] : 'any position'}</span>
            <Progress value={world.day - search.startDay} max={SEARCH_DAYS} />
            <span className="faint">{`${Math.max(0, search.endDay - world.day)} days left`}</span>
          </div>
        )}
        <p className="acx-foot faint">
          {`${MAX_SEARCHES} searches a season, one at a time. Finding a player is not signing him: that is a fee of its own. ` +
            "The potential is the scouts' guess — the better your scouts, the closer it is."}
        </p>
      </Card>

      <Card title="Found by the Scouts" icon="youth" flush className="academy-card acx-card">
        {found.length === 0 ? <Empty>Nobody on the list. A search's finds wait here for four weeks.</Empty> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th />
                  <th>Name</th>
                  <th>Pos</th>
                  <th className="num">Age</th>
                  <th>Nat</th>
                  <th>Club</th>
                  <th>Potential (guess)</th>
                  <th className="num">Fee</th>
                  <th className="num">Waits</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {found.map((c) => {
                  const p = c.playerIdx;
                  const why = g.signBlock(c);
                  return (
                    <tr key={p} className="clickable" onClick={() => g.select(p)}>
                      <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                      <td className="strong">{store.fullName(p)}</td>
                      <td><Pos pos={store.position[p] as Position} /></td>
                      <td className="num">{store.ageOn(p, world.year, 181)}</td>
                      <td><Flag nation={store.nation[p]} /></td>
                      <td>{c.fromClubId >= 0 ? <ClubLink id={c.fromClubId} /> : <span className="faint">No club</span>}</td>
                      <td><span className="ability-cell"><StarMeter value={(c.low + c.high) / 2} size={11} /> {c.low}–{c.high}</span></td>
                      <td className="num">{money(c.fee)}</td>
                      <td className="num">{Math.max(0, c.expiresOn - world.day)}d</td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <span className="academy-actions">
                          <button className="sm primary" disabled={why !== null} title={why ?? 'Sign him for the academy'} onClick={() => g.signCandidate(p)}>Sign</button>
                          <button className="sm" onClick={() => g.dismissCandidate(p)} title="Take him off the list">Dismiss</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---- Facilities -----------------------------------------------------------------------

/** "about a month's work", "about 6 months' work". */
function monthsWork(days: number): string {
  const m = Math.max(1, Math.round(days / 30));
  return m === 1 ? "about a month's work" : `about ${m} months' work`;
}

export function AcademyFacilities(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const project = club.facilityProject;
  const [confirm, setConfirm] = useState<FacilityKind | null>(null);
  const kinds: FacilityKind[] = ['youth', 'recruitment'];
  return (
    <Card title="Academy Facilities" icon="club" className="academy-card acx-card"
      actions={<Funds extra={`board confidence ${Math.round(club.boardConfidence)}%`} />}>
      <p className="acx-lead">
        Better youth facilities bring the academy's players on; a wider recruitment reach brings better ones in each summer. Both need the board's
        approval, a building job and upkeep — and the board builds one thing at a time, across the whole club.
      </p>
      <div className="acx-facilities">
        {kinds.map((kind) => {
          const level = facilityLevel(club, kind);
          const block = g.upgradeBlock(kind);
          const mine = project?.kind === kind;
          return (
            <div key={kind} className="acx-facility">
              <div className="acx-fac-head"><b>{FACILITY_NAMES[kind]}</b><span className="acx-level">{level}<span className="faint">/20</span></span></div>
              <Bar value={level} max={20} wide />
              <p className="faint">{FACILITY_EFFECTS[kind]}</p>
              {level < 20 && <p>{`Next level: ${level + 1}/20 · ${money(upgradeCost(club, kind))} · ${monthsWork(buildDays(club, kind))}`}</p>}
              {mine && project !== undefined && (
                <p className="acx-status pos">{project.stage === 'asked' ? `With the board — answer by ${g.dateLabelForDay(project.until)}` : `Being built — done ${g.dateLabelForDay(project.until)}`}</p>
              )}
              <div className="acx-fac-foot">
                <button className="sm" disabled={block !== null} title={block ?? 'Ask the board to pay for it'} onClick={() => setConfirm(kind)}>
                  <Icon name="board" size={13} /> Ask the board
                </button>
                {block !== null && !mine && <span className="faint acx-why">{block}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {confirm !== null && (
        <div className="acx-confirm">
          <b>To confirm</b>
          <span>{`${FACILITY_NAMES[confirm]} · ${money(upgradeCost(club, confirm))} · paid only once the board approves it.`}</span>
          <span className="academy-actions">
            <button className="sm primary" onClick={() => { g.requestUpgrade(confirm); setConfirm(null); }}>Confirm</button>
            <button className="sm" onClick={() => setConfirm(null)}>Cancel</button>
          </span>
        </div>
      )}
    </Card>
  );
}
