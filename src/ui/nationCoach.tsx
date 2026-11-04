/**
 * National teams' coaches and the manager's way in: who coaches a nation and a
 * word to its federation that he would like the job, open or not — and, when an
 * offer comes, its terms to haggle over.
 */

import { useState, type JSX } from 'react';
import {
  nationalCoachName, nationalInterestBlock, nationalLongestTerm, nationalOfferTerms, type NationalOffer,
} from '../engine/world/internationals.ts';
import { NATIONS } from '../engine/world/nations.ts';
import { money, MoneyInput, Segmented } from './components.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

/** The button: tell the federation he is interested — or where that stands. */
export function InterestButton({ nation }: { nation: number }): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const I = world.internationals;
  if (I === undefined) return null;
  if (I.offers.some((o) => o.nation === nation)) return <span className="good">Offer in your inbox</span>;
  const asked = I.applications.find((a) => a.nation === nation);
  if (asked !== undefined) return <span className="faint">Answer by {g.dateLabelForDay(asked.answerOn)}</span>;
  const block = nationalInterestBlock(world, nation);
  if (world.career.nationalTeam === nation) return null;
  return (
    <button className="sm primary" disabled={block !== null} title={block ?? 'Tell the federation you would like the job. If they want you, they will make you an offer.'}
      onClick={() => g.expressNationalInterest(nation)}>
      Show interest
    </button>
  );
}

/** Who coaches a nation, and the button. */
export function NationCoachLine({ nation }: { nation: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const coach = nationalCoachName(world, nation);
  const yours = world.career.nationalTeam === nation;
  return (
    <div className="nat-coach-line">
      <span className="faint">Head coach</span>
      <b>{coach ?? 'Vacant'}</b>
      {yours && <span className="good">You</span>}
      {coach === null && <span className="warn">Looking for a coach</span>}
      <span className="nat-coach-action"><InterestButton nation={nation} /></span>
    </div>
  );
}

/** A federation's offer on the table: the "Negotiate" button, and the talks. */
export function NegotiateNationalOffer({ offer }: { offer: NationalOffer }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [open, setOpen] = useState(false);
  const terms = nationalOfferTerms(world, offer);
  const [wage, setWage] = useState(terms.wage);
  const firstLeft = Math.max(1, terms.untilSeason - world.season + 1);
  const [seasons, setSeasons] = useState(firstLeft);
  const [reply, setReply] = useState<string | null>(null);
  const longest = nationalLongestTerm(world, offer.nation);
  const name = NATIONS[offer.nation]?.name ?? '';
  return (
    <>
      <button className="paper-btn" onClick={() => setOpen(true)}><Icon name="contract" size={15} /> Negotiate</button>
      {open && (
        <div className="hol-overlay" onClick={() => setOpen(false)}>
          <div className="hol-card nat-talks" role="dialog" aria-label="Contract talks" onClick={(e) => e.stopPropagation()}>
            <header className="hol-top">
              <span className="hol-crumbs">{name} <Icon name="chevronRight" size={12} /> <b>Contract talks</b></span>
              <button className="icon-btn" onClick={() => setOpen(false)} title="Close"><Icon name="close" size={16} /></button>
            </header>
            <h2 className="hol-title">{name} · Head Coach</h2>
            <p className="hol-sub">
              On the table: {money(terms.wage)} a season, until June {world.startYear + terms.untilSeason + 1}
            </p>
            <div className="nat-talks-body">
              <label className="nat-talks-row">
                <span>Your wage, a season</span>
                <MoneyInput value={wage} onChange={setWage} />
              </label>
              <div className="nat-talks-row">
                <span>Length</span>
                <Segmented size="sm" value={seasons} onChange={setSeasons}
                  options={[1, 2, 3, 4].map((n) => [n, `${n} ${n === 1 ? 'season' : 'seasons'}`] as const)} />
              </div>
              {seasons > longest && <p className="faint">They are unlikely to sign you for that long.</p>}
              {reply !== null && <p className="nat-talks-reply">{reply}</p>}
            </div>
            <div className="nat-talks-actions">
              <button onClick={() => {
                const r = g.counterNationalOffer(offer.id, wage, world.season + seasons - 1);
                setReply(r.text);
                if (r.outcome === 'withdrawn') setOpen(false);
              }}>
                Make your offer
              </button>
              <button className="primary" onClick={() => { setOpen(false); g.acceptNationalOffer(offer.id); }}>
                <Icon name="check" size={14} /> Sign what is on the table
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
