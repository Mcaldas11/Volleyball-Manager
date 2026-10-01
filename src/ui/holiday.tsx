/**
 * Going on holiday, the way Football Manager does it: the one way to jump
 * the calendar on — to the next match, a week, a date of your choosing —
 * since Continue only ever moves on a day. The dialog takes the return date
 * and the instructions the assistant runs the club by meanwhile; the days
 * away then pass in the processing window (processing.tsx).
 */

import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { DAYS_PER_SEASON, TRANSFER_WINDOWS } from '../engine/world/world.ts';
import {
  DEFAULT_HOLIDAY, holidayDays, JOB_TARGETS, type HolidayPlan, type HolidayReturn, type JobTarget, type OfferPolicy,
} from '../engine/world/holiday.ts';
import { Icon, type IconName } from './icons.tsx';
import { useGame } from './state.ts';

/** A preset return date in the dropdown. */
interface Preset {
  key: string;
  label: string;
  day: number;
}

function isoOf(date: Date | null): string {
  return date === null ? '' : date.toISOString().slice(0, 10);
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="hol-section">
      <h3 className="hol-section-title"><Icon name={icon} size={16} /> {title}</h3>
      <div className="hol-section-body">{children}</div>
    </section>
  );
}

export function HolidayDialog(): JSX.Element | null {
  const g = useGame();
  const world = g.world;
  const dialog = g.holidayDialog;
  if (world === null || dialog === null) return null;
  return <HolidayForm key={`${world.day}:${dialog.returnDay ?? ''}`} preset={dialog.returnDay} />;
}

function HolidayForm({ preset }: { preset: number | null }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club;
  const today = world.day;
  const last = g.holidayPlan;

  // The dates on offer: the next match first, then the usual jumps, the
  // transfer window's next date and the end of the season.
  const next = g.nextFixture();
  const presets: Preset[] = [];
  if (next !== null && next.day > today) {
    const opp = world.clubs[next.home === world.userClubId ? next.away : next.home];
    presets.push({
      key: 'match',
      label: `Next match — ${next.home === world.userClubId ? 'vs' : 'at'} ${opp?.shortName ?? '?'} (${g.dateLabelForDay(next.day)})`,
      day: next.day,
    });
  }
  presets.push({ key: 'tomorrow', label: `Tomorrow (${g.dateLabelForDay(today + 1)})`, day: today + 1 });
  presets.push({ key: 'week', label: `Next week (${g.dateLabelForDay(today + 7)})`, day: today + 7 });
  presets.push({ key: 'fortnight', label: `In two weeks (${g.dateLabelForDay(today + 14)})`, day: today + 14 });
  const month = g.calendarDate(today)?.getUTCMonth();
  let firstOfNext = today + 1;
  while (g.calendarDate(firstOfNext)?.getUTCMonth() === month) firstOfNext++;
  presets.push({ key: 'month', label: `Start of next month (${g.dateLabelForDay(firstOfNext)})`, day: firstOfNext });
  for (let d = today + 1; d < today + DAYS_PER_SEASON; d++) {
    const sd = d % DAYS_PER_SEASON;
    const w = TRANSFER_WINDOWS.find((x) => x.opens === sd || x.closes === sd);
    if (w === undefined) continue;
    const name = w.name === 'summer' ? 'Summer' : 'January';
    presets.push({
      key: 'window',
      label: `${name} transfer window ${w.opens === sd ? 'opens' : 'closes'} (${g.dateLabelForDay(d)})`,
      day: d,
    });
    break;
  }
  // The season rolls over on its 350th day: the last day before is its end.
  const seasonEnd = today - (today % DAYS_PER_SEASON) + 349;
  if (seasonEnd > today) {
    presets.push({ key: 'season', label: `End of the season (${g.dateLabelForDay(seasonEnd)})`, day: seasonEnd });
  }

  const initialKey = preset === null
    ? (presets[0]?.key ?? 'week')
    : presets.find((p) => p.day === preset)?.key ?? 'custom';
  // A date first — the next match — unless last time's choice was otherwise.
  const [mode, setMode] = useState<HolidayReturn['kind']>(
    preset !== null || last === DEFAULT_HOLIDAY ? 'date' : last.until.kind,
  );
  const [presetKey, setPresetKey] = useState(initialKey);
  const [customDay, setCustomDay] = useState(preset ?? today + 7);
  const [days, setDays] = useState(last.until.kind === 'days' ? last.until.days : 7);
  const [jobs, setJobs] = useState<JobTarget | null>(last.jobs);
  const [jobTarget, setJobTarget] = useState<JobTarget>(last.jobs ?? 'any');
  const [offers, setOffers] = useState<OfferPolicy>(last.offers);
  const [onlyListed, setOnlyListed] = useState(last.onlyListed);
  const [useTactics, setUseTactics] = useState(last.useTactics);
  const [useSelection, setUseSelection] = useState(last.useSelection);

  const dateDay = presetKey === 'custom' ? customDay : presets.find((p) => p.key === presetKey)?.day ?? today + 7;
  const back = mode === 'date' ? dateDay : mode === 'days' ? today + Math.max(1, days) : null;

  // A picked date back to a day of the game: the calendar has no leap days,
  // so look for it over the year ahead.
  const pickDate = (iso: string): void => {
    for (let d = today + 1; d <= today + DAYS_PER_SEASON; d++) {
      if (isoOf(g.calendarDate(d)) === iso) {
        setCustomDay(d);
        return;
      }
    }
  };

  // What happens while away: matches the assistant plays, and whether the
  // manager is back in time for one.
  const matches = g.ownFixtures().filter((f) => !f.played && f.day >= today && (back === null || f.day < back));
  const backForMatch = back !== null && g.ownFixtures().some((f) => !f.played && f.day === back);
  const valid = back === null || back > today;

  const confirm = (): void => {
    const until: HolidayReturn = mode === 'date' ? { kind: 'date', day: dateDay }
      : mode === 'days' ? { kind: 'days', days: Math.max(1, days) } : { kind: 'indefinite' };
    const plan: HolidayPlan = {
      until, jobs: jobs === null ? null : jobTarget, offers, onlyListed: offers !== 'reject' && onlyListed,
      useTactics, useSelection,
    };
    void g.goOnHoliday(plan);
  };

  // Escape closes it, like any dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') g.closeHoliday();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const taken = holidayDays(world);
  return (
    <div className="hol-overlay" onClick={() => g.closeHoliday()}>
      <div className="hol-card" role="dialog" aria-label="Holiday options" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs">Overview <Icon name="chevronRight" size={12} /> Calendar <Icon name="chevronRight" size={12} /> <b>Go on holiday</b></span>
          <button className="icon-btn" onClick={() => g.closeHoliday()} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <h2 className="hol-title">Holiday Options</h2>
        <p className="hol-sub">
          Your assistant runs {club?.name ?? 'the club'} while you are away.
          {' '}You have taken {taken} day{taken === 1 ? '' : 's'} of holiday this season.
        </p>

        <div className="hol-body">
          <Section icon="calendar" title="Return Date">
            <label className="hol-row">
              <input type="radio" name="hol-back" checked={mode === 'date'} onChange={() => setMode('date')} />
              <span>Return from holiday on:</span>
              <select value={presetKey} disabled={mode !== 'date'} onChange={(e) => setPresetKey(e.target.value)}>
                {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                <option value="custom">Choose a date…</option>
              </select>
            </label>
            {mode === 'date' && presetKey === 'custom' && (
              <label className="hol-row hol-indent">
                <span>Date:</span>
                <input
                  type="date"
                  value={isoOf(g.calendarDate(customDay))}
                  min={isoOf(g.calendarDate(today + 1))}
                  max={isoOf(g.calendarDate(today + DAYS_PER_SEASON - 1))}
                  onChange={(e) => pickDate(e.target.value)}
                />
              </label>
            )}
            <label className="hol-row">
              <input type="radio" name="hol-back" checked={mode === 'days'} onChange={() => setMode('days')} />
              <span>Return from holiday after:</span>
              <input
                className="hol-days"
                type="number"
                min={1}
                max={365}
                value={days}
                disabled={mode !== 'days'}
                onChange={(e) => setDays(Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 1))))}
              />
              <span className="faint">day(s)</span>
            </label>
            <label className="hol-row">
              <input type="radio" name="hol-back" checked={mode === 'indefinite'} onChange={() => setMode('indefinite')} />
              <span>Go on holiday indefinitely</span>
            </label>
            <p className="hol-note">
              {back === null
                ? 'You will be back when something needs you — a job offer, the board, the end of the season — or when you choose.'
                : `Back on ${g.longDateLabel(back)}.`}
              {' '}
              {matches.length === 0
                ? (backForMatch ? 'You are back in time to take the match yourself.' : 'No matches while you are away.')
                : `${matches.length} match${matches.length === 1 ? '' : 'es'} will be played by your assistant${backForMatch ? ', and you are back for the next' : ''}.`}
            </p>
          </Section>

          <Section icon="career" title="Employment">
            <label className="hol-row">
              <input type="checkbox" checked={jobs !== null} onChange={(e) => setJobs(e.target.checked ? jobTarget : null)} />
              <span>Apply for head coach jobs at:</span>
              <select value={jobTarget} disabled={jobs === null} onChange={(e) => setJobTarget(e.target.value as JobTarget)}>
                {JOB_TARGETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
          </Section>

          <Section icon="transfers" title="Transfer Offers">
            {([
              ['acceptAll', 'Accept all offers for players'],
              ['acceptValue', 'Accept only offers that meet the player’s value'],
              ['reject', 'Reject offers'],
            ] as const).map(([k, label]) => (
              <label key={k} className="hol-row">
                <input type="radio" name="hol-offers" checked={offers === k} onChange={() => setOffers(k)} />
                <span>{label}</span>
              </label>
            ))}
            <label className={`hol-row${offers === 'reject' ? ' off' : ''}`}>
              <input type="checkbox" checked={offers !== 'reject' && onlyListed} disabled={offers === 'reject'}
                onChange={(e) => setOnlyListed(e.target.checked)} />
              <span>Only sell players on the transfer list</span>
            </label>
          </Section>

          <Section icon="tactics" title="Tactics & Team Selection">
            <label className="hol-row">
              <input type="checkbox" checked={useTactics} onChange={(e) => setUseTactics(e.target.checked)} />
              <span>Use the current match tactics</span>
            </label>
            <label className="hol-row">
              <input type="checkbox" checked={useSelection} onChange={(e) => setUseSelection(e.target.checked)} />
              <span>Use the team selection whenever possible</span>
            </label>
          </Section>
        </div>

        <footer className="hol-foot">
          <button onClick={() => g.closeHoliday()}>Cancel</button>
          <button className="primary" disabled={!valid} onClick={confirm}>Confirm holiday</button>
        </footer>
      </div>
    </div>
  );
}
