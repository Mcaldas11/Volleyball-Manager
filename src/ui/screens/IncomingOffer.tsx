import type { JSX } from 'react';
import { ClubLink, ContractPaper, ContractRow, money, MoneyInput } from '../components.tsx';
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

  return (
    <ContractPaper
      kicker="Transfer offer"
      title={store.fullName(n.playerIdx)}
      subtitle={`Bid received from ${buyingClub.name}`}
      onClose={() => g.closeOfferView()}
    >
      <ContractRow label="From"><ClubLink id={buyingClub.id} /></ContractRow>
      <ContractRow label="Offer">{money(n.fee)}</ContractRow>
      <ContractRow label="Market value">{money(store.value[n.playerIdx])}</ContractRow>
      <ContractRow label="Expires">{g.dateLabelForDay(n.expiresOnDay)}</ContractRow>

      <hr className="contract-rule" />

      <ContractRow label="Your asking price">
        <MoneyInput value={n.counterFee} onChange={(v) => g.setCounterFee(v)} />
      </ContractRow>
      {n.message !== null && <p className="contract-note">{n.message}</p>}
      <div className="contract-footer">
        <button onClick={() => g.counterOffer()}>Send counter-offer</button>
      </div>

      <div className="contract-actions">
        <button className="contract-stamp accept" onClick={() => g.acceptOffer()}>Accept</button>
        <button className="contract-stamp reject" onClick={() => g.declineOffer()}>Reject</button>
      </div>
    </ContractPaper>
  );
}
