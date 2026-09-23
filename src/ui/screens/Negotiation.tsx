import type { JSX } from 'react';
import { SQUAD_ROLE_NAMES, SquadRole } from '../../engine/world/negotiation.ts';
import {
  ClubLink, ContractPaper, ContractRow, money, MoneyInput,
} from '../components.tsx';
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

  if (n.stage === 'fee' && sellingClub !== null) {
    return (
      <ContractPaper
        kicker="Transfer negotiation"
        title={store.fullName(player)}
        subtitle={`Fee talks with ${sellingClub.name}`}
        onClose={() => g.cancelNegotiation()}
      >
        <ContractRow label="Selling club"><ClubLink id={sellingClub.id} /></ContractRow>
        <ContractRow label="Current wage">{money(store.wage[player])}</ContractRow>
        <ContractRow label="Market value">{money(store.value[player])}</ContractRow>

        <hr className="contract-rule" />

        <ContractRow label="Your offer">
          <MoneyInput value={n.feeOffer} onChange={(v) => g.setFeeOffer(v)} />
        </ContractRow>
        <p className="contract-note" style={{ fontStyle: 'normal', color: '#6b5c38' }}>
          Transfer budget: {money(ceiling)}
          {n.feeValuation !== null && <> · valued around {money(n.feeValuation)}</>}
        </p>
        {n.feeMessage !== null && <p className="contract-note">{n.feeMessage}</p>}

        <div className="contract-actions">
          <button className="contract-stamp accept" onClick={() => g.submitFeeOffer()}>Make offer</button>
          <button className="contract-stamp reject" onClick={() => g.cancelNegotiation()}>Withdraw</button>
        </div>
      </ContractPaper>
    );
  }

  return (
    <ContractPaper
      kicker="Player contract"
      title={store.fullName(player)}
      subtitle={sellingClub !== null ? `Signing from ${sellingClub.name}` : 'Signing as a free agent'}
      onClose={() => g.cancelNegotiation()}
    >
      <ContractRow label="Current wage">{money(store.wage[player])}</ContractRow>
      <ContractRow label="Market value">{money(store.value[player])}</ContractRow>

      <hr className="contract-rule" />

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
      {n.termsMessage !== null && <p className="contract-note">{n.termsMessage}</p>}

      <div className="contract-actions">
        <button className="contract-stamp accept" onClick={() => g.submitTermsOffer()}>Offer terms</button>
        <button className="contract-stamp reject" onClick={() => g.cancelNegotiation()}>Withdraw</button>
      </div>
    </ContractPaper>
  );
}
