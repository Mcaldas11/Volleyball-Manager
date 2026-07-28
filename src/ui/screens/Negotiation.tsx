import type { JSX } from 'react';
import { SQUAD_ROLE_NAMES, SquadRole } from '../../engine/world/negotiation.ts';
import { ClubLink, money, MoneyInput } from '../components.tsx';
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

  return (
    <>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        Negotiate — {store.fullName(player)}
        <button onClick={() => g.cancelNegotiation()}>Cancel</button>
      </h2>

      <div className="panels" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="panel" style={{ minWidth: 240 }}>
          <h3>Player</h3>
          <div className="kv">
            <span className="k">Club</span>
            <span>{sellingClub !== null ? <ClubLink id={sellingClub.id} /> : 'Free agent'}</span>
          </div>
          <div className="kv"><span className="k">Current wage</span><span>{money(store.wage[player])}</span></div>
          <div className="kv"><span className="k">Market value</span><span>{money(store.value[player])}</span></div>
        </div>
      </div>

      {n.stage === 'fee' && sellingClub !== null && (
        <div className="panel" style={{ maxWidth: 420 }}>
          <h3>Transfer fee — {sellingClub.name}</h3>
          <div className="kv">
            <span className="k">Offer</span>
            <MoneyInput value={n.feeOffer} onChange={(v) => g.setFeeOffer(v)} />
          </div>
          <p className="faint" style={{ fontSize: 12 }}>
            Transfer budget: {money(ceiling)}
            {n.feeValuation !== null && <> · They value him around {money(n.feeValuation)}.</>}
          </p>
          {n.feeMessage !== null && <p className="bad">{n.feeMessage}</p>}
          <button className="primary" onClick={() => g.submitFeeOffer()}>Make offer</button>
        </div>
      )}

      {n.stage === 'terms' && (
        <div className="panel" style={{ maxWidth: 420 }}>
          <h3>Personal terms</h3>
          <div className="kv">
            <span className="k">Promised role</span>
            <select
              value={n.termsRole}
              onChange={(e) => g.setTermsRole(Number(e.target.value) as SquadRole)}
            >
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{SQUAD_ROLE_NAMES[r]}</option>)}
            </select>
          </div>
          <div className="kv">
            <span className="k">Annual wage</span>
            <MoneyInput value={n.termsWage} onChange={(v) => g.setTermsWage(v)} />
          </div>
          <p className="faint" style={{ fontSize: 12 }}>
            Current wage: {money(store.wage[player])}
          </p>
          {n.termsMessage !== null && <p className="bad">{n.termsMessage}</p>}
          <button className="primary" onClick={() => g.submitTermsOffer()}>Offer terms</button>
        </div>
      )}
    </>
  );
}
