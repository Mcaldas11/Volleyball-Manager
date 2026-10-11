import type { JSX } from 'react';
import { STAFF_ROLE_NAMES, staffName, staffRating } from '../../engine/model/staff.ts';
import { TALKS_PATIENCE } from '../../engine/world/negotiation.ts';
import { compensationFor } from '../../engine/world/staffMarket.ts';
import { contractEndSeason } from '../../engine/world/world.ts';
import { ClubLink, ContractPaper, ContractRow, money, MoneyInput } from '../components.tsx';
import { Dropdown } from '../dropdown.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

/** Longest contract anyone on the staff signs, in seasons. */
const MAX_STAFF_YEARS = 4;

/**
 * Staff talks, the way the players' go: someone in work at another club is
 * his compensation with that club first, then his terms with him; someone out
 * of work, or one of the club's own to keep, is terms alone. He states his
 * demands up front, and every offer goes off for an answer that comes back
 * days later in the inbox — while other clubs after him make their own.
 */
export function StaffNegotiationScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const n = g.staffNegotiation;
  const t = g.currentStaffTalks();
  const s = t !== null ? world.staff[t.staffId] : undefined;
  if (n === null || t === null || s === undefined) return null;

  const renewal = t.kind === 'renewal';
  const his = !renewal && t.fromClubId >= 0 ? world.clubs[t.fromClubId] : undefined;
  const steps = his !== undefined ? ['Compensation', 'Personal terms'] : [renewal ? 'New contract' : 'Personal terms'];
  const currentStep = t.stage === 'fee' && his !== undefined ? 0 : steps.length - 1;
  const endsLabel = (season: number): string => `30 Jun ${world.startYear + season + 1}`;
  const pending = t.pending;
  const rivals = t.rivals.map((r) => r.clubId).filter((id) => world.clubs[id] !== undefined);
  const name = staffName(s);
  const terms = g.staffTerms(s.id);
  const room = terms?.room ?? 0;
  const portrait = <span className="coach-initials lg">{name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span>;

  const stepper = (
    <div className="contract-steps">
      {steps.map((label, i) => (
        <span key={label} className={`contract-step${i === currentStep ? ' current' : i < currentStep ? ' done' : ''}`}>
          <span className="contract-step-num">{i < currentStep ? <Icon name="check" size={12} /> : i + 1}</span>
          {label}
        </span>
      ))}
    </div>
  );

  const rivalsRow = rivals.length > 0 && (
    <p className="contract-rivals">
      <Icon name="alert" size={14} /> Also after him:
      {rivals.map((id) => <ClubLink key={id} id={id} short />)}
    </p>
  );

  const awaiting = pending !== null && (
    <div className="contract-awaiting">
      <Icon name="clock" size={18} />
      <span>
        <b>Awaiting reply</b> — due {g.dateLabelForDay(pending.resolvesOn)}.
        {' '}{t.stage === 'fee'
          ? `${his?.name ?? 'His club'} are considering ${money(pending.offer.fee)} in compensation.`
          : `He is considering ${money(pending.offer.wage)} a season until ${endsLabel(world.season + pending.offer.years - 1)}.`}
        {' '}Keep playing — the answer will come to your inbox.
      </span>
    </div>
  );

  const message = pending === null && n.message !== null && (
    <p className="contract-note"><Icon name="alert" size={15} /> {n.message}</p>
  );

  const actions = (primary: JSX.Element): JSX.Element => (
    <div className="contract-actions">
      <button className="danger" onClick={() => g.withdrawStaffTalks()}>{renewal ? 'End talks' : 'Withdraw'}</button>
      <span className="flex-spacer" />
      <button onClick={() => g.closeStaffNegotiation()}>Close</button>
      {pending === null && primary}
    </div>
  );

  const paper = (kicker: string, subtitle: string, children: JSX.Element): JSX.Element => (
    <ContractPaper kicker={kicker} title={name} subtitle={subtitle} portrait={portrait} onClose={() => g.closeStaffNegotiation()}>
      {children}
    </ContractPaper>
  );

  if (t.stage === 'fee' && his !== undefined) {
    return paper('Staff approach', `${STAFF_ROLE_NAMES[s.role]} · compensation talks with ${his.name}`, (
      <>
        {stepper}
        <ContractRow label="His club"><ClubLink id={his.id} /></ContractRow>
        <ContractRow label="Rating">{staffRating(s).toFixed(1)} <span className="faint">/ 20</span></ContractRow>
        <ContractRow label="Contract until">{endsLabel(contractEndSeason(s.contractUntil))}</ContractRow>
        <ContractRow label="Current wage">{money(s.wage)}</ContractRow>
        <ContractRow label="Half his contract">{money(compensationFor(world, s))} <span className="faint">· what is left on it, halved — his club may want more</span></ContractRow>
        {rivalsRow}

        {awaiting}
        {pending === null && (
          <div className="contract-offer">
            <ContractRow label="Your offer">
              <MoneyInput value={n.fee} onChange={(v) => g.setStaffFee(v)} />
            </ContractRow>
            <p className="contract-hint">
              The club has {money(Math.max(0, club.finances.balance))}
              {t.valuation !== null && <> · they want around {money(t.valuation)}</>}
              {' '}· staff move any day of the year, with no window to wait for
            </p>
          </div>
        )}
        {message}
        {pending === null && n.message === null && t.reply === 'feeRejected' && (
          <p className="contract-note">
            <Icon name="alert" size={15} />
            <span>They turned down {money(t.lastOffer.fee)}{t.valuation !== null && <> — they want around <b>{money(t.valuation)}</b></>}.</span>
          </p>
        )}

        {actions(<button className="primary" onClick={() => g.submitStaffFee()}>Make approach</button>)}
      </>
    ));
  }

  // Terms. A renewal has to run past the deal he has.
  const d = t.demands;
  const minOption = renewal ? d.minYears : 1;
  const yearOptions: number[] = [];
  for (let y = minOption; y <= Math.max(minOption, MAX_STAFF_YEARS); y++) yearOptions.push(y);
  const demandYears = d.minYears === d.maxYears ? `${d.minYears}` : `${d.minYears}–${d.maxYears}`;
  const demandDates = d.minYears === d.maxYears
    ? endsLabel(world.season + d.minYears - 1)
    : `${endsLabel(world.season + d.minYears - 1)} – ${endsLabel(world.season + d.maxYears - 1)}`;

  return paper(
    renewal ? 'Staff contract renewal' : 'Staff contract',
    renewal ? `${STAFF_ROLE_NAMES[s.role]} · talks over a new deal at ${club.name}`
      : his !== undefined ? `${STAFF_ROLE_NAMES[s.role]} · joining from ${his.name}` : `${STAFF_ROLE_NAMES[s.role]} · out of work`,
    (
      <>
        {stepper}
        <div className="contract-grid">
          <div className="contract-col">
            <h4 className="section-label">{renewal ? 'Current contract' : 'The man'}</h4>
            <ContractRow label="Rating">{staffRating(s).toFixed(1)} <span className="faint">/ 20</span></ContractRow>
            <ContractRow label="Wage">{s.clubId >= 0 ? <>{money(s.wage)} <span className="faint">/ season</span></> : '—'}</ContractRow>
            {s.clubId >= 0 && <ContractRow label="Contract until">{endsLabel(contractEndSeason(s.contractUntil))}</ContractRow>}
            {his !== undefined && <ContractRow label="Compensation"><span className="gold-text">{money(t.agreedFee)}</span></ContractRow>}

            <div className="contract-demands">
              <span className="contract-demands-title"><Icon name="user" size={13} /> His demands</span>
              <ContractRow label="Wage">{money(d.wage)} <span className="faint">/ season</span></ContractRow>
              <ContractRow label="Length">
                <span className="contract-demand-length">
                  {demandYears} season{d.maxYears === 1 ? '' : 's'}
                  <span className="faint">{demandDates}</span>
                </span>
              </ContractRow>
              {pending === null && (
                <button className="sm" onClick={() => g.matchStaffDemands()}>
                  <Icon name="check" size={13} /> Match his demands
                </button>
              )}
            </div>
          </div>

          <div className="contract-col">
            <h4 className="section-label">Your offer</h4>
            {awaiting}
            {pending === null && (
              <>
                <div className="contract-offer">
                  <ContractRow label="Annual wage">
                    <MoneyInput value={n.wage} onChange={(v) => g.setStaffWage(v)} />
                  </ContractRow>
                  <ContractRow label="Contract until">
                    <Dropdown
                      value={n.years}
                      onChange={(v) => g.setStaffYears(v)}
                      options={yearOptions.map((y) => ({
                        value: y, label: endsLabel(world.season + y - 1), hint: `${y} season${y === 1 ? '' : 's'}`,
                      }))}
                    />
                  </ContractRow>
                </div>
                <p className="contract-hint">
                  Room in the staff budget: <b className={room < n.wage ? 'bad' : ''}>{money(Math.max(0, room))}</b>
                </p>
              </>
            )}

            <div className="contract-patience" title="Turned-down offers he will still sit through before walking out">
              <span className="faint">His patience</span>
              <span className="patience-dots">
                {Array.from({ length: TALKS_PATIENCE }, (_, i) => (
                  <span key={i} className={`patience-dot${i < t.patience ? ' on' : ''}${t.patience <= 1 ? ' low' : ''}`} />
                ))}
              </span>
            </div>
            {rivalsRow}

            {message}
            {pending === null && n.message === null && t.reply === 'close' && (
              <p className="contract-note counter">
                <Icon name="press" size={15} />
                <span>Close. He would sign for <b>{money(d.wage)}</b> a season, on a {demandYears}-season deal.</span>
              </p>
            )}
            {pending === null && n.message === null && t.reply === 'far' && (
              <p className="contract-note">
                <Icon name="alert" size={15} />
                <span>That was nowhere near what he wants. He is asking for <b>{money(d.wage)}</b> a season.</span>
              </p>
            )}
          </div>
        </div>

        {actions(<button className="primary" onClick={() => g.submitStaffTerms()}>Offer contract</button>)}
      </>
    ),
  );
}
