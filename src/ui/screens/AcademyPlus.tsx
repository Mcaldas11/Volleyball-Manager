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
import {
  FOCUS_LABELS, individualOf, planOf, PLAYER_LOAD, type IndividualFocus, type Intensity, type PlayerLoad, type WeeklyFocus,
} from '../../engine/world/training.ts';
import { CAREER_PATHS, PATH_NAMES, type CareerPath } from '../../engine/world/academyPlans.ts';
import { seniorsEligible } from '../../engine/world/under21.ts';
import { compareTableRows, type Club } from '../../engine/model/club.ts';
import { Position, POSITION_NAMES, POSITIONS } from '../../engine/model/positions.ts';
import { abilityClass, Bar, Card, ClubLink, Empty, Flag, money, PlayerFace, PlayerLink, Pos, Segmented, StarMeter } from '../components.tsx';
import { Dropdown } from '../dropdown.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { sideSuffix } from '../../engine/world/sides.ts';
import { nationName as nationNameOf } from '../../engine/world/internationals.ts';
import {
  clubYouthInternationals, MAX_RECOMMENDATIONS, recommendationsUsed, recommendBlock, YOUTH_STATUS_LABEL,
} from '../../engine/world/youthNational.ts';

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
                      onChange={(v) => set(p, { second: v })} title="A second area for three steps in ten, 70/30" />
                    <Dropdown<ProgrammeIntensity> size="sm" value={choice.intensity} options={INTENSITY_OPTIONS} searchable={false}
                      onChange={(v) => set(p, { intensity: v })}
                      title="Intensive: more comes of it, and more tiredness, and more risk of a knock" />
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
            "The potential is the scouts' guess, the better your scouts, the closer it is."}
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
        approval, a building job and upkeep, and the board builds one thing at a time, across the whole club.
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
                <p className="acx-status pos">{project.stage === 'asked' ? `With the board, answer by ${g.dateLabelForDay(project.until)}` : `Being built, done ${g.dateLabelForDay(project.until)}`}</p>
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

// ---- Career plans ---------------------------------------------------------------------

const PATH_OPTIONS = [{ value: 'none' as const, label: 'No plan' }, ...CAREER_PATHS.map((p) => ({ value: p, label: PATH_NAMES[p] }))];

/**
 * Each prospect's path: the head of youth's advice, the plan the club sets
 * him on (which the head of youth then carries out), his mentor, and what the
 * plan has brought so far.
 */
export function AcademyPlans(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const youth = g.youthSquad();
  return (
    <Card title="Career Plans" icon="career" flush className="academy-card acx-card"
      actions={<span className="faint">the head of youth sees each plan through, and reports once a month</span>}>
      <p className="acx-lead">
        Set each prospect on a path. On a loan path he goes out when a window opens and a club will play him; on the promotion
        path he comes up the day he is as good as the squad's bench. A veteran of 28 or over can mentor him.
      </p>
      {youth.length === 0 ? <Empty>No prospects in the academy.</Empty> : (
        <div className="table-wrap">
          <table className="data-table acx-plans">
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th className="num">Age</th>
                <th className="num">Ability</th>
                <th className="num" title="U19 minutes, 0-100">Minutes</th>
                <th>Head of youth's advice</th>
                <th>Plan</th>
                <th>Mentor</th>
                <th className="num" title="Ability since the plan began">Since</th>
              </tr>
            </thead>
            <tbody>
              {youth.map((p) => {
                const plan = g.careerPlan(p);
                const advice = g.careerAdvice(p);
                const mentor = g.mentorOf(p);
                const candidates = g.mentorCandidates(p);
                const gain = plan !== undefined ? store.currentAbility[p] - plan.startAbility : null;
                const age = store.ageOn(p, world.year, 181);
                return (
                  <tr key={p}>
                    <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                    <td className="strong"><PlayerLink idx={p} /></td>
                    <td className="num">{age}</td>
                    <td className={`num ${abilityClass(store.currentAbility[p])}`}>{store.currentAbility[p]}</td>
                    <td className="num">{store.playingTime[p]}</td>
                    <td>
                      {advice !== null && (
                        <span className="acx-advice" title={advice.reason}>
                          <b>{PATH_NAMES[advice.path]}</b>
                          <span className="faint">{advice.reason}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      <Dropdown<CareerPath | 'none'> size="sm" value={plan?.path ?? 'none'} options={PATH_OPTIONS} searchable={false}
                        onChange={(v) => g.setCareerPlan(p, v === 'none' ? null : v)} title="The path the club sets him on" />
                    </td>
                    <td>
                      {age > 23 ? <span className="faint">—</span> : (
                        <Dropdown<number> size="sm" value={mentor ?? -1} searchable={false} title="A veteran of 28 or over takes him under his wing"
                          options={[{ value: -1, label: 'No mentor' }, ...(mentor !== null && !candidates.includes(mentor) ? [mentor] : []).concat(candidates).map((m) => ({ value: m, label: store.shortName(m) }))]}
                          onChange={(m) => g.setMentor(p, m < 0 ? null : m)} />
                      )}
                    </td>
                    <td className="num">{gain === null ? <span className="dim">—</span> : <span className={gain > 0 ? 'pos' : gain < 0 ? 'neg' : ''}>{gain > 0 ? '+' : ''}{gain}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---- Internationals ----------------------------------------------------------------------

type IntlFilter = 'all' | 'capped' | 'contention';

/**
 * The club's young players and their countries' youth sides: who is away with
 * the U19s or U21s, who was in the last squad, where each stands with the
 * youth coach, their caps — and the head of youth's pick to put forward.
 */
export function AcademyInternationals(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const club = g.club!;
  const [filter, setFilter] = useState<IntlFilter>('all');
  const young = [...club.youthPlayers, ...club.players.filter((p) => store.ageOn(p, world.year, 181) <= 21)];
  const lines = clubYouthInternationals(world, young)
    .sort((a, b) => (a.order || 9999) - (b.order || 9999));
  const shown = lines.filter((l) => filter === 'all' || (filter === 'capped' ? l.u19 + l.u21 > 0 : l.status !== 'outside' && l.status !== 'watched'));
  const capped = lines.filter((l) => l.u19 + l.u21 > 0).length;
  const away = lines.filter((l) => l.status === 'away').length;
  const left = MAX_RECOMMENDATIONS - recommendationsUsed(world);
  // The head of youth's pick: the best of those not yet in the picture, close enough to be worth a word.
  const advice = lines.find((l) => !l.recommended && l.status !== 'away' && l.status !== 'named' && l.order > 0 && l.order <= 45);
  return (
    <Card title="Youth Internationals" icon="world" flush className="academy-card acx-card"
      actions={<span className="acx-funds"><span className="faint">Capped</span> <b>{capped}</b><span className="acx-dot">·</span>
        <span className="faint">Away now</span> <b>{away}</b><span className="acx-dot">·</span>
        <span className="faint">Recommendations left</span> <b>{left}/{MAX_RECOMMENDATIONS}</b></span>}>
      <div className="acx-intl-head">
        <p className="acx-lead">
          The U19s play their championship late in July, the U21s in mid-August, players called up are away until their side goes out.
          {advice !== undefined && <> Head of youth: <b>{store.shortName(advice.p)}</b> is {ordinalLabel(advice.order)} in the {nationNameOf(advice.side)} coach's thinking, a word could get him in.</>}
        </p>
        <Segmented<IntlFilter> size="sm" options={[['all', 'All'], ['contention', 'In the picture'], ['capped', 'Capped']]} value={filter} onChange={setFilter} />
      </div>
      {shown.length === 0 ? <Empty>No young players {filter === 'capped' ? 'with youth caps' : filter === 'contention' ? 'in their youth side\'s picture' : 'at the club'}.</Empty> : (
        <div className="table-wrap">
          <table className="data-table acx-intl">
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th className="num">Age</th>
                <th>Pos</th>
                <th className="num">Ability</th>
                <th title="His country's youth side">Side</th>
                <th className="num" title="His place in the youth coach's pecking order">Order</th>
                <th>Status</th>
                <th className="num">U19</th>
                <th className="num">U21</th>
                <th className="num" title="Senior caps">Caps</th>
                <th title="His side's next tournament">Next</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const block = g.world !== null ? recommendBlock(world, l.p) : null;
                return (
                  <tr key={l.p} className={l.status === 'away' ? 'acx-away' : ''}>
                    <td className="face-cell"><PlayerFace playerId={store.id[l.p]} name={store.fullName(l.p)} size={28} /></td>
                    <td className="strong"><PlayerLink idx={l.p} />{club.youthPlayers.includes(l.p) && <span className="faint acx-tag">academy</span>}</td>
                    <td className="num">{store.ageOn(l.p, world.year, 181)}</td>
                    <td><Pos pos={store.position[l.p] as Position} /></td>
                    <td className={`num ${abilityClass(store.currentAbility[l.p])}`}>{store.currentAbility[l.p]}</td>
                    <td title={nationNameOf(l.side)}><span className="name-cell"><Flag nation={l.side} /> {sideSuffix(l.side)}</span></td>
                    <td className="num">{l.order > 0 ? `#${l.order}` : '—'}</td>
                    <td className={`acx-status ${l.status}`}>{YOUTH_STATUS_LABEL[l.status]}{l.senior ? ' · seniors' : ''}</td>
                    <td className="num">{l.u19 || <span className="dim">0</span>}</td>
                    <td className="num">{l.u21 || <span className="dim">0</span>}</td>
                    <td className="num">{l.seniorCaps || <span className="dim">0</span>}</td>
                    <td className="faint" title={l.next?.name}>{l.next !== undefined ? g.dateLabelForDay(l.next.startDay) : '—'}</td>
                    <td className="num">
                      {l.recommended
                        ? <span className="pos"><Icon name="check" size={12} /> Put forward</span>
                        : <button className="sm" disabled={block !== null} title={block ?? `Put him forward to the ${nationNameOf(l.side)} coach`}
                          onClick={() => g.recommendToYouthSide(l.p)}>Recommend</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ordinalLabel(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

// ---- Training -------------------------------------------------------------------------

const YOUTH_FOCUS: ReadonlyArray<readonly [WeeklyFocus, string]> = [
  ['auto', 'With the first team'], ['physical', 'Physical'], ['technical', 'Technical'], ['tactical', 'Tactical'], ['balanced', 'Balanced'],
];
const YOUTH_INTENSITY: ReadonlyArray<readonly [Intensity, string]> = [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']];
const FOCUS_OPTIONS = (Object.keys(FOCUS_LABELS) as IndividualFocus[]).map((f) => ({ value: f, label: FOCUS_LABELS[f] }));
const LOAD_OPTIONS = (Object.keys(PLAYER_LOAD) as PlayerLoad[]).map((l) => ({ value: l, label: PLAYER_LOAD[l].label }));

/** The academy's own training: the week's focus and how hard, and what each prospect works on. */
export function AcademyTraining(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const plan = planOf(club);
  const youth = g.youthSquad();
  const set = plan.youth ?? { focus: 'auto' as WeeklyFocus, intensity: 'normal' as Intensity };
  const byAssistant = world.delegation?.training === 'assistant';
  const setWeek = (patch: Partial<{ focus: WeeklyFocus; intensity: Intensity }>): void => {
    plan.youth = { ...set, ...patch };
    g.touch();
  };
  const setOwn = (p: number, patch: Partial<{ focus: IndividualFocus; load: PlayerLoad }>): void => {
    const now = individualOf(world, club, p);
    plan.individual[p] = { focus: now.focus, load: now.load, ...patch };
    g.touch();
  };
  return (
    <Card title="Academy Training" icon="training" flush className="academy-card acx-card"
      actions={<span className="faint">{youth.length} prospects</span>}>
      <p className="acx-lead">
        {byAssistant
          ? 'Your assistant runs the training, the academy\'s with the first team\'s. Take it back on the Training screen to set it here.'
          : 'The academy can train apart from the first team: its own focus and its own intensity, every week. Harder weeks bring them on faster and tire them more.'}
      </p>
      <div className="acx-train-week">
        <label><span className="faint">Weekly focus</span>
          <Segmented<WeeklyFocus> size="sm" options={YOUTH_FOCUS} value={set.focus} onChange={(v) => { if (!byAssistant) setWeek({ focus: v }); }} />
        </label>
        <label><span className="faint">Intensity</span>
          <Segmented<Intensity> size="sm" options={YOUTH_INTENSITY} value={set.intensity}
            onChange={(v) => { if (!byAssistant && set.focus !== 'auto') setWeek({ intensity: v }); }} />
        </label>
      </div>
      {youth.length === 0 ? <Empty>No players in the academy.</Empty> : (
        <div className="table-wrap">
          <table className="data-table acx-training">
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th>Pos</th>
                <th className="num">Age</th>
                <th className="num">Ability</th>
                <th className="num">Potential</th>
                <th>Works on</th>
                <th>Load</th>
              </tr>
            </thead>
            <tbody>
              {youth.map((p) => {
                const own = individualOf(world, club, p);
                return (
                  <tr key={p}>
                    <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                    <td className="strong"><PlayerLink idx={p} /></td>
                    <td><Pos pos={store.position[p] as Position} /></td>
                    <td className="num">{store.ageOn(p, world.year, 181)}</td>
                    <td className={`num ${abilityClass(store.currentAbility[p])}`}>{store.currentAbility[p]}</td>
                    <td className="num"><StarMeter value={store.potentialAbility[p]} size={11} /></td>
                    <td><Dropdown<IndividualFocus> size="sm" value={own.focus} options={FOCUS_OPTIONS} searchable={false}
                      onChange={(v) => setOwn(p, { focus: v })} /></td>
                    <td><Dropdown<PlayerLoad> size="sm" value={own.load} options={LOAD_OPTIONS} searchable={false}
                      onChange={(v) => setOwn(p, { load: v })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---- The under-21 side ------------------------------------------------------------------

/** The club's under-21 side: its squad, called up from here, and the first team's young players, sent to it. */
export function AcademyUnder21(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const coached = g.managedSide();
  if (coached !== null) return <CoachingUnder21 senior={coached.senior} />;
  const side = g.under21Side();
  if (side === undefined) return <Card title="U21 Side" icon="youth" className="academy-card acx-card"><Empty>The club has no under-21 side.</Empty></Card>;
  const league = world.competitions[side.leagueId];
  const table = league !== undefined ? [...league.table].sort(compareTableRows) : [];
  const place = table.findIndex((r) => r.clubId === side.id) + 1;
  const next = world.fixtures
    .filter((f) => !f.played && (f.home === side.id || f.away === side.id))
    .sort((a, b) => a.day - b.day)[0];
  const opp = next !== undefined ? world.clubs[next.home === side.id ? next.away : next.home] : undefined;
  const seniors = seniorsEligible(world, club);
  const byAbility = (list: number[]): number[] => [...list].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const row = (p: number, action: JSX.Element): JSX.Element => (
    <tr key={p}>
      <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
      <td className="strong"><PlayerLink idx={p} /></td>
      <td><Pos pos={store.position[p] as Position} /></td>
      <td className="num">{store.ageOn(p, world.year, 181)}</td>
      <td className={`num ${abilityClass(store.currentAbility[p])}`}>{store.currentAbility[p]}</td>
      <td className="num"><StarMeter value={store.potentialAbility[p]} size={11} /></td>
      <td className="num">{action}</td>
    </tr>
  );
  const head = (
    <thead>
      <tr><th /><th>Name</th><th>Pos</th><th className="num">Age</th><th className="num">Ability</th><th className="num">Potential</th><th /></tr>
    </thead>
  );
  return (
    <div className="acx-split acx-u21">
      <Card title={side.name} icon="youth" flush className="academy-card acx-card"
        actions={(
          <span className="faint">
            {league !== undefined && place > 0 ? `${place}${['th', 'st', 'nd', 'rd'][place % 10 > 3 || Math.floor(place / 10) === 1 ? 0 : place % 10]} in ${league.name}` : ''}
            {opp !== undefined && next !== undefined ? ` · next: ${next.home === side.id ? 'vs' : 'at'} ${opp.shortName}, ${g.dateLabelForDay(next.day)}` : ''}
          </span>
        )}>
        <p className="acx-lead">The under-21 side plays its own league, on its own days. Call a player up and he joins the first team: if he is still under 21, he plays for the side on its match days as well.</p>
        {side.players.length === 0 ? <Empty>No players in the under-21 squad.</Empty> : (
          <div className="table-wrap">
            <table className="data-table">
              {head}
              <tbody>{byAbility(side.players).map((p) => row(p, <button className="sm primary" onClick={() => g.callUpFromUnder21(p)}>Call up</button>))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="First Team, Under 21" icon="squad" flush className="academy-card acx-card"
        actions={<span className="faint">{seniors.length} eligible</span>}>
        <p className="acx-lead">Your first-team players young enough for the under-21s. They play for the side on its match days already; send one down for good to give him the minutes there instead of the bench.</p>
        {seniors.length === 0 ? <Empty>No first-team player is under 21.</Empty> : (
          <div className="table-wrap">
            <table className="data-table">
              {head}
              <tbody>{byAbility(seniors).map((p) => row(p, <button className="sm" onClick={() => g.sendToUnder21(p)}>Send to U21</button>))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** As the under-21 side's coach: the senior club's young players, asked for here, and how the club sees you. */
function CoachingUnder21({ senior }: { senior: Club }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const R = world.under21;
  const goodwill = R?.goodwill ?? 60;
  const pending = R?.requests ?? [];
  const young = [...seniorsEligible(world, senior)].sort((a, b) => store.playingTime[a] - store.playingTime[b]);
  const mood = goodwill >= 75 ? 'trusts you' : goodwill >= 50 ? 'is happy with you' : goodwill >= 30 ? 'has doubts about you' : 'is unhappy with you';
  return (
    <div className="acx-split acx-u21">
      <Card title={`${senior.name}, Under 21`} icon="squad" flush className="academy-card acx-card"
        actions={<span className="faint">{young.length} eligible</span>}>
        <p className="acx-lead">The senior club's young players. They play for you on your match days already. Ask for one who is hardly playing up there and he joins your squad for good: the club says yes more readily for a player on the bench, and the better it thinks of you.</p>
        {young.length === 0 ? <Empty>No senior player is under 21.</Empty> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th /><th>Name</th><th>Pos</th><th className="num">Age</th><th className="num">Ability</th><th className="num" title="Playing time, 0-100">Minutes</th><th /></tr>
              </thead>
              <tbody>
                {young.map((p) => (
                  <tr key={p}>
                    <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                    <td className="strong"><PlayerLink idx={p} /></td>
                    <td><Pos pos={store.position[p] as Position} /></td>
                    <td className="num">{store.ageOn(p, world.year, 181)}</td>
                    <td className={`num ${abilityClass(store.currentAbility[p])}`}>{store.currentAbility[p]}</td>
                    <td className="num">{Math.round(store.playingTime[p])}</td>
                    <td className="num"><button className="sm" onClick={() => g.askForSenior(p)}>Ask for him</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="The Senior Club" icon="club" className="academy-card acx-card">
        <p className="acx-lead">{senior.name} {mood}: goodwill {Math.round(goodwill)}/100. It asks for your best players when it needs them; letting them go up raises it, and keeping them lowers it.</p>
        <Bar value={goodwill} max={100} wide />
        <p className="faint" style={{ marginTop: 12 }}>
          {pending.length > 0
            ? `${pending.length} request${pending.length === 1 ? '' : 's'} waiting in your inbox.`
            : 'No request waiting.'}
          {' '}Players sent up this season: {R?.promotedThisSeason ?? 0}. The board judges the season by them as much as by results.
        </p>
        <div className="acx-first-team">
          <p className="faint">Your results here, the players you send up and the club's goodwill count when you ask for the first team, and when its head coach goes.</p>
          <button className="primary" disabled={g.firstTeamAskBlock() !== null} title={g.firstTeamAskBlock() ?? 'Ask the board for the first-team job'}
            onClick={() => g.askForFirstTeamJob()}>
            Ask for the first-team job
          </button>
          {g.firstTeamAskBlock() !== null && <p className="faint acx-why">{g.firstTeamAskBlock()}</p>}
        </div>
      </Card>
    </div>
  );
}
