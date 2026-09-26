import type { JSX } from 'react';
import { SQUAD_ROLE_NAMES, SquadRole } from '../../engine/world/negotiation.ts';
import {
  ClubLink, ContractPaper, ContractRow, money, MoneyInput,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

const ROLE_OPTIONS = (Object.values(SquadRole) as Array<SquadRole | string>)
  .filter((r): r is SquadRole => typeof r === 'number');

/**
 * A two-step conversation: a transfer fee with the selling club (skipped for
 * free agents), then personal terms with the player. Any message shown here
 * is always a rejection — acceptance either advances the stage or closes the
 * negotiation entirely, so there is nothing ambiguous left to colour.
 */
export function NegotiationScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const n = g.negotiation;
  if (n === null) return null;

  const store = world.players;
  const player = n.playerIdx;
  const sellingClub = n.sellingClubId >= 0 ? world.clubs[n.sellingClubId] : null;
  const ceiling = Math.min(club.finances.transferBudget, club.finances.balance);
  const steps = sellingClub !== null ? ['Transfer fee', 'Personal terms'] : ['Personal terms'];
  const currentStep = n.stage === 'fee' && sellingClub !== null ? 0 : steps.length - 1;

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
        <ContractRow label="Current wage">{money(store.wage[player])}</ContractRow>
        <ContractRow label="Market value">{money(store.value[player])}</ContractRow>

        <div className="contract-offer">
          <ContractRow label="Your offer">
            <MoneyInput value={n.feeOffer} onChange={(v) => g.setFeeOffer(v)} />
          </ContractRow>
          <p className="contract-hint">
            Transfer budget: {money(ceiling)}
            {n.feeValuation !== null && <> · valued around {money(n.feeValuation)}</>}
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

  return (
    <ContractPaper
      kicker="Player contract"
      title={store.fullName(player)}
      subtitle={sellingClub !== null ? `Signing from ${sellingClub.name}` : 'Signing as a free agent'}
      playerId={store.id[player]}
      onClose={() => g.cancelNegotiation()}
    >
      {stepper}
      <ContractRow label="Current wage">{money(store.wage[player])}</ContractRow>
      <ContractRow label="Market value">{money(store.value[player])}</ContractRow>

      <div className="contract-offer">
        <ContractRow label="Promised role">
          <select
            value={n.termsRole}
            onChange={(e) => g.setTermsRole(Number(e.target.value) as SquadRole)}
          >
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{SQUAD_ROLE_NAMES[r]}</option>)}
          </select>
        </ContractRow>
        <ContractRow label="Annual wage">
          <MoneyInput value={n.termsWage} onChange={(v) => g.setTermsWage(v)} />
        </ContractRow>
      </div>
      {n.termsMessage !== null && (
        <p className="contract-note"><Icon name="alert" size={15} /> {n.termsMessage}</p>
      )}

      <div className="contract-actions">
        <button className="danger" onClick={() => g.cancelNegotiation()}>Withdraw</button>
        <button className="primary" onClick={() => g.submitTermsOffer()}>Offer terms</button>
      </div>
    </ContractPaper>
  );
}
