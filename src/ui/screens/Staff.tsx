/**
 * The backroom, the way FM runs it: the club's staff by department, every
 * place filled or open, each contract and what it costs to end; and alongside
 * it the market — the people out of work and those in work elsewhere. Talks
 * to hire one or keep one go the way the players' do, on their own screen.
 */

import { useState, type JSX } from 'react';
import { StaffRole, STAFF_ROLE_NAMES, staffName, staffRating, type Staff } from '../../engine/model/staff.ts';
import {
  HIRABLE_ROLES, STAFF_DUTIES, STAFF_SLOTS, medicalQuality, staffBudget, staffWageBill, type StaffInterest,
} from '../../engine/world/staffMarket.ts';
import { contractEndSeason, seasonEndYear } from '../../engine/world/world.ts';
import { Bar, Card, ClubCrest, Empty, Flag, money, Segmented, StatTile } from '../components.tsx';
import { Dropdown } from '../dropdown.tsx';
import { Icon } from '../icons.tsx';
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
  const find = (r: StaffRole): void => setRole(r);

  return (
    <>
      <div className="tiles">
        <StatTile label="Staff budget" value={money(spent)} tone={spent > budget ? 'bad' : undefined}
          sub={<>of {money(budget)} a season · <b>{money(Math.max(0, budget - spent))}</b> free</>} />
        <StatTile label="Coaching" value={coach > 0 ? coach.toFixed(1) : '—'} sub="your best coach, out of 20" />
        <StatTile label="Medical" value={`${Math.round(medicalQuality(world, club) * 100)}%`} sub="facilities, doctor and physios" />
        <StatTile label="Scouting" value={scouting > 0 ? scouting.toFixed(1) : '—'} sub="your best judge of a player" />
        <StatTile label="Contracts" value={expiring} tone={expiring > 0 ? 'warn' : undefined} sub={expiring > 0 ? `run out on 30 June ${seasonEndYear(world, world.season)}` : 'none running out this season'} />
      </div>

      <div className="staff-layout">
        <Card title="Your staff" icon="staff" flush>
          <div className="table-wrap">
            <table className="data-table staff-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Name</th>
                  <th className="num">Age</th>
                  <th>Rating</th>
                  <th className="num">Wage</th>
                  <th>Contract</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {HIRABLE_ROLES.map((r) => {
                  const mine = staff.filter((s) => s.role === r).sort((a, b) => staffRating(b) - staffRating(a));
                  const open = STAFF_SLOTS[r] - mine.length;
                  return [
                    ...mine.map((s, i) => (
                      <StaffRow key={s.id} s={s} first={i === 0} rows={mine.length + Math.max(0, open)} />
                    )),
                    ...Array.from({ length: Math.max(0, open) }, (_, i) => (
                      <tr key={`${r}-open-${i}`} className={`staff-vacant${role === r ? ' active' : ''}`}>
                        {mine.length === 0 && i === 0 && (
                          <td rowSpan={open} className="staff-role" title={STAFF_DUTIES[r]}>{STAFF_ROLE_NAMES[r]}</td>
                        )}
                        <td colSpan={5} className="faint">Vacant</td>
                        <td className="num"><button className="sm" onClick={() => find(r)}><Icon name="search" size={12} /> Find</button></td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Find staff"
          icon="search"
          flush
          actions={(
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
          <StaffMarketTable role={role} employed={employed} />
        </Card>
      </div>
    </>
  );
}

/** One of the club's staff: his contract and what can be done about it. */
function StaffRow({ s, first, rows }: { s: Staff; first: boolean; rows: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const ends = contractEndSeason(s.contractUntil);
  const expiring = ends <= world.season;
  const release = (): void => {
    const cost = g.staffSeverance(s.id);
    if (window.confirm(`Release ${staffName(s)}? ${cost > 0 ? `Paying up the rest of his contract costs ${money(cost)}.` : 'His contract is up, so it costs nothing.'}`)) {
      g.releaseStaffMember(s.id);
    }
  };
  const talks = g.staffTalksWith(s.id);
  return (
    <tr className={talks !== null ? 'selected' : undefined}>
      {first && <td rowSpan={rows} className="staff-role" title={STAFF_DUTIES[s.role]}>{STAFF_ROLE_NAMES[s.role]}</td>}
      <td className="strong">
        <Flag nation={s.nation} /> <span className="player-link" onClick={() => g.selectCoach(s.id)}>{staffName(s)}</span>
        {s.unsettled === true && <span className="staff-tag warn" title="He wanted a move you blocked: he'll want more to stay">Unsettled</span>}
        {s.listed === true && <span className="staff-tag" title="Other clubs have been told he is available">Listed</span>}
        {talks !== null && <span className="staff-tag" title="Contract talks under way">In talks</span>}
      </td>
      <td className="num">{world.year - s.birthYear}</td>
      <td><Rating value={staffRating(s)} /></td>
      <td className="num dim">{money(s.wage)}</td>
      <td className={expiring ? 'warn-text' : 'dim'}>{expiring ? 'This June' : `June ${seasonEndYear(world, ends)}`}</td>
      <td className="num">
        <span className="staff-actions">
          <button className="sm icon-btn" title={talks !== null ? 'Contract talks' : 'Offer a new contract'} onClick={() => g.openStaffTalks(s.id)}><Icon name="contract" size={13} /></button>
          <button className={`sm icon-btn${s.listed === true ? ' on' : ''}`} title={s.listed === true ? 'Take him off the list' : 'Make him available — other clubs will come in for him'}
            onClick={() => g.toggleStaffListed(s.id)}><Icon name="transfers" size={13} /></button>
          <button className="sm icon-btn danger" title="Release him — paying up his contract" onClick={release}><Icon name="close" size={13} /></button>
        </span>
      </td>
    </tr>
  );
}

/** The market for a role: the best first, what each asks, and whether he'd come. */
function StaffMarketTable({ role, employed }: { role: StaffRole; employed: boolean }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const list = g.staffMarket(role, employed);
  if (list.length === 0) return <Empty>{employed ? 'Nobody in this role at other clubs.' : 'Nobody out of work in this role just now — more come onto the market each month.'}</Empty>;
  return (
    <div className="table-wrap">
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
          {list.map(({ s, rating, ask, interest, fee }) => {
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
  );
}
