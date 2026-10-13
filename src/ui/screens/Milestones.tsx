/**
 * The manager's own record: the achievements of his career, reached and still
 * to reach, and the courses that make him a better coach.
 */

import type { JSX } from 'react';
import { achievementList, type AchievementGroup } from '../../engine/world/achievements.ts';
import { COURSES, courseBlock, LICENCE_NAMES, licenceOf } from '../../engine/world/courses.ts';
import { ensureManagerAttributes } from '../../engine/world/career.ts';
import { Bar, Card, money, StatTile } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

const GROUPS: readonly AchievementGroup[] = ['Results', 'Silverware', 'Career'];

export function AchievementsScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const list = achievementList(world);
  const done = list.filter((a) => a.day !== null).length;
  return (
    <>
      <div className="tiles">
        <StatTile label="Achievements" value={`${done} / ${list.length}`} sub={<Bar value={(done / list.length) * 100} wide />} />
        {GROUPS.map((grp) => {
          const of = list.filter((a) => a.group === grp);
          return <StatTile key={grp} label={grp} value={`${of.filter((a) => a.day !== null).length} / ${of.length}`} />;
        })}
      </div>
      <div className="ach-grid">
        {GROUPS.map((grp) => (
          <Card key={grp} title={grp} icon={grp === 'Silverware' ? 'trophy' : grp === 'Results' ? 'stats' : 'career'} className="ach-card">
            <div className="ach-list">
              {list.filter((a) => a.group === grp).map((a) => (
                <div key={a.id} className={`ach${a.day !== null ? ' got' : ''}`}>
                  <span className="ach-badge">{a.day !== null ? <Icon name="trophy" size={16} /> : <Icon name="lock" size={14} />}</span>
                  <span className="ach-text">
                    <b>{a.title}</b>
                    <span className="faint">{a.day !== null ? `${a.hint.replace(/\.$/, '')} · ${g.dateLabelForDay(a.day)}` : a.hint}</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

export function CoursesScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const career = world.career;
  const attrs = ensureManagerAttributes(world);
  const running = career.course !== undefined ? COURSES.find((c) => c.id === career.course!.id) : undefined;
  const licence = licenceOf(world);
  const progress = career.course !== undefined
    ? Math.max(0, Math.min(1, (world.day - career.course.started) / Math.max(1, career.course.until - career.course.started)))
    : 0;
  return (
    <>
      <div className="tiles">
        <StatTile label="Licence" value={licence !== null ? LICENCE_NAMES[licence] : 'None'} sub="Level 2, Level 1, then the Pro licence" />
        <StatTile label="On a course" value={running?.name ?? 'No'}
          sub={career.course !== undefined ? <>done {g.dateLabelForDay(career.course.until)} <Bar value={progress * 100} wide /></> : 'one at a time, alongside the job'} />
        <StatTile label="Clinics this season" value={(career.clinics ?? []).filter((c) => c.season === world.season).length}
          sub="each once a season" />
      </div>
      <div className="crs-grid">
        {COURSES.map((c) => {
          const block = courseBlock(world, c);
          const mine = career.course?.id === c.id;
          return (
            <Card key={c.id} title={c.name} icon={c.licence !== undefined ? 'contract' : 'training'} className={`crs-card${c.licence !== undefined ? ' licence' : ''}`}>
              <div className="crs-attrs">
                {c.attrs.map((k) => (
                  <span key={k} className="crs-attr">
                    {ATTR_WORDS[k] ?? k} <b>{attrs[k]}{attrs[k] < 20 ? <span className="good"> → {Math.min(20, attrs[k] + c.gain)}</span> : ''}</b>
                  </span>
                ))}
              </div>
              <span className="faint crs-terms">
                {Math.round(c.days / 7)} weeks · {money(c.fee)}{c.reputation !== undefined ? ' · raises your name' : ''}
              </span>
              <div className="crs-foot">
                {mine
                  ? <span className="biz-status">Under way — done {g.dateLabelForDay(career.course!.until)}</span>
                  : <button className="sm" disabled={block !== null} title={block ?? 'Enrol'} onClick={() => g.startCourse(c.id)}><Icon name="check" size={13} /> Enrol</button>}
                {block !== null && !mine && <span className="faint crs-why">{block}</span>}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

const ATTR_WORDS: Readonly<Partial<Record<string, string>>> = {
  coachAttacking: 'Attacking', coachBlocking: 'Blocking', coachServing: 'Serving', coachReception: 'Reception',
  coachSetting: 'Setting', coachTactical: 'Tactical', coachMental: 'Mental', coachFitness: 'Fitness',
  judgingAbility: 'Judging ability', potentialAssessment: 'Judging potential', sportsScience: 'Sports science',
  manManagement: 'Man management', discipline: 'Discipline', motivating: 'Motivating', workingWithYouth: 'Working with youth',
  adaptability: 'Adaptability',
};
