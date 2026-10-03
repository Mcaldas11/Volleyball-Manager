/**
 * Training, the way Setter lays it out: the week plan — seven days around the
 * matches, the week's focus and intensity, what each day costs and gives —
 * with the next match, its preparation and the squad's readiness beside it;
 * and each player's own programme, set by hand or left to the assistant.
 */

import { useState, type JSX } from 'react';
import type { Position } from '../../engine/model/positions.ts';
import {
  assistantFocus, dayLoad, FOCUS_LABELS, individualOf, INTENSITY, planOf, PLAYER_LOAD, prepCoverage, PREP_AREAS,
  SESSIONS, squadReadiness, weekPlan, weekSettings, weekStartOf,
  type IndividualFocus, type Intensity, type PlannedDay, type PlayerLoad, type PrepArea, type SessionType, type WeeklyFocus,
} from '../../engine/world/training.ts';
import { abilityClass, Bar, ClubCrest, Empty, PlayerFace, Pos, Segmented, StarMeter } from '../components.tsx';
import { Dropdown } from '../dropdown.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

const FOCUS_OPTIONS: ReadonlyArray<readonly [WeeklyFocus, string]> = [
  ['auto', 'Automatic'], ['physical', 'Physical'], ['technical', 'Technical'], ['tactical', 'Tactical'], ['balanced', 'Balanced'],
];
const INTENSITY_OPTIONS: ReadonlyArray<readonly [Intensity, string]> = [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']];
const SESSION_CHOICES: readonly SessionType[] = ['rest', 'recovery', 'physical', 'technical', 'tactical', 'balanced', 'preparation'];
const LOADS: readonly PlayerLoad[] = ['rest', 'reduced', 'normal', 'extra'];
const PREP_SHORT: Readonly<Record<PrepArea, string>> = { reception: 'Reception', transition: 'Transition', block: 'Block' };
const FOCUSES: readonly IndividualFocus[] = ['auto', 'serving', 'reception', 'attacking', 'blocking', 'setting', 'defence', 'physical', 'mental'];

/** The colour a session is written in on the plan. */
function sessionTone(s: SessionType): string {
  if (s === 'rest' || s === 'recovery') return 'rest';
  if (s === 'match') return 'match';
  if (s === 'preparation') return 'prep';
  return 'train';
}

export function TrainingScreen(): JSX.Element {
  const [tab, setTab] = useState<'week' | 'individual'>('week');
  return (
    <div className="tr">
      <div className="tr-tabs" role="tablist">
        <button role="tab" className={`hdr-tab${tab === 'week' ? ' active' : ''}`} onClick={() => setTab('week')}>Week plan</button>
        <button role="tab" className={`hdr-tab${tab === 'individual' ? ' active' : ''}`} onClick={() => setTab('individual')}>Individual training</button>
      </div>
      {tab === 'week' ? <WeekPlan /> : <IndividualTraining />}
    </div>
  );
}

// ---- The week plan ---------------------------------------------------------------------

function WeekPlan(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const plan = planOf(club);
  const [monday, setMonday] = useState(() => weekStartOf(world, world.day));
  const days = weekPlan(world, club, monday);
  const settings = weekSettings(plan, monday);
  const date = (day: number): Date | null => g.calendarDate(day);
  const long = (day: number): string => date(day)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) ?? '';
  const setWeek = (patch: Partial<{ focus: WeeklyFocus; intensity: Intensity }>): void => {
    plan.weeks[monday] = { ...settings, ...patch };
    g.touch();
  };
  const training = days.filter((d) => SESSIONS[d.session].dev >= 0.85).length;
  const matches = days.filter((d) => d.session === 'match').length;
  const recovery = days.filter((d) => d.session === 'rest' || d.session === 'recovery').length;
  const thisWeek = weekStartOf(world, world.day);

  return (
    <div className="tr-layout">
      <section className="card tr-week">
        <header className="tr-week-head">
          <button className="icon-btn" disabled={monday <= thisWeek} onClick={() => setMonday(monday - 7)} title="Previous week">
            <Icon name="chevronLeft" size={16} />
          </button>
          <div className="tr-week-title">
            <h2>Week plan</h2>
            <span className="faint">{long(monday)} to {long(monday + 6)}</span>
          </div>
          <button className="icon-btn" onClick={() => setMonday(monday + 7)} title="Next week"><Icon name="chevronRight" size={16} /></button>
          <span className="flex-spacer" />
          <label className="tr-field">
            <span>Weekly focus</span>
            <Dropdown size="sm" value={settings.focus} onChange={(v) => setWeek({ focus: v })} options={FOCUS_OPTIONS.map(([value, label]) => ({ value, label }))} />
          </label>
          <label className="tr-field">
            <span>Weekly intensity</span>
            <Dropdown size="sm" value={settings.intensity} onChange={(v) => setWeek({ intensity: v })} options={INTENSITY_OPTIONS.map(([value, label]) => ({ value, label }))} />
          </label>
          <span className="tr-saved"><Icon name="check" size={13} /> All changes saved</span>
        </header>
        <p className="tr-note">
          These settings apply to this week and the ones after it until you change them; days you set by hand keep
          your choice. Every week keeps at least one day of rest.
        </p>

        <div className="tr-days">
          {days.map((d, i) => <DayCard key={d.day} d={d} weekday={i} past={d.day < world.day} today={d.day === world.day} />)}
        </div>

        <div className="tr-profile-head">
          <span className="tr-label">Week load profile</span>
          <span className="faint">
            {training} training day{training === 1 ? '' : 's'}, {matches} match{matches === 1 ? '' : 'es'}, {recovery} recovery day{recovery === 1 ? '' : 's'}.
            {' '}100% is a normal day at normal intensity; each player's own load is applied after.
          </span>
        </div>
        <div className="tr-profile">
          {days.map((d) => {
            const l = dayLoad(d);
            if (d.session === 'match') return <div key={d.day} className="tr-profile-day"><b className="tr-tag match">Match</b></div>;
            if (d.session === 'rest' || d.session === 'recovery') {
              return <div key={d.day} className="tr-profile-day"><b className="tr-tag rest">Recovery</b></div>;
            }
            return (
              <div key={d.day} className="tr-profile-day">
                <span className="tr-meter-label">Development</span>
                <b className="dev">{Math.round(l.dev * 100)}%</b>
                <span className="tr-meter"><i className="dev" style={{ width: `${Math.min(100, l.dev * 80)}%` }} /></span>
                <span className="tr-meter-label">Fatigue and injury</span>
                <b className="load">{Math.round(l.load * 100)}%</b>
                <span className="tr-meter"><i className="load" style={{ width: `${Math.min(100, l.load * 70)}%` }} /></span>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="tr-side">
        <NextMatchCard />
        <ReadinessCard />
      </aside>
    </div>
  );
}

function DayCard({ d, weekday, past, today }: { d: PlannedDay; weekday: number; past: boolean; today: boolean }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const plan = planOf(club);
  const date = g.calendarDate(d.day);
  const opp = d.fixture !== undefined ? world.clubs[d.fixture.home === club.id ? d.fixture.away : d.fixture.home] : undefined;
  const tone = sessionTone(d.session);
  const training = SESSIONS[d.session].dev >= 0.85;
  return (
    <div className={`tr-day ${tone}${past ? ' past' : ''}${today ? ' today' : ''}`}>
      <div className="tr-day-head">
        <span>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekday]}</span>
        <b>{date?.getUTCDate()}</b>
      </div>
      <strong className={`tr-session ${tone}`}>{SESSIONS[d.session].label}</strong>
      {training && <span className="tr-day-sub">Intensity: {INTENSITY[d.intensity].label}</span>}
      {d.session === 'match' && opp !== undefined && (
        <div className="tr-day-match" onClick={() => g.selectClub(opp.id)}>
          <ClubCrest club={opp} size={34} />
          <b>{opp.name}</b>
          <span>{d.fixture!.home === club.id ? 'Home' : 'Away'} match</span>
        </div>
      )}
      {d.session === 'preparation' && (
        <div className="tr-day-prep">
          <span className="tr-day-sub">Works on</span>
          <Dropdown<PrepArea>
            size="sm"
            disabled={past}
            value={d.prep ?? 'reception'}
            onChange={(v) => { plan.prep[d.day] = v; g.touch(); }}
            options={PREP_AREAS.map(([value, label]) => ({ value, label: PREP_SHORT[value], hint: label }))}
          />
        </div>
      )}
      <span className="flex-spacer" />
      {d.session === 'match'
        ? <span className="tr-day-foot">Automatic</span>
        : (
          <Dropdown<SessionType | 'auto'>
            size="sm"
            className="tr-day-pick"
            disabled={past}
            value={d.manual ? d.session : 'auto'}
            onChange={(v) => {
              if (v === 'auto') delete plan.days[d.day];
              else plan.days[d.day] = v;
              g.touch();
            }}
            options={[
              { value: 'auto' as const, label: 'Auto', hint: 'as planned' },
              ...SESSION_CHOICES.map((s) => ({ value: s, label: SESSIONS[s].label })),
            ]}
          />
        )}
    </div>
  );
}

function NextMatchCard(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const next = g.nextFixture();
  const opp = next !== null ? world.clubs[next.home === club.id ? next.away : next.home] : undefined;
  const cover = next !== null ? prepCoverage(world, club, next.day) : null;
  return (
    <>
      <section className="card tr-next">
        <span className="tr-label">Next match</span>
        {next === null || opp === undefined ? <Empty>No match scheduled.</Empty> : (
          <div className="tr-next-body" onClick={() => g.selectClub(opp.id)}>
            <ClubCrest club={opp} size={54} />
            <div>
              <b>{opp.name}</b>
              <span>{g.longDateLabel(next.day)}</span>
              <span className="gold-text">{next.home === club.id ? 'Home' : 'Away'} · {world.competitions[next.competitionId]?.name ?? ''}</span>
            </div>
          </div>
        )}
      </section>
      <section className="card tr-card">
        <span className="tr-label">Match preparation</span>
        {PREP_AREAS.map(([area, label]) => {
          const v = cover?.[area] ?? 0;
          return (
            <div key={area} className="tr-prep-row">
              <div className="tr-prep-line">
                <span>{label}</span>
                <b className={v >= 1 ? 'good' : v > 0 ? 'warn' : 'bad'}>{v >= 1 ? 'Covered' : v > 0 ? 'Partly covered' : 'Not covered'}</b>
              </div>
              <span className="tr-meter"><i className={v >= 1 ? 'dev' : 'load'} style={{ width: `${Math.max(3, v * 100)}%` }} /></span>
            </div>
          );
        })}
        <p className="tr-hint">The day before a match prepares for it — set what it works on in the plan.</p>
      </section>
    </>
  );
}

function ReadinessCard(): JSX.Element {
  const g = useGame();
  const r = squadReadiness(g.world!, g.club!);
  return (
    <section className="card tr-card">
      <span className="tr-label">Squad readiness</span>
      <div className="tr-ready"><span>Players on reduced load or rest</span><b className={r.lighter > 0 ? 'warn' : 'good'}>{r.lighter}</b></div>
      <div className="tr-ready"><span>Players in rehabilitation</span><b className={r.injured > 0 ? 'bad' : 'good'}>{r.injured}</b></div>
      <div className="tr-ready"><span>Players at high injury risk</span><b className={r.atRisk > 0 ? 'bad' : 'good'}>{r.atRisk}</b></div>
    </section>
  );
}

// ---- Individual training -------------------------------------------------------------

function IndividualTraining(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const plan = planOf(club);
  const squad = g.squad();
  const assistant = plan.assistantIndividual;
  const set = (p: number, patch: Partial<{ focus: IndividualFocus; load: PlayerLoad }>): void => {
    const now = individualOf(world, club, p);
    plan.individual[p] = { focus: now.focus, load: now.load, ...patch };
    g.touch();
  };
  const start = g.ctx.seasonStartAbility;

  return (
    <section className="card tr-individual">
      <header className="tr-ind-head">
        <div>
          <h2>Individual training</h2>
          <span className="faint">
            {assistant
              ? 'Your assistant sets each player to work on the weakest part of his game, and eases off anyone tired or coming back from injury.'
              : 'You set what each player works on and how hard. Players you leave alone follow the assistant.'}
          </span>
        </div>
        <span className="flex-spacer" />
        <span className="tr-label">Run by</span>
        <Segmented<'me' | 'assistant'>
          size="sm"
          options={[['me', 'Me'], ['assistant', 'Assistant']]}
          value={assistant ? 'assistant' : 'me'}
          onChange={(v) => {
            if (v === 'me' && plan.assistantIndividual) {
              // Start from what the assistant had set, so nothing changes until he does.
              for (const p of squad) plan.individual[p] ??= { focus: assistantFocus(world, p), load: individualOf(world, club, p).load };
            }
            plan.assistantIndividual = v === 'assistant';
            g.touch();
          }}
        />
      </header>
      <div className="table-wrap">
        <table className="data-table tr-table">
          <thead>
            <tr>
              <th />
              <th>Player</th>
              <th>Pos</th>
              <th className="num">Age</th>
              <th>Condition</th>
              <th>Focus</th>
              <th>Load</th>
              <th>Ability</th>
              <th className="num" title="Ability gained this season">Season</th>
            </tr>
          </thead>
          <tbody>
            {squad.map((p) => {
              const ind = individualOf(world, club, p);
              const ca = store.currentAbility[p];
              const gained = ca - (start.get(p) ?? ca);
              const injured = store.injuryDaysLeft[p] > 0;
              return (
                <tr key={p}>
                  <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                  <td className="strong"><span className="player-link" onClick={() => g.select(p)}>{store.fullName(p)}</span>{injured && <span className="role-tag leaving">Injured</span>}</td>
                  <td><Pos pos={store.position[p] as Position} /></td>
                  <td className="num">{store.ageOn(p, world.year, 181)}</td>
                  <td><span className="cond-cell"><Bar value={store.condition[p]} /><span className="dim">{Math.round(store.condition[p])}%</span></span></td>
                  <td>
                    <Dropdown<IndividualFocus>
                      size="sm"
                      className="tr-pick"
                      disabled={assistant}
                      value={ind.focus}
                      onChange={(v) => set(p, { focus: v })}
                      options={FOCUSES.map((f) => ({ value: f, label: FOCUS_LABELS[f] }))}
                    />
                  </td>
                  <td>
                    <Dropdown<PlayerLoad>
                      size="sm"
                      className="tr-pick"
                      disabled={assistant}
                      value={ind.load}
                      onChange={(v) => set(p, { load: v })}
                      options={LOADS.map((l) => ({ value: l, label: PLAYER_LOAD[l].label }))}
                    />
                  </td>
                  <td>
                    <span className="ability-cell">
                      <StarMeter value={ca} size={11} />
                      <span className={abilityClass(ca)}>{ca}</span>
                    </span>
                  </td>
                  <td className={`num ${gained > 0 ? 'good' : gained < 0 ? 'bad' : 'dim'}`}>{gained > 0 ? `+${gained}` : gained}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
