/**
 * One of the manager's players means to retire: who he is, what his career
 * has come to, how much he still has — and the two things the manager can
 * try: talk him into another season, or ask him onto the coaching staff.
 */

import { useState, type JSX } from 'react';
import { POSITION_NAMES, type Position } from '../engine/model/positions.ts';
import { STAFF_ROLE_NAMES, StaffRole } from '../engine/model/staff.ts';
import { SECOND_CAREERS } from '../engine/world/retirement.ts';
import { STAFF_DUTIES } from '../engine/world/staffMarket.ts';
import { NATIONS } from '../engine/world/nations.ts';
import { PlayerFace } from './components.tsx';
import { Dropdown } from './dropdown.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

export function RetirementSheet({ p }: { p: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const plan = g.retirementPlan(p);
  const [role, setRole] = useState<StaffRole>(StaffRole.AssistantCoach);
  const age = store.ageOn(p, world.year, 181);
  const best = Math.round((store.currentAbility[p] / Math.max(1, store.potentialAbility[p])) * 100);
  const ours = store.clubId[p] === world.userClubId;
  // What he has on record — a career that began before the save has none of it yet.
  const tally: Array<[number, string]> = [
    [store.careerMatches[p], 'matches'], [store.careerPoints[p], 'points'], [store.careerTitles[p], 'titles'], [store.nationalCaps[p], 'caps'],
  ];
  const record = tally.filter(([n]) => n > 0).map(([n, what]) => `${n.toLocaleString()} ${what}`);
  const status = plan === undefined ? (store.isActive(p) ? 'He is no longer thinking of stopping.' : 'He has retired.')
    : plan.persuaded === true ? 'You talked him round: he plays on another season.'
      : plan.staffRole !== undefined ? `He stops at the end of the season — and joins your staff as ${STAFF_ROLE_NAMES[plan.staffRole].toLowerCase()}.`
        : plan.talked === 'refused' ? 'You tried to talk him round; his mind is made up.'
          : 'He stops at the end of the season.';
  const canTalk = ours && plan !== undefined && plan.talked === undefined && plan.staffRole === undefined && plan.persuaded !== true;
  const canOffer = ours && plan !== undefined && plan.persuaded !== true && plan.staffRole === undefined && plan.declinedRole !== true;

  return (
    <div className="paper-report retire-sheet">
      <div className="retire-head">
        <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={58} />
        <div>
          <b className="player-link" onClick={() => g.select(p)}>{store.fullName(p)}</b>
          <span>{age} · {POSITION_NAMES[store.position[p] as Position]} · {NATIONS[store.nation[p]]?.name}</span>
          <span>{record.length > 0 ? record.join(' · ') : `Under contract to ${g.longDateLabel(store.contractUntil[p])}`}</span>
        </div>
        <div className="retire-best" title="His ability now against the best he reached">
          <b>{best}%</b>
          <span>of his best</span>
        </div>
      </div>
      <p className="retire-status">{status}</p>
      {plan?.declinedRole === true && plan.staffRole === undefined && <p className="retire-note">He turned down a place on the staff.</p>}

      {canTalk && (
        <div className="retire-option">
          <div>
            <b>One more season?</b>
            <span>A player near his best, who never meant to stop early and trusts you, may listen. You get one conversation.</span>
          </div>
          <button className="paper-btn primary-dark" onClick={() => g.persuadeToPlayOn(p)}>
            <Icon name="press" size={14} /> Talk him round
          </button>
        </div>
      )}
      {canOffer && (
        <div className="retire-option">
          <div>
            <b>A place on your staff</b>
            <span>{STAFF_DUTIES[role]} What he knew as a player becomes what he can teach.</span>
          </div>
          <div className="retire-offer">
            <Dropdown size="sm" value={role} onChange={setRole}
              options={SECOND_CAREERS.map((r) => ({ value: r, label: STAFF_ROLE_NAMES[r] }))} />
            <button className="paper-btn primary-dark" onClick={() => g.offerStaffRole(p, role)}>
              <Icon name="staff" size={14} /> Offer the role
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
