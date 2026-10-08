import type { JSX } from 'react';
import { STAFF_ROLE_NAMES, StaffRole, staffRating, type StaffAttributes } from '../../engine/model/staff.ts';
import { coachSpells, spellTrophies } from '../../engine/world/career.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { contractEndSeason } from '../../engine/world/world.ts';
import {
  attrClass, Bar, Card, ClubCrest, clubThemeStyle, Empty, Flag, initials, KV, money, StarMeter, StatTile,
} from '../components.tsx';
import { AccoladeList, HonourList, honourOf, type Honour } from '../honours.tsx';
import { coachAccolades } from '../../engine/world/accolades.ts';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { reputationWord } from './ClubDetail.tsx';

const COACHING: ReadonlyArray<[keyof StaffAttributes, string]> = [
  ['coachAttacking', 'Attacking'], ['coachBlocking', 'Blocking'], ['coachServing', 'Serving'],
  ['coachReception', 'Reception'], ['coachSetting', 'Setting'], ['coachTactical', 'Tactical'],
  ['coachMental', 'Mental'], ['coachFitness', 'Fitness'],
];
const PEOPLE: ReadonlyArray<[keyof StaffAttributes, string]> = [
  ['manManagement', 'Man management'], ['motivating', 'Motivating'], ['discipline', 'Discipline'],
  ['workingWithYouth', 'Working with youth'],
];
const KNOWLEDGE: ReadonlyArray<[keyof StaffAttributes, string]> = [
  ['judgingAbility', 'Judging ability'], ['potentialAssessment', 'Judging potential'],
  ['sportsScience', 'Sports science'], ['physiotherapy', 'Physiotherapy'],
];

/** A coach's attributes in three columns — any coach's, or the manager's own. */
export function CoachAttributes({ attributes }: { attributes: StaffAttributes }): JSX.Element {
  const group = (title: string, attrs: ReadonlyArray<[keyof StaffAttributes, string]>): JSX.Element => (
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

/**
 * A coach's profile, FM-style: who he is and where he works, what he is good
 * at, every club he has coached with his record and trophies there.
 */
export function CoachProfile(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const coach = g.selectedCoach !== null ? world.staff[g.selectedCoach] : undefined;
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
  const rating = staffRating(coach);
  const best = coachStrengths(coach.attributes);

  return (
    <div className="club-profile coach-profile">
      <div className={`club-hero${club !== undefined ? ' themed' : ' coach-hero-plain'}`} style={club !== undefined ? clubThemeStyle(club) : undefined}>
        <span className="coach-initials lg">{initials(name)}</span>
        <div className="club-hero-text">
          <span className="club-hero-kicker">
            <Flag nation={coach.nation} /> {NATIONS[coach.nation]?.name ?? '—'} · Age {world.year - coach.birthYear}
          </span>
          <h2 className="club-hero-name">{name}</h2>
          <span className="club-hero-sub">
            <span className="your-club-tag">{STAFF_ROLE_NAMES[coach.role]}</span>
            {club !== undefined
              ? <span className="club-link" onClick={() => g.selectClub(club.id)}><ClubCrest club={club} size={18} /> {club.name}</span>
              : <span>Out of work</span>}
          </span>
        </div>
        <div className="club-hero-rep">
          <span className="profile-rating-label">Reputation</span>
          <StarMeter value={coach.reputation} max={10000} size={20} />
          <span className="dim">{reputationWord(coach.reputation)}</span>
        </div>
        <div className="coach-hero-actions">
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
      </div>

      <div className="tiles">
        <StatTile label="Clubs coached" value={new Set(spells.map((s) => s.clubId)).size} />
        <StatTile label="Matches" value={won + lost} sub={`${won}W ${lost}L`} />
        <StatTile label="Win rate" value={won + lost === 0 ? '—' : `${Math.round((won / (won + lost)) * 100)}%`} />
        <StatTile label="Trophies" value={honours.length} tone={honours.length > 0 ? 'gold' : undefined} />
        <StatTile label="Coaching" value={rating.toFixed(1)} sub={<Bar value={rating} max={20} />} />
      </div>

      <div className="club-grid">
        <div className="stack club-main">
          <Card title="Attributes" icon="stats">
            <CoachAttributes attributes={coach.attributes} />
          </Card>
          <Card title="Career History" icon="career" flush>
            {spells.length === 0 ? <Empty>No clubs coached yet.</Empty> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Club</th>
                      <th>From</th>
                      <th>To</th>
                      <th className="num">W</th>
                      <th className="num">L</th>
                      <th className="num">Win %</th>
                      <th className="num">Trophies</th>
                      <th>Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...spells].reverse().map((s, i) => {
                      const c = world.clubs[s.clubId];
                      const n = s.won + s.lost;
                      const t = spellTrophies(world, s).length;
                      const left = s.to < 0 ? 'Current' : s.exit === 'sacked' ? 'Sacked' : s.exit === 'replaced' ? 'Replaced' : 'Left';
                      return (
                        <tr key={i} className="clickable" onClick={() => c !== undefined && g.selectClub(c.id)}>
                          <td>
                            <span className="name-cell">
                              {c !== undefined && <ClubCrest club={c} size={22} />}
                              <span className="strong">{c?.name ?? '—'}</span>
                            </span>
                          </td>
                          <td className="dim">{g.dateLabelForDay(s.from)}</td>
                          <td className="dim">{s.to < 0 ? 'Present' : g.dateLabelForDay(s.to)}</td>
                          <td className="num">{s.won}</td>
                          <td className="num">{s.lost}</td>
                          <td className="num dim">{n === 0 ? '—' : `${Math.round((s.won / n) * 100)}%`}</td>
                          <td className={`num${t > 0 ? ' gold-text' : ' dim'}`}>{t}</td>
                          <td className={left === 'Sacked' ? 'bad' : left === 'Current' ? 'good' : 'dim'}>{left}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="stack club-side">
          <Card title="Profile" icon="user">
            <KV k="Role">{STAFF_ROLE_NAMES[coach.role]}</KV>
            <KV k="Club">{club?.name ?? 'Out of work'}</KV>
            <KV k="Nation"><Flag nation={coach.nation} /> {NATIONS[coach.nation]?.name ?? '—'}</KV>
            <KV k="Age">{world.year - coach.birthYear}</KV>
            {coach.role === StaffRole.HeadCoach && <KV k="Strengths">{best.join(', ')}</KV>}
            {club !== undefined && <KV k="Wage">{money(coach.wage)} a season</KV>}
            {club !== undefined && coach.contractUntil >= world.day && (
              <KV k="Contract until">30 June {world.startYear + contractEndSeason(coach.contractUntil) + 1}</KV>
            )}
          </Card>
          <Card title={`Trophies (${honours.length})`} icon="trophy">
            <HonourList honours={honours} empty="No trophies yet." />
          </Card>
          {coachAccolades(world, coach.id).length > 0 && (
            <Card title="Awards" icon="star">
              <AccoladeList accolades={coachAccolades(world, coach.id)} world={world} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
