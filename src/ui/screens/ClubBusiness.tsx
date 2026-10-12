/**
 * The club's business: the ticket prices and the sponsor, the facilities and
 * the board's money for them, and the affiliate clubs.
 */

import type { JSX } from 'react';
import type { Position } from '../../engine/model/positions.ts';
import {
  affiliateCandidates, affiliateFee, affiliateProspects, affiliatesOf, MAX_AFFILIATES, proposalBlock,
} from '../../engine/world/affiliates.ts';
import {
  projectedGate, SPONSOR_KIND_NAMES, ticketPriceOf, TICKET_PRICES, type SponsorOffer,
} from '../../engine/world/commercial.ts';
import {
  buildDays, FACILITY_EFFECTS, FACILITY_KINDS, FACILITY_NAMES, facilityLevel, upgradeCost,
} from '../../engine/world/facilities.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { Bar, Card, ClubCrest, ClubLink, Empty, Flag, KV, money, PlayerFace, Pos, StarMeter, StatTile } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

// ---- Tickets and sponsors ----------------------------------------------------------------

export function CommercialScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const price = ticketPriceOf(club);
  const now = projectedGate(world, club, price);
  const homeGames = Math.max(1, (world.competitions[club.leagueId]?.participants.length ?? 12) - 1);
  const offers = world.sponsorOffers?.season === world.season && world.sponsorOffers.clubId === club.id ? world.sponsorOffers : undefined;
  const deal = club.sponsor;

  return (
    <>
      <div className="tiles">
        <StatTile label="Ticket price" value={TICKET_PRICES.find(([p]) => p === price)?.[1] ?? `${Math.round(price * 100)}%`}
          sub={`${Math.round(price * 100)}% of the normal price`} />
        <StatTile label="Crowd" value={now.crowd.toLocaleString()} sub={`of ${club.arenaCapacity.toLocaleString()} seats, on an average night`} />
        <StatTile label="Gate a match" value={money(now.gate)} sub={`about ${money(now.gate * homeGames)} a season`} />
        <StatTile label="Sponsor" value={deal !== undefined ? deal.name : '—'} sub={deal !== undefined ? `${money(deal.base)} a season` : 'no deal signed'} />
      </div>
      <div className="biz-grid">
        <Card title="Ticket prices" icon="coin" flush>
          <p className="biz-note">Cheaper tickets fill the arena; dearer ones take more from fewer people. A club that sells out can charge more.</p>
          <table className="data-table biz-prices">
            <thead><tr><th>Price</th><th className="num">Crowd</th><th className="num">Full</th><th className="num">Gate a match</th><th /></tr></thead>
            <tbody>
              {TICKET_PRICES.map(([p, label]) => {
                const at = projectedGate(world, club, p);
                return (
                  <tr key={p} className={p === price ? 'me' : ''}>
                    <td className="strong">{label} <span className="faint">{Math.round(p * 100)}%</span></td>
                    <td className="num">{at.crowd.toLocaleString()}</td>
                    <td className="num dim">{Math.round((at.crowd / Math.max(1, club.arenaCapacity)) * 100)}%</td>
                    <td className="num">{money(at.gate)}</td>
                    <td className="num">
                      {p === price ? <span className="faint">Now</span> : <button className="sm" onClick={() => g.setTicketPrice(p)}>Set</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Shirt sponsor" icon="contract">
          {deal !== undefined && (
            <div className="biz-deal">
              <b>{deal.name}</b>
              <span className="faint">{SPONSOR_KIND_NAMES[deal.kind]} · until 30 June {world.startYear + deal.untilSeason + 1}</span>
              <KV k="A season">{money(deal.base)}</KV>
              {deal.titleBonus > 0 && <KV k="Title bonus">{money(deal.titleBonus)}</KV>}
              {deal.podiumBonus > 0 && <KV k="Top-three bonus">{money(deal.podiumBonus)}</KV>}
            </div>
          )}
          {deal === undefined && offers !== undefined && offers.chosen === undefined && (
            <div className="biz-offers">
              {offers.offers.map((o, i) => <SponsorCard key={o.name} offer={o} onSign={() => g.chooseSponsor(i)} />)}
            </div>
          )}
          {deal === undefined && (offers === undefined || offers.chosen !== undefined) && (
            <Empty>The offers for the season come in shortly.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}

function SponsorCard({ offer, onSign }: { offer: SponsorOffer; onSign: () => void }): JSX.Element {
  return (
    <div className="biz-offer">
      <span className="biz-offer-kind">{SPONSOR_KIND_NAMES[offer.kind]}</span>
      <b>{offer.name}</b>
      <KV k="A season">{money(offer.base)}</KV>
      {offer.titleBonus > 0 && <KV k="Title bonus">{money(offer.titleBonus)}</KV>}
      {offer.podiumBonus > 0 && <KV k="Top three">{money(offer.podiumBonus)}</KV>}
      <KV k="Length">{offer.seasons} season{offer.seasons > 1 ? 's' : ''}</KV>
      <button className="primary sm" onClick={onSign}><Icon name="contract" size={13} /> Sign</button>
    </div>
  );
}

// ---- Facilities -------------------------------------------------------------------------

function levelWord(v: number): string {
  return v >= 18 ? 'State of the art' : v >= 15 ? 'Excellent' : v >= 12 ? 'Good' : v >= 9 ? 'Adequate' : v >= 6 ? 'Basic' : 'Poor';
}

export function FacilitiesScreen(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const project = club.facilityProject;
  return (
    <>
      <div className="tiles">
        <StatTile label="Balance" value={money(club.finances.balance)} tone={club.finances.balance < 0 ? 'bad' : undefined} sub="what the board has to spend" />
        <StatTile label="Board confidence" value={`${Math.round(club.boardConfidence)}%`} tone={club.boardConfidence < 40 ? 'warn' : undefined}
          sub={club.boardConfidence < 40 ? 'too low to spend on you' : 'enough to ask'} />
        <StatTile label="Project" value={project === undefined ? 'None' : FACILITY_NAMES[project.kind]}
          sub={project === undefined ? 'one at a time' : project.stage === 'asked' ? `the board answers by ${g.dateLabelForDay(project.until)}` : `done ${g.dateLabelForDay(project.until)}`} />
      </div>
      <div className="biz-facilities">
        {FACILITY_KINDS.map((kind) => {
          const level = facilityLevel(club, kind);
          const block = g.upgradeBlock(kind);
          const mine = project?.kind === kind;
          return (
            <Card key={kind} title={FACILITY_NAMES[kind]} icon="club">
              <div className="biz-level">
                <b>{level}</b><span className="faint">/ 20</span>
                <span className="biz-level-word">{levelWord(level)}</span>
              </div>
              <Bar value={(level / 20) * 100} wide />
              <p className="biz-note">{FACILITY_EFFECTS[kind]}</p>
              {level < 20 && <KV k="Next level">{money(upgradeCost(club, kind))} · about {Math.round(buildDays(club, kind) / 30)} months' work</KV>}
              {mine && project !== undefined && (
                <p className="biz-status">{project.stage === 'asked' ? `With the board — answer by ${g.dateLabelForDay(project.until)}` : `Being built — done ${g.dateLabelForDay(project.until)}`}</p>
              )}
              <div className="biz-foot">
                <button className="sm" disabled={block !== null} title={block ?? 'Ask the board to pay for it'} onClick={() => g.requestUpgrade(kind)}>
                  <Icon name="board" size={13} /> Request upgrade
                </button>
                {block !== null && !mine && <span className="faint biz-why">{block}</span>}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="footnote">The board says yes if the club has well over the cost in the bank and they trust you. Upkeep rises a little with each level.</p>
    </>
  );
}

// ---- Affiliates -------------------------------------------------------------------------

export function AffiliatesScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const mine = affiliatesOf(world, club);
  const candidates = affiliateCandidates(world, club);
  const pending = new Set((world.affiliateTalks ?? []).map((t) => t.clubId));
  return (
    <div className="biz-affiliates">
      <Card title={`Your affiliates (${mine.length}/${MAX_AFFILIATES})`} icon="club" flush className="biz-aff-card">
        {mine.length === 0 && <Empty>No affiliates yet. Smaller clubs will take your young players on loan and play them — and let theirs come to you cheaply.</Empty>}
        <div className="biz-aff-list">
          {mine.map((a) => {
            const comp = world.competitions[a.leagueId];
            return (
              <div key={a.id} className="biz-aff">
                <div className="biz-aff-head">
                  <ClubCrest club={a} size={34} />
                  <div>
                    <ClubLink id={a.id} crest={false} />
                    <span className="faint"><Flag nation={a.nation} /> {comp?.name ?? '—'} · {money(affiliateFee(club))} a season</span>
                  </div>
                  <button className="sm danger" onClick={() => g.endAffiliation(a.id)}>End</button>
                </div>
                <span className="section-label">Their best young players — a quarter off for you</span>
                {affiliateProspects(world, a).map((p) => (
                  <div key={p} className="biz-prospect">
                    <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={24} />
                    <span className="player-link" onClick={() => g.select(p)}>{store.fullName(p)}</span>
                    <Pos pos={store.position[p] as Position} />
                    <span className="faint">{store.ageOn(p, world.year, 181)}</span>
                    <StarMeter value={store.potentialAbility[p]} size={11} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Find an affiliate" icon="search" flush className="biz-aff-card">
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Club</th><th>Nation</th><th className="num">Tier</th><th>Standing</th><th /></tr></thead>
            <tbody>
              {candidates.map((c) => {
                const block = proposalBlock(world, club, c);
                return (
                  <tr key={c.id}>
                    <td className="strong"><ClubLink id={c.id} /></td>
                    <td className="dim"><Flag nation={c.nation} /> {NATIONS[c.nation]?.name}</td>
                    <td className="num dim">{c.tier}</td>
                    <td><StarMeter value={c.reputation} max={10000} size={11} /></td>
                    <td className="num">
                      {pending.has(c.id)
                        ? <span className="faint">Considering</span>
                        : <button className="sm" disabled={block !== null} title={block ?? 'Propose an affiliation'} onClick={() => g.proposeAffiliation(c.id)}>Propose</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
