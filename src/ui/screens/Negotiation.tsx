import type { JSX } from 'react';
import {
  MAX_CONTRACT_YEARS, SQUAD_ROLE_NAMES, SquadRole, TALKS_PATIENCE, yearsLeft,
} from '../../engine/world/negotiation.ts';
import { contractEndSeason } from '../../engine/world/world.ts';
import {
  ClubLink, ContractPaper, ContractRow, money, MoneyInput,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

const ROLE_OPTIONS = (Object.values(SquadRole) as Array<SquadRole | string>)
  .filter((r): r is SquadRole => typeof r === 'number');

/**
 * Contract talks. Signing a player under contract is two steps: a transfer
 * fee with his club, then personal terms with him (free agents skip the fee);
 * keeping one of your own is personal terms alone. The player states his
 * demands up front — wage, role, how long he will sign for — and answers
 * every offer: a near miss draws a counter where he gives a little ground,
 * one far off costs more of his patience, and out of patience he walks out.
 */
export function NegotiationScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const n = g.negotiation;
  if (n === null) return null;

  const store = world.players;
  const player = n.playerIdx;
  const renewal = n.kind === 'renewal';
  const sellingClub = n.sellingClubId >= 0 ? world.clubs[n.sellingClubId] : null;
  const ceiling = Math.min(club.finances.transferBudget, club.finances.balance);
  const steps = sellingClub !== null ? ['Transfer fee', 'Personal terms'] : [renewal ? 'New contract' : 'Personal terms'];
  const currentStep = n.stage === 'fee' && sellingClub !== null ? 0 : steps.length - 1;
  const endsLabel = (season: number): string => `30 Jun ${world.startYear + season + 1}`;
  const txWindow = g.transferWindowStatus();

  const stepper = (
    <div className="contract-steps">
      {steps.map((s, i) => (
        <span key={s} className={`contract-step${i === currentStep ? ' current' : i < currentStep ? ' done' : ''}`}>
          <span className="contract-step-num">{i < currentStep ? <Icon name="check" size={12} /> : i + 1}</span>
          {s}
        </span>
      ))}
    </div>
  );

  if (n.stage === 'fee' && sellingClub !== null) {
    return (
      <ContractPaper
        kicker="Transfer negotiation"
        title={store.fullName(player)}
        subtitle={`Fee talks with ${sellingClub.name}`}
        playerId={store.id[player]}
        onClose={() => g.cancelNegotiation()}
      >
        {stepper}
        <ContractRow label="Selling club"><ClubLink id={sellingClub.id} /></ContractRow>
        <ContractRow label="Contract until">{endsLabel(contractEndSeason(store.contractUntil[player]))}</ContractRow>
        <ContractRow label="Current wage">{money(store.wage[player])}</ContractRow>
        <ContractRow label="Market value">{money(store.value[player])}</ContractRow>

        <div className="contract-offer">
          <ContractRow label="Your offer">
            <MoneyInput value={n.feeOffer} onChange={(v) => g.setFeeOffer(v)} />
          </ContractRow>
          <p className="contract-hint">
            Transfer budget: {money(ceiling)}
            {n.feeValuation !== null && <> · valued around {money(n.feeValuation)}</>}
            {txWindow.open && <> · window closes {g.dateLabelForDay(txWindow.untilDay)}</>}
          </p>
        </div>
        {n.feeMessage !== null && (
          <p className="contract-note"><Icon name="alert" size={15} /> {n.feeMessage}</p>
        )}

        <div className="contract-actions">
          <button className="danger" onClick={() => g.cancelNegotiation()}>Withdraw</button>
          <button className="primary" onClick={() => g.submitFeeOffer()}>Make offer</button>
        </div>
      </ContractPaper>
    );
  }

  // Terms. A renewal has to run past the current deal.
  const minOption = renewal ? yearsLeft(world, player) + 1 : 1;
  const yearOptions: number[] = [];
  for (let y = minOption; y <= Math.max(minOption, MAX_CONTRACT_YEARS); y++) yearOptions.push(y);
  const d = n.demands;
  const demandYears = d.minYears === d.maxYears ? `${d.minYears}` : `${d.minYears}–${d.maxYears}`;
  const demandDates = d.minYears === d.maxYears
    ? endsLabel(world.season + d.minYears - 1)
    : `${endsLabel(world.season + d.minYears - 1)} – ${endsLabel(world.season + d.maxYears - 1)}`;
  let committed = 0;
  for (const p of club.players) committed += store.wage[p];
  if (renewal) committed -= store.wage[player];
  const wageRoom = club.finances.wageBudget - committed;

  return (
    <ContractPaper
      kicker={renewal ? 'Contract renewal' : 'Player contract'}
      title={store.fullName(player)}
      subtitle={renewal
        ? `Talks over a new deal at ${club.name}`
        : sellingClub !== null ? `Signing from ${sellingClub.name}` : 'Signing as a free agent'}
      playerId={store.id[player]}
      onClose={() => g.cancelNegotiation()}
    >
      {stepper}
      <div className="contract-grid">
        <div className="contract-col">
          <h4 className="section-label">{renewal ? 'Current contract' : 'The player'}</h4>
          <ContractRow label="Wage">{money(store.wage[player])} <span className="faint">/ season</span></ContractRow>
          {(renewal || store.clubId[player] >= 0) && (
            <ContractRow label="Contract until">{endsLabel(contractEndSeason(store.contractUntil[player]))}</ContractRow>
          )}
          <ContractRow label="Market value">{money(store.value[player])}</ContractRow>

          <div className="contract-demands">
            <span className="contract-demands-title"><Icon name="user" size={13} /> His demands</span>
            <ContractRow label="Wage">{money(d.wage)} <span className="faint">/ season</span></ContractRow>
            <ContractRow label="Role">{SQUAD_ROLE_NAMES[d.role]}</ContractRow>
            <ContractRow label="Length">
              <span className="contract-demand-length">
                {demandYears} season{d.maxYears === 1 ? '' : 's'}
                <span className="faint">{demandDates}</span>
              </span>
            </ContractRow>
            <button className="sm" onClick={() => g.matchDemands()}>
              <Icon name="check" size={13} /> Match his demands
            </button>
          </div>
        </div>

        <div className="contract-col">
          <h4 className="section-label">Your offer</h4>
          <div className="contract-offer">
            <ContractRow label="Annual wage">
              <MoneyInput value={n.termsWage} onChange={(v) => g.setTermsWage(v)} />
            </ContractRow>
            <ContractRow label="Promised role">
              <select
                value={n.termsRole}
                onChange={(e) => g.setTermsRole(Number(e.target.value) as SquadRole)}
              >
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{SQUAD_ROLE_NAMES[r]}</option>)}
              </select>
            </ContractRow>
            <ContractRow label="Contract until">
              <select value={n.termsYears} onChange={(e) => g.setTermsYears(Number(e.target.value))}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {endsLabel(world.season + y - 1)} · {y} season{y === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </ContractRow>
          </div>
          <p className="contract-hint">
            Room in the wage budget: <b className={wageRoom < n.termsWage ? 'bad' : ''}>{money(wageRoom)}</b>
          </p>

          <div className="contract-patience" title="Rejected offers he will still sit through before walking out">
            <span className="faint">His patience</span>
            <span className="patience-dots">
              {Array.from({ length: TALKS_PATIENCE }, (_, i) => (
                <span key={i} className={`patience-dot${i < n.patience ? ' on' : ''}${n.patience <= 1 ? ' low' : ''}`} />
              ))}
            </span>
          </div>

          {n.termsMessage !== null && (
            <p className="contract-note"><Icon name="alert" size={15} /> {n.termsMessage}</p>
          )}
          {n.termsMessage === null && n.termsReply === 'close' && (
            <p className="contract-note counter">
              <Icon name="press" size={15} />
              <span>
                Close. He would sign for <b>{money(d.wage)}</b> a season as a {SQUAD_ROLE_NAMES[d.role].toLowerCase()},
                on a {demandYears}-season deal.
              </span>
            </p>
          )}
          {n.termsMessage === null && n.termsReply === 'far' && (
            <p className="contract-note">
              <Icon name="alert" size={15} />
              <span>That is nowhere near what he wants. He is asking for <b>{money(d.wage)}</b> a season.</span>
            </p>
          )}
        </div>
      </div>

      <div className="contract-actions">
        <button className="danger" onClick={() => g.cancelNegotiation()}>{renewal ? 'End talks' : 'Withdraw'}</button>
        <button className="primary" onClick={() => g.submitTermsOffer()}>Offer contract</button>
      </div>
    </ContractPaper>
  );
}
