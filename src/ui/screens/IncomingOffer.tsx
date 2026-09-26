import type { JSX } from 'react';
import { ClubLink, ContractPaper, ContractRow, money, MoneyInput } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

/**
 * The reverse of NegotiationScreen: another club wants one of ours, presented
 * as the bid sheet it is. Nothing is settled here on the spot — an asking
 * price goes off to their board, and an accepted bid leaves the player a few
 * days to decide — so the sheet also shows where a deal in motion stands.
 */
export function IncomingOfferScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const n = g.incomingOffer;
  if (n === null) return null;

  const store = world.players;
  const buyingClub = world.clubs[n.buyingClubId];
  const offer = world.incomingOffers.find((o) => o.id === n.offerId);
  if (buyingClub === undefined) return null;
  const fee = offer?.fee ?? n.fee;
  const status = offer?.status ?? 'open';
  const value = store.value[n.playerIdx];
  const vsValue = value > 0 ? Math.round(((fee - value) / value) * 100) : 0;
  const rivals = world.incomingOffers.filter((o) => o.playerIdx === n.playerIdx && o.id !== n.offerId);

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
        <span className="gold-text">{money(fee)}</span>
        <span className={`contract-delta ${vsValue >= 0 ? 'good' : 'bad'}`}>
          {vsValue >= 0 ? '+' : ''}{vsValue}% vs value
        </span>
      </ContractRow>
      <ContractRow label="Market value">{money(value)}</ContractRow>
      {status === 'open' && <ContractRow label="Expires">{g.dateLabelForDay(n.expiresOnDay)}</ContractRow>}
      {rivals.length > 0 && (
        <p className="contract-rivals">
          <Icon name="offer" size={14} /> Other bids:
          {rivals.map((o) => (
            <span key={o.id} className="contract-rival-bid">
              <ClubLink id={o.buyingClubId} short /> {money(o.fee)}
            </span>
          ))}
        </p>
      )}

      {offer === undefined && <p className="contract-note"><Icon name="alert" size={15} /> This offer is no longer on the table.</p>}
      {status === 'countered' && offer !== undefined && (
        <div className="contract-awaiting">
          <Icon name="clock" size={18} />
          <span>
            <b>Awaiting their answer</b> — due {g.dateLabelForDay(offer.resolvesOn ?? world.day)}. You asked
            {' '}{buyingClub.name} for {money(offer.counterFee ?? fee)}.
          </span>
        </div>
      )}
      {status === 'accepted' && offer !== undefined && (
        <div className="contract-awaiting">
          <Icon name="clock" size={18} />
          <span>
            <b>Fee agreed</b> — {store.fullName(n.playerIdx)} is talking terms with {buyingClub.name} and will decide
            by {g.dateLabelForDay(offer.resolvesOn ?? world.day)}.
          </span>
        </div>
      )}

      {status === 'open' && offer !== undefined && (
        <>
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
        </>
      )}

      <div className="contract-actions">
        {status === 'open' && offer !== undefined
          ? (
            <>
              <button className="danger" onClick={() => g.declineOffer()}>Reject</button>
              <button className="primary" onClick={() => g.acceptOffer()}>Accept offer</button>
            </>
          )
          : <button onClick={() => g.closeOfferView()}>Close</button>}
      </div>
    </ContractPaper>
  );
}
