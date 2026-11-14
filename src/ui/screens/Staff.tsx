/**
 * The backroom, the way FM runs it: the club's staff by department, every
 * place filled or open, each contract and what it costs to end; and alongside
 * it the market — the people out of work and those in work elsewhere. Talks
 * to hire one or keep one go the way the players' do, on their own screen.
 */

import { useRef, useState, type JSX } from 'react';
import { StaffRole, STAFF_ROLE_NAMES, staffName, staffRating, type Staff } from '../../engine/model/staff.ts';
import {
  HIRABLE_ROLES, STAFF_DUTIES, STAFF_SLOTS, medicalQuality, staffBudget, staffWageBill, type StaffInterest,
} from '../../engine/world/staffMarket.ts';
import { contractEndSeason, seasonEndYear } from '../../engine/world/world.ts';
import { Bar, ClubCrest, Empty, Flag, ListPager, Metric, money, Panel, Segmented, useFitList } from '../components.tsx';
import { ConfirmDialog } from '../confirmDialog.tsx';
import { Dropdown } from '../dropdown.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { useGame } from '../state.ts';

const INTEREST_LABEL: Readonly<Record<StaffInterest, string>> = {
  keen: 'Keen', open: 'Open', reluctant: 'Unsure', refuses: 'Won’t come',
};
const INTEREST_HINT: Readonly<Record<StaffInterest, string>> = {
  keen: 'He would jump at it', open: 'He would listen', reluctant: 'He needs persuading — your club is below what he is used to', refuses: 'He won’t consider a club of your standing',
};

function ratingTone(r: number): string {
  return r >= 15 ? 'good' : r <= 8 ? 'bad' : '';
}

function Rating({ value }: { value: number }): JSX.Element {
  return (
    <span className="rating-cell">
      <Bar value={value} max={20} />
      <span className={ratingTone(value)}>{value.toFixed(1)}</span>
    </span>
  );
}

/** The backroom by department: each place a card, filled or open. */
const DEPARTMENTS: ReadonlyArray<{ name: string; icon: IconName; roles: readonly StaffRole[] }> = [
  { name: 'Coaching', icon: 'training', roles: [StaffRole.AssistantCoach, StaffRole.StrengthCoach, StaffRole.YouthCoach] },
  { name: 'Medical & management', icon: 'medical', roles: [StaffRole.Doctor, StaffRole.Physiotherapist, StaffRole.SportsPsychologist, StaffRole.DirectorOfFootball] },
  { name: 'Scouting & analysis', icon: 'scouting', roles: [StaffRole.HeadScout, StaffRole.Scout, StaffRole.RecruitmentAnalyst, StaffRole.PerformanceAnalyst] },
];

export function StaffScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const staff = g.backroom();
  const [role, setRole] = useState<StaffRole>(StaffRole.AssistantCoach);
  const [employed, setEmployed] = useState(false);
  const talks = g.staffTalks();

  const spent = staffWageBill(world, club);
  const budget = staffBudget(club);
  const coach = Math.max(0, ...staff.filter((s) => [StaffRole.AssistantCoach, StaffRole.StrengthCoach, StaffRole.YouthCoach].includes(s.role)).map(staffRating));
  const scouting = Math.max(0, ...staff.filter((s) => [StaffRole.HeadScout, StaffRole.Scout, StaffRole.RecruitmentAnalyst].includes(s.role)).map(staffRating));
  const expiring = staff.filter((s) => contractEndSeason(s.contractUntil) <= world.season).length;
  const filled = HIRABLE_ROLES.reduce((n, r) => n + Math.min(STAFF_SLOTS[r], staff.filter((s) => s.role === r).length), 0);
  const places = HIRABLE_ROLES.reduce((n, r) => n + STAFF_SLOTS[r], 0);

  return (
    <div className="staff-desk">
      <section className="finance-headlines staff-headlines" aria-label="Staff overview">
        <Metric label="Staff budget" value={money(spent)} tone={spent > budget ? 'bad' : 'neutral'}
          detail={<>of {money(budget)} · <b>{money(Math.max(0, budget - spent))}</b> free</>} />
        <Metric label="Places filled" value={<>{filled}<small> / {places}</small></>} detail={filled < places ? `${places - filled} open` : 'every place filled'} />
        <Metric label="Coaching" value={coach > 0 ? coach.toFixed(1) : '—'} detail="your best coach, out of 20" />
        <Metric label="Medical" value={`${Math.round(medicalQuality(world, club) * 100)}%`} detail="facilities, doctor and physios" />
        <Metric label="Scouting" value={scouting > 0 ? scouting.toFixed(1) : '—'} detail="your best judge of a player" />
        <Metric label="Contracts ending" value={expiring} tone={expiring > 0 ? 'warn' : 'neutral'}
          detail={expiring > 0 ? `on 30 June ${seasonEndYear(world, world.season)}` : 'none this season'} />
      </section>

      <div className="staff-desk-body">
        <Panel className="staff-backroom" title="Your backroom">
          <div className="staff-departments">
            {DEPARTMENTS.map((d) => (
              <section key={d.name} className="staff-dept">
                <h4><Icon name={d.icon} size={14} /> {d.name}</h4>
                <div className="staff-slots">
                  {d.roles.map((r) => {
                    const mine = staff.filter((s) => s.role === r).sort((a, b) => staffRating(b) - staffRating(a));
                    const open = Math.max(0, STAFF_SLOTS[r] - mine.length);
                    return [
                      ...mine.map((s) => <StaffSlot key={s.id} s={s} />),
                      ...Array.from({ length: open }, (_, i) => (
                        <button key={`${r}-open-${i}`} className={`staff-slot vacant${role === r ? ' active' : ''}`} onClick={() => setRole(r)}
                          title={STAFF_DUTIES[r]}>
                          <span className="staff-slot-vacant"><Icon name="search" size={12} /> <b>{STAFF_ROLE_NAMES[r]}</b> · vacant</span>
                        </button>
                      )),
                    ];
                  })}
                </div>
              </section>
            ))}
          </div>
        </Panel>

        <Panel
          className="staff-market"
          title="Find staff"
          action={(
            <div className="toolbar-inline">
              <Dropdown size="sm" value={role} onChange={(v) => setRole(v)}
                options={HIRABLE_ROLES.map((r) => ({ value: r, label: STAFF_ROLE_NAMES[r] }))} />
              <Segmented size="sm" value={employed ? 1 : 0} onChange={(v) => setEmployed(v === 1)}
                options={[[0, 'Out of work'], [1, 'At other clubs']]} />
            </div>
          )}
        >
          {talks.length > 0 && (
            <div className="staff-talks-strip">
              <span className="faint">Talks</span>
              {talks.map((t) => {
                const who = world.staff[t.staffId];
                return who === undefined ? null : (
                  <button key={t.id} className={`sm staff-talks-chip${t.pending === null ? ' yours' : ''}`} onClick={() => g.openStaffTalksView(t.id)}
                    title={t.pending === null ? 'Your move' : `Answer due ${g.dateLabelForDay(t.pending.resolvesOn)}`}>
                    {staffName(who)}
                    <span className="faint">{t.pending === null ? 'your move' : `reply ${g.dateLabelForDay(t.pending.resolvesOn)}`}</span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="staff-duty"><b>{STAFF_ROLE_NAMES[role]}</b> — {STAFF_DUTIES[role]}</p>
          <StaffMarketTable key={`${role}/${employed}`} role={role} employed={employed} />
        </Panel>
      </div>
    </div>
  );
}

/** One of the club's staff, as a card: who, how good, until when — and what can be done. */
function StaffSlot({ s }: { s: Staff }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const ends = contractEndSeason(s.contractUntil);
  const expiring = ends <= world.season;
  const [releasing, setReleasing] = useState<number | null>(null);
  const talks = g.staffTalksWith(s.id);
  const rating = staffRating(s);
  return (
    <div className={`staff-slot${talks !== null ? ' talks' : ''}`} title={STAFF_DUTIES[s.role]}>
      <span className="staff-slot-main">
        <span className="staff-slot-name">
          <Flag nation={s.nation} /> <span className="player-link" onClick={() => g.selectCoach(s.id)}>{staffName(s)}</span>
        </span>
        <span className={`staff-slot-rating ${ratingTone(rating)}`}>{rating.toFixed(1)}</span>
      </span>
      <span className="staff-slot-bar"><Bar value={rating} max={20} wide /></span>
      <span className="staff-slot-foot">
        <span className="staff-slot-meta">
          <b>{STAFF_ROLE_NAMES[s.role]}</b><span className="staff-slot-extra"> · {world.year - s.birthYear} · {money(s.wage)}</span> ·{' '}
          <span className={expiring ? 'warn-text' : ''}>{expiring ? 'ends this June' : `to June ${seasonEndYear(world, ends)}`}</span>
        </span>
        {s.unsettled === true && <span className="staff-tag warn" title="He wanted a move you blocked: he'll want more to stay">Unsettled</span>}
        {s.listed === true && <span className="staff-tag" title="Other clubs have been told he is available">Listed</span>}
        {talks !== null && <span className="staff-tag" title="Contract talks under way">In talks</span>}
        <span className="staff-actions">
          <button className="sm icon-btn" title={talks !== null ? 'Contract talks' : 'Offer a new contract'} onClick={() => g.openStaffTalks(s.id)}><Icon name="contract" size={12} /></button>
          <button className={`sm icon-btn${s.listed === true ? ' on' : ''}`} title={s.listed === true ? 'Take him off the list' : 'Make him available — other clubs will come in for him'}
            onClick={() => g.toggleStaffListed(s.id)}><Icon name="transfers" size={12} /></button>
          <button className="sm icon-btn danger" title="Release him — paying up his contract" onClick={() => setReleasing(g.staffSeverance(s.id))}><Icon name="close" size={12} /></button>
        </span>
      </span>
      {releasing !== null && (
        <ConfirmDialog
          title="Release staff member"
          icon="user"
          message={`Release ${staffName(s)}?`}
          detail={releasing > 0 ? `Paying up the rest of his contract costs ${money(releasing)}.` : 'His contract is up, so it costs nothing.'}
          confirmLabel="Release"
          onCancel={() => setReleasing(null)}
          onConfirm={() => { setReleasing(null); g.releaseStaffMember(s.id); }}
        />
      )}
    </div>
  );
}

/** The market for a role: the best first, what each asks, and whether he'd come — as many as fit, a page at a time. */
function StaffMarketTable({ role, employed }: { role: StaffRole; employed: boolean }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const list = g.staffMarket(role, employed);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fit = useFitList(wrapRef, list.length, { min: 30, max: 40 });
  if (list.length === 0) return <Empty>{employed ? 'Nobody in this role at other clubs.' : 'Nobody out of work in this role just now — more come onto the market each month.'}</Empty>;
  return (
    <>
      <div className="table-wrap staff-market-list" ref={wrapRef}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Rating</th>
              <th className="num">Asks</th>
              {employed && <th className="num">Fee</th>}
              <th>Interest</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.slice(fit.from, fit.to).map(({ s, rating, ask, interest, fee }) => {
              const club = s.clubId >= 0 ? world.clubs[s.clubId] : undefined;
              return (
                <tr key={s.id}>
                  <td className="strong">
                    <Flag nation={s.nation} /> <span className="player-link" onClick={() => g.selectCoach(s.id)}>{staffName(s)}</span>
                    {g.staffTalksWith(s.id) !== null && <span className="staff-tag">In talks</span>}
                    <span className="staff-club">{world.year - s.birthYear}{club !== undefined && <> · <ClubCrest club={club} size={13} /> {club.shortName}</>}</span>
                  </td>
                  <td><Rating value={rating} /></td>
                  <td className="num dim">{money(ask)}</td>
                  {employed && <td className="num dim">{money(fee)}</td>}
                  <td><span className={`staff-interest ${interest}`} title={INTEREST_HINT[interest]}>{INTEREST_LABEL[interest]}</span></td>
                  <td className="num">
                    <button className="sm primary staff-go" disabled={interest === 'refuses'} title={employed ? 'Approach his club' : 'Offer him a contract'} onClick={() => g.openStaffTalks(s.id)}>
                      <Icon name="contract" size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="staff-market-foot">
        <span className="faint">{list.length} {employed ? 'at other clubs' : 'out of work'}</span>
        <ListPager page={fit.page} pages={fit.pages} setPage={fit.setPage} />
      </div>
    </>
  );
}
