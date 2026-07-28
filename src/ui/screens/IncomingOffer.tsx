import type { JSX } from 'react';
import { ClubLink, money, MoneyInput } from '../components.tsx';
import { useGame } from '../state.ts';

/**
 * The reverse of NegotiationScreen: another club wants one of ours. Any
 * message shown here is always a rejection of a counter-offer — accepting
 * (outright or via a successful counter) closes the screen and reports the
 * player's decision as a message instead.
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
    <>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        Transfer offer — {store.fullName(n.playerIdx)}
        <button onClick={() => g.declineOffer()}>Give up</button>
      </h2>

      <div className="panel" style={{ maxWidth: 420 }}>
        <div className="kv">
          <span className="k">From</span>
          <span><ClubLink id={buyingClub.id} /></span>
        </div>
        <div className="kv"><span className="k">Offer</span><span>{money(n.fee)}</span></div>
        <div className="kv">
          <span className="k">Market value</span>
          <span>{money(store.value[n.playerIdx])}</span>
        </div>

        <div className="toolbar" style={{ margin: '8px 0' }}>
          <button className="primary" onClick={() => g.acceptOffer()}>Accept</button>
        </div>

        <h3 style={{ marginTop: 14 }}>Counter-offer</h3>
        <div className="kv">
          <span className="k">Your asking price</span>
          <MoneyInput value={n.counterFee} onChange={(v) => g.setCounterFee(v)} />
        </div>
        {n.message !== null && <p className="bad">{n.message}</p>}
        <button onClick={() => g.counterOffer()}>Send counter-offer</button>
      </div>
    </>
  );
}
