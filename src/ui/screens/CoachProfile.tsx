import { useState, type CSSProperties, type JSX } from 'react';
import {
  ROLE_KEY_ATTRIBUTES, STAFF_ROLE_NAMES, StaffRole, staffRating, type Staff, type StaffAttributes,
} from '../../engine/model/staff.ts';
import { Formation } from '../../engine/match/tactics.ts';
import { coachSpells, spellTrophies } from '../../engine/world/career.ts';
import { CONFEDERATIONS, NATIONS, type Confederation } from '../../engine/world/nations.ts';
import { contractEndSeason } from '../../engine/world/world.ts';
import { attrClass, ClubCrest, clubThemeStyle, Flag, initials, KV, money, StarMeter } from '../components.tsx';
import { AccoladeList, HonourList, honourOf, type Honour } from '../honours.tsx';
import { coachAccolades } from '../../engine/world/accolades.ts';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { reputationWord } from './ClubDetail.tsx';
import { DEFENSE_OPTIONS, FORMATION_OPTIONS, OFFENSE_OPTIONS, SERVE_OPTIONS, TEMPO_OPTIONS } from './Manage.tsx';

type Attr = keyof StaffAttributes;

const COACHING: ReadonlyArray<[Attr, string]> = [
  ['coachAttacking', 'Attacking'], ['coachBlocking', 'Blocking'], ['coachServing', 'Serving'],
  ['coachReception', 'Reception'], ['coachSetting', 'Setting'], ['coachTactical', 'Tactical'],
  ['coachMental', 'Mental'], ['coachFitness', 'Fitness'],
];
const PEOPLE: ReadonlyArray<[Attr, string]> = [
  ['manManagement', 'Man management'], ['motivating', 'Motivating'], ['discipline', 'Discipline'],
  ['workingWithYouth', 'Working with youth'],
];
const KNOWLEDGE: ReadonlyArray<[Attr, string]> = [
  ['judgingAbility', 'Judging ability'], ['potentialAssessment', 'Judging potential'],
  ['sportsScience', 'Sports science'], ['physiotherapy', 'Physiotherapy'],
];

/** A coach's attributes in three columns — any coach's, or the manager's own. */
export function CoachAttributes({ attributes }: { attributes: StaffAttributes }): JSX.Element {
  const group = (title: string, attrs: ReadonlyArray<[Attr, string]>): JSX.Element => (
    <div className="attr-col">
      <h4 className="attr-col-title">{title}</h4>
      {attrs.map(([k, label]) => (
        <div className="attr" key={k}>
          <span className="name">{label}</span>
          <span className={`attr-val ${attrClass(attributes[k])}`}>{attributes[k]}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="attr-cols">
      {group('Coaching', COACHING)}
      {group('People', PEOPLE)}
      {group('Knowledge', KNOWLEDGE)}
    </div>
  );
}

/** A coach's two best coaching attributes, by name. */
export function coachStrengths(attributes: StaffAttributes): string[] {
  return [...COACHING].sort((a, b) => attributes[b[0]] - attributes[a[0]]).slice(0, 2).map(([, l]) => l);
}

/** Every role in a backroom, as the list down the side of the profile has them: the coaches first, the doctors last. */
const ROLE_ORDER: readonly StaffRole[] = [
  StaffRole.HeadCoach, StaffRole.AssistantCoach, StaffRole.DirectorOfFootball, StaffRole.HeadScout, StaffRole.Scout,
  StaffRole.RecruitmentAnalyst, StaffRole.PerformanceAnalyst, StaffRole.YouthCoach, StaffRole.StrengthCoach,
  StaffRole.SportsPsychologist, StaffRole.Physiotherapist, StaffRole.Doctor,
];

const REGION_NAMES: Readonly<Record<Confederation, string>> = {
  CEV: 'Europe', CSV: 'South America', NORCECA: 'North & Central America', AVC: 'Asia & Oceania', CAVB: 'Africa',
};

type CoachTab = 'managerial' | 'coaching' | 'scouting' | 'medical';
const TABS: ReadonlyArray<[CoachTab, string, 'staff' | 'training' | 'scouting' | 'medical']> = [
  ['managerial', 'Managerial', 'staff'], ['coaching', 'Coaching', 'training'], ['scouting', 'Scouting', 'scouting'], ['medical', 'Medical', 'medical'],
];

/** The tab a profile opens on: the side of the job his role is. */
function tabFor(role: StaffRole): CoachTab {
  switch (role) {
    case StaffRole.HeadCoach:
    case StaffRole.DirectorOfFootball:
      return 'managerial';
    case StaffRole.Scout:
    case StaffRole.HeadScout:
    case StaffRole.RecruitmentAnalyst:
      return 'scouting';
    case StaffRole.Doctor:
    case StaffRole.Physiotherapist:
    case StaffRole.StrengthCoach:
      return 'medical';
    default:
      return 'coaching';
  }
}

/** How well suited he is to a role, as a pie filled 0 to 1 by his rating for it — full from 16 up. */
function RoleDot({ rating }: { rating: number }): JSX.Element {
  const fill = Math.max(0, Math.min(1, (rating - 4) / 12));
  return (
    <span className={`cp-dot${rating >= 15 ? ' top' : rating >= 11 ? ' good' : ''}`} style={{ '--fill': fill } as CSSProperties}
      title={`${rating.toFixed(1)} / 20`} />
  );
}

/** A column of attributes, those that matter for the role picked shown up in green. */
function AttrColumn({ title, rows, attributes, keys }: {
  title: string;
  rows: ReadonlyArray<[Attr, string]>;
  attributes: StaffAttributes;
  keys: ReadonlySet<Attr>;
}): JSX.Element {
  return (
    <div className="cp-col">
      <h4 className="cp-col-title">{title}</h4>
      {rows.map(([k, label]) => (
        <div className={`cp-attr${keys.has(k) ? ' key' : ''}`} key={k}>
          <span>{label}</span>
          <b className={`attr-val ${attrClass(attributes[k])}`}>{attributes[k]}</b>
        </div>
      ))}
    </div>
  );
}

/** What stands out about the way he works with people and runs a session — from what can be seen of him: the three strongest. */
function traitsOf(a: StaffAttributes): string[] {
  const out: Array<[string, number]> = [
    ['Disciplinarian', a.discipline],
    ['Motivator', a.motivating],
    ['Man-manager', a.manManagement],
    ['Tactician', a.coachTactical],
    ['Develops youngsters', a.workingWithYouth],
    ['Talent spotter', Math.min(a.judgingAbility, a.potentialAssessment)],
    ['Sports scientist', Math.max(a.physiotherapy, a.sportsScience)],
  ];
  const strong = out.filter(([, v]) => v >= 16).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t]) => t);
  return strong.length > 0 ? strong : ['Steady all-rounder'];
}

const label = <T,>(options: ReadonlyArray<[T, string]>, v: T): string => options.find(([o]) => o === v)?.[1] ?? '—';

/** A few lines about him, as a profile's biography: where he is from, his first job and his record, where he is now. */
function biography(world: NonNullable<ReturnType<typeof useGame>['world']>, coach: Staff, dateOf: (day: number) => string): string[] {
  const name = `${coach.firstName} ${coach.lastName}`;
  const age = world.year - coach.birthYear;
  const nation = NATIONS[coach.nation]?.name ?? 'abroad';
  const lines = [`${name} was born in ${coach.birthYear}, in ${nation}, and is ${age}.`];
  const spells = coachSpells(world, coach);
  if (spells.length > 0) {
    const first = world.clubs[spells[0].clubId];
    const won = spells.reduce((s, x) => s + x.won, 0);
    const played = spells.reduce((s, x) => s + x.won + x.lost, 0);
    const trophies = spells.reduce((s, x) => s + spellTrophies(world, x).length, 0);
    lines.push(`His first job as a head coach was at ${first?.name ?? 'a club since gone'}, from ${dateOf(spells[0].from)}.`);
    if (played > 0) {
      lines.push(`He has won ${won} of his ${played} matches in charge${trophies > 0 ? `, and ${trophies} trophies` : ''}.`);
    }
  }
  const club = coach.clubId >= 0 ? world.clubs[coach.clubId] : undefined;
  if (coach.retired === true) lines.push('He has retired from the game.');
  else if (club !== undefined) {
    const until = coach.contractUntil >= world.day ? `, under contract until 30 June ${world.startYear + contractEndSeason(coach.contractUntil) + 1}` : '';
    lines.push(`He is ${STAFF_ROLE_NAMES[coach.role].toLowerCase()} at ${club.name}${until}.`);
  } else {
    lines.push(`He is out of work${coach.freeSince !== undefined ? `, and has been since ${dateOf(coach.freeSince)}` : ''}.`);
  }
  if (coach.listed === true) lines.push('His club has made him available to other clubs.');
  if (coach.unsettled === true) lines.push('He is unsettled, after a move he wanted fell through.');
  return lines;
}

/**
 * A coach's profile, laid out as Football Manager's staff profile: who he is, his contract and his
 * reputation along the top; down the side every role in a backroom, with how well he would do
 * each; his attributes by side of the job, those that matter for the role picked in green; what
 * stands out about him, how his team plays and a few lines of biography; and along the foot every
 * club he has coached, with his record and trophies there.
 */
export function CoachProfile(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const coach = g.selectedCoach !== null ? world.staff[g.selectedCoach] : undefined;
  const [role, setRole] = useState<StaffRole | null>(null);
  const [tab, setTab] = useState<CoachTab | null>(null);
  if (coach === undefined) return null;

  const name = `${coach.firstName} ${coach.lastName}`;
  const club = coach.clubId >= 0 ? world.clubs[coach.clubId] : undefined;
  const spells = coachSpells(world, coach);
  const won = spells.reduce((s, x) => s + x.won, 0);
  const lost = spells.reduce((s, x) => s + x.lost, 0);
  const manyClubs = new Set(spells.map((s) => s.clubId)).size > 1;
  const honours = spells
    .flatMap((s) => spellTrophies(world, s).map((t) => honourOf(world, t.competitionId, t.year,
      manyClubs ? world.clubs[s.clubId]?.shortName : undefined)))
    .filter((h): h is Honour => h !== null);
  const accolades = coachAccolades(world, coach.id);
  const a = coach.attributes;
  const picked = role ?? coach.role;
  const shown = tab ?? tabFor(coach.role);
  const keys = new Set<Attr>(ROLE_KEY_ATTRIBUTES[picked]);
  const ratingFor = (r: StaffRole): number => staffRating({ ...coach, role: r });
  const best = [...COACHING, ...PEOPLE, ...KNOWLEDGE].sort((x, y) => a[y[0]] - a[x[0]]).slice(0, 3);
  const tactics = club?.tactics;
  const knows = [...coach.nationKnowledge].sort((x, y) => y[1] - x[1]).slice(0, 3);
  const contractEnd = coach.contractUntil >= world.day ? `30 June ${world.startYear + contractEndSeason(coach.contractUntil) + 1}` : null;

  return (
    <div className="club-profile cp" data-pronouns="keep">
      <header className="cp-head" style={club !== undefined ? clubThemeStyle(club) : undefined}>
        <span className="coach-initials cp-face">{initials(name)}</span>
        <div className="cp-who">
          <h2>{name}</h2>
          <span>{world.year - coach.birthYear} years old (born {coach.birthYear})</span>
          <span><Flag nation={coach.nation} /> {NATIONS[coach.nation]?.name ?? '—'}</span>
        </div>
        <div className="cp-contract">
          {club !== undefined ? (
            <>
              <span className="cp-kicker">Contracted to <span className="club-link" onClick={() => g.selectClub(club.id)}><ClubCrest club={club} size={16} /> {club.name}</span></span>
              <b>{STAFF_ROLE_NAMES[coach.role]}</b>
              <span>{money(coach.wage)} a season{contractEnd !== null ? ` until ${contractEnd}` : ''}</span>
            </>
          ) : (
            <>
              <span className="cp-kicker">{coach.retired === true ? 'Retired' : 'Out of work'}</span>
              <b>{STAFF_ROLE_NAMES[coach.role]}</b>
              <span>{coach.retired === true ? 'No longer in the game' : 'Free to sign'}</span>
            </>
          )}
        </div>
        <div className="cp-rep">
          <Icon name="star" size={18} />
          <span>
            <span className="cp-kicker">Reputation</span>
            <StarMeter value={coach.reputation} max={10000} size={15} />
            <small>{reputationWord(coach.reputation)}</small>
          </span>
        </div>
        <div className="cp-actions">
          {/* The backroom is the manager's to hire and keep: talks open on the Staff screen. */}
          {coach.role !== StaffRole.HeadCoach && coach.retired !== true && g.club !== null && (
            coach.clubId === g.club.id
              ? <button className="primary" onClick={() => g.openStaffTalks(coach.id)}><Icon name="contract" size={14} /> New contract</button>
              : g.staffTerms(coach.id)?.interest !== 'refuses' && (
                <button className="primary" onClick={() => g.openStaffTalks(coach.id)}>
                  <Icon name="contract" size={14} /> {coach.clubId >= 0 ? 'Approach' : 'Offer contract'}
                </button>
              )
          )}
          <button onClick={() => g.selectCoach(null)}><Icon name="close" size={14} /> Close</button>
        </div>
      </header>

      <div className="cp-body">
        <section className="cp-panel cp-roles">
          <h3 className="cp-title">Staff Roles</h3>
          <div className="cp-role-list">
            {ROLE_ORDER.map((r) => (
              <button key={r} className={`cp-role${picked === r ? ' on' : ''}${coach.role === r ? ' his' : ''}`} onClick={() => setRole(r)}>
                <RoleDot rating={ratingFor(r)} />
                <span>{STAFF_ROLE_NAMES[r]}</span>
                {coach.role === r && <small>Current</small>}
              </button>
            ))}
          </div>
          <div className="cp-roles-foot">
            <span className="cp-kicker">Important attributes for</span>
            <b>{STAFF_ROLE_NAMES[picked]}</b>
            <span className={`attr-val ${attrClass(Math.round(ratingFor(picked)))}`}>{ratingFor(picked).toFixed(1)}</span>
          </div>
        </section>

        <section className="cp-panel cp-attrs">
          <nav className="cp-tabs">
            {TABS.map(([id, text, icon]) => (
              <button key={id} className={shown === id ? 'on' : ''} onClick={() => setTab(id)}><Icon name={icon} size={14} /> {text}</button>
            ))}
          </nav>
          <div className="cp-cols">
            {shown === 'coaching' && (
              <>
                <AttrColumn title="Coaching" rows={COACHING} attributes={a} keys={keys} />
                <AttrColumn title="People" rows={PEOPLE} attributes={a} keys={keys} />
                <AttrColumn title="Knowledge" rows={KNOWLEDGE} attributes={a} keys={keys} />
              </>
            )}
            {shown === 'managerial' && (
              <>
                <AttrColumn title="People" rows={PEOPLE} attributes={a} keys={keys} />
                <AttrColumn title="Tactical" rows={[['coachTactical', 'Tactical'], ['coachMental', 'Mental'], ['judgingAbility', 'Judging ability']]} attributes={a} keys={keys} />
                <div className="cp-col">
                  <h4 className="cp-col-title">Record as head coach</h4>
                  <div className="cp-attr"><span>Clubs coached</span><b>{new Set(spells.map((s) => s.clubId)).size}</b></div>
                  <div className="cp-attr"><span>Matches</span><b>{won + lost}</b></div>
                  <div className="cp-attr"><span>Won – lost</span><b>{won}–{lost}</b></div>
                  <div className="cp-attr"><span>Win rate</span><b>{won + lost === 0 ? '—' : `${Math.round((won / (won + lost)) * 100)}%`}</b></div>
                  <div className="cp-attr"><span>Trophies</span><b className={honours.length > 0 ? 'gold-text' : ''}>{honours.length}</b></div>
                </div>
              </>
            )}
            {shown === 'scouting' && (
              <>
                <AttrColumn title="Scouting" rows={[['judgingAbility', 'Judging ability'], ['potentialAssessment', 'Judging potential']]} attributes={a} keys={keys} />
                <div className="cp-col">
                  <h4 className="cp-col-title">Knowledge of the world</h4>
                  {CONFEDERATIONS.map((c) => (
                    <div className="cp-attr" key={c}>
                      <span>{REGION_NAMES[c]}</span>
                      <b className={`attr-val ${attrClass(coach.regionKnowledge[c] ?? 5)}`}>{coach.regionKnowledge[c] ?? 5}</b>
                    </div>
                  ))}
                </div>
                <div className="cp-col">
                  <h4 className="cp-col-title">Knows best</h4>
                  {knows.length === 0 ? <span className="faint cp-none">No country in particular.</span> : knows.map(([n, v]) => (
                    <div className="cp-attr" key={n}>
                      <span><Flag nation={n} /> {NATIONS[n]?.name ?? '—'}</span>
                      <b className={`attr-val ${attrClass(v)}`}>{v}</b>
                    </div>
                  ))}
                </div>
              </>
            )}
            {shown === 'medical' && (
              <>
                <AttrColumn title="Medical" rows={[['physiotherapy', 'Physiotherapy'], ['sportsScience', 'Sports science']]} attributes={a} keys={keys} />
                <AttrColumn title="Conditioning" rows={[['coachFitness', 'Fitness'], ['coachMental', 'Mental']]} attributes={a} keys={keys} />
              </>
            )}
          </div>
          {tactics !== undefined && coach.role === StaffRole.HeadCoach && (
            <div className="cp-formations">
              <span><small>Preferred system</small><b>{label(FORMATION_OPTIONS, tactics.formation ?? Formation.FiveOne)}</b></span>
              <span><small>Offence</small><b>{label(OFFENSE_OPTIONS, tactics.offense)}</b></span>
              <span><small>Tempo</small><b>{label(TEMPO_OPTIONS, tactics.tempo)}</b></span>
            </div>
          )}
        </section>

        <section className="cp-panel cp-side">
          <div className="cp-block">
            <h3 className="cp-title">Traits</h3>
            <div className="cp-chips">{traitsOf(a).map((t) => <span key={t} className="cp-chip">{t}</span>)}</div>
          </div>
          <div className="cp-block cp-best">
            <h3 className="cp-title">Best at</h3>
            {best.map(([k, l]) => (
              <div className="cp-attr" key={k}><span>{l}</span><b className={`attr-val ${attrClass(a[k])}`}>{a[k]}</b></div>
            ))}
          </div>
          {tactics !== undefined && coach.role === StaffRole.HeadCoach && (
            <div className="cp-block">
              <h3 className="cp-title">How his team plays</h3>
              <KV k="Defence">{label(DEFENSE_OPTIONS, tactics.defense)}</KV>
              <KV k="Serving">{label(SERVE_OPTIONS, tactics.serve)}</KV>
            </div>
          )}
          <div className="cp-block cp-bio">
            <h3 className="cp-title">Biography</h3>
            {biography(world, coach, (d) => g.dateLabelForDay(d)).map((line) => <p key={line}>{line}</p>)}
          </div>
        </section>
      </div>

      <div className="cp-foot">
        <section className="cp-panel cp-history">
          <h3 className="cp-title"><Icon name="career" size={14} /> History</h3>
          {spells.length === 0 ? (
            <div className="cp-hist-row">
              <span className="dim">{world.year}</span>
              <span className="cp-hist-club">{club !== undefined ? <><ClubCrest club={club} size={18} /> {club.name}</> : 'Out of work'}</span>
              <span className="dim">{STAFF_ROLE_NAMES[coach.role]}</span>
              <span />
              <span />
            </div>
          ) : (
            <div className="cp-hist">
              {[...spells].reverse().map((s, i) => {
                const c = world.clubs[s.clubId];
                const n = s.won + s.lost;
                const t = spellTrophies(world, s).length;
                const left = s.to < 0 ? 'Current' : s.exit === 'sacked' ? 'Sacked' : s.exit === 'replaced' ? 'Replaced' : 'Left';
                return (
                  <div key={i} className="cp-hist-row clickable" onClick={() => c !== undefined && g.selectClub(c.id)}>
                    <span className="dim">{g.dateLabelForDay(s.from)} – {s.to < 0 ? 'present' : g.dateLabelForDay(s.to)}</span>
                    <span className="cp-hist-club">{c !== undefined && <ClubCrest club={c} size={18} />} {c?.name ?? '—'}</span>
                    <span className="dim">Head Coach · {s.won}W {s.lost}L{n > 0 ? ` (${Math.round((s.won / n) * 100)}%)` : ''}</span>
                    <span className={t > 0 ? 'gold-text' : 'dim'}>{t > 0 ? `${t} trophies` : ''}</span>
                    <span className={left === 'Sacked' ? 'bad' : left === 'Current' ? 'good' : 'dim'}>{left}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className="cp-panel cp-honours">
          <h3 className="cp-title"><Icon name="trophy" size={14} /> Trophies ({honours.length})</h3>
          <HonourList honours={honours} empty="No trophies yet." />
          {accolades.length > 0 && <AccoladeList accolades={accolades} world={world} />}
        </section>
      </div>
    </div>
  );
}
