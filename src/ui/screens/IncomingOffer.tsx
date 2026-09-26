import type { JSX } from 'react';
import { ClubLink, ContractPaper, ContractRow, money, MoneyInput } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

/**
 * The reverse of NegotiationScreen: another club wants one of ours, presented
 * as the bid sheet it is. Any message shown here is always a rejection of a
 * counter-offer — accepting (outright or via a successful counter) closes the
 * screen and reports the player's decision as a message instead.
 */
export function IncomingOfferScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const n = g.incomingOffer;
  if (n === null) return null;

  const store = world.players;
  const buyingClub = world.clubs[n.buyingClubId];
  if (buyingClub === undefined) return null;
  const value = store.value[n.playerIdx];
  const vsValue = value > 0 ? Math.round(((n.fee - value) / value) * 100) : 0;

  return (
    <ContractPaper
      kicker="Transfer offer"
      title={store.fullName(n.playerIdx)}
      subtitle={`Bid received from ${buyingClub.name}`}
      playerId={store.id[n.playerIdx]}
      onClose={() => g.closeOfferView()}
    >
      <ContractRow label="From"><ClubLink id={buyingClub.id} /></ContractRow>
      <ContractRow label="Offer">
        <span className="gold-text">{money(n.fee)}</span>
        <span className={`contract-delta ${vsValue >= 0 ? 'good' : 'bad'}`}>
          {vsValue >= 0 ? '+' : ''}{vsValue}% vs value
        </span>
      </ContractRow>
      <ContractRow label="Market value">{money(value)}</ContractRow>
      <ContractRow label="Expires">{g.dateLabelForDay(n.expiresOnDay)}</ContractRow>

      <div className="contract-offer">
        <ContractRow label="Your asking price">
          <MoneyInput value={n.counterFee} onChange={(v) => g.setCounterFee(v)} />
        </ContractRow>
        <div className="contract-footer">
          <button className="accent" onClick={() => g.counterOffer()}>
            <Icon name="transfers" size={14} /> Send counter-offer
          </button>
        </div>
      </div>
      {n.message !== null && <p className="contract-note"><Icon name="alert" size={15} /> {n.message}</p>}

      <div className="contract-actions">
        <button className="danger" onClick={() => g.declineOffer()}>Reject</button>
        <button className="primary" onClick={() => g.acceptOffer()}>Accept offer</button>
      </div>
    </ContractPaper>
  );
}
