import type { JSX } from 'react';
import {
  LOAN_PLAYING_TIMES, LOAN_WAGE_SHARES, PLAYING_TIME_NAMES, PLAYING_TIME_SHARE,
} from '../../engine/world/loans.ts';
import {
  EXPECTED_APPS, MAX_CONTRACT_YEARS, SQUAD_ROLE_NAMES, SquadRole, TALKS_PATIENCE, yearsLeft,
} from '../../engine/world/negotiation.ts';
import { AGENT_STYLE_NAMES, agentOf, agentPatience } from '../../engine/world/contractTerms.ts';
import { smallPrintLine } from '../../engine/world/deals.ts';
import { contractEndSeason } from '../../engine/world/world.ts';
import {
  ClubLink, ContractPaper, ContractRow, money, MoneyInput,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { Dropdown } from '../dropdown.tsx';

const ROLE_OPTIONS = (Object.values(SquadRole) as Array<SquadRole | string>)
  .filter((r): r is SquadRole => typeof r === 'number');

/**
 * Contract talks. Signing a player under contract is two steps: a transfer
 * fee with his club, then personal terms with him (free agents skip the fee);
 * keeping one of your own is personal terms alone; borrowing one is a single
 * question to his club — how much of his wage you will pay until the end of
 * the season. The player states his demands up front. Every offer goes off
 * for an answer that comes back days later in the inbox — while other clubs
 * chasing him make their own offers.
 */
export function NegotiationScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const n = g.negotiation;
  const t = g.currentTalks();
  if (n === null || t === null) return null;

  const store = world.players;
  const player = t.playerIdx;
  const renewal = t.kind === 'renewal';
  const sellingClub = !renewal && t.sellingClubId >= 0 ? world.clubs[t.sellingClubId] ?? null : null;
  const ceiling = Math.min(club.finances.transferBudget, club.finances.balance);
  const steps = sellingClub !== null ? ['Transfer fee', 'Personal terms'] : [renewal ? 'New contract' : 'Personal terms'];
  const currentStep = t.stage === 'fee' && sellingClub !== null ? 0 : steps.length - 1;
  const endsLabel = (season: number): string => `30 Jun ${world.startYear + season + 1}`;
  const txWindow = g.transferWindowStatus();
  // Talks run all year, but a player under contract only moves in a window:
  // agreed now, he joins on this day — and his contract counts from that season.
  const joinDay = g.joinDay(player);
  const joinsLater = !renewal && joinDay > world.day;
  const startSeason = renewal ? world.season : g.joinSeason(player);
  const windowHint = txWindow.open
    ? <> · window closes {g.dateLabelForDay(txWindow.untilDay)}</>
    : <> · window shut: {t.kind === 'loan' ? 'the loan would start' : 'he would join'} on {g.dateLabelForDay(joinDay)}</>;
  const pending = t.pending;
  const rivals = t.rivals.map((r) => r.clubId).filter((id) => world.clubs[id] !== undefined);
  const clause = !renewal ? g.releaseClause(player) : null;
  const agent = agentOf(world, player);

  const stepper = steps.length > 1 && (
    <div className="contract-steps">
      {steps.map((s, i) => (
        <span key={s} className={`contract-step${i === currentStep ? ' current' : i < currentStep ? ' done' : ''}`}>
          <span className="contract-step-num">{i < currentStep ? <Icon name="check" size={12} /> : i + 1}</span>
          {s}
        </span>
      ))}
    </div>
  );

  const rivalsRow = rivals.length > 0 && (
    <p className="contract-rivals">
      <Icon name="alert" size={14} /> Also after him:
      {rivals.map((id) => <ClubLink key={id} id={id} short />)}
    </p>
  );

  const awaiting = pending !== null && (
    <div className="contract-awaiting">
      <Icon name="clock" size={18} />
      <span>
        <b>Awaiting reply</b> — due {g.dateLabelForDay(pending.resolvesOn)}.
        {' '}{t.kind === 'loan'
          ? `${sellingClub?.name ?? 'The club'} are considering lending him, with you paying ` +
            `${Math.round((pending.offer.wageShare ?? 0.5) * 100)}% of his wage and promising playing time as a ` +
            `${PLAYING_TIME_NAMES[pending.offer.playingTime ?? 'rotation'].toLowerCase()}.`
          : t.stage === 'fee'
            ? `${sellingClub?.name ?? 'The club'} are considering your bid of ${money(pending.offer.fee)}.`
            : `${renewal ? 'He is' : 'He and his agent are'} considering ${money(pending.offer.wage)} a season until ${endsLabel(startSeason + pending.offer.years - 1)}. ${smallPrintLine(pending.offer)}`}
        {' '}Keep playing — the answer will come to your inbox.
      </span>
    </div>
  );

  const actions = (primary: JSX.Element): JSX.Element => (
    <div className="contract-actions">
      <button className="danger" onClick={() => g.withdrawTalks()}>{renewal ? 'End talks' : 'Withdraw'}</button>
      <span className="flex-spacer" />
      <button onClick={() => g.cancelNegotiation()}>Close</button>
      {pending === null && primary}
    </div>
  );

  if (t.kind === 'loan' && sellingClub !== null) {
    const wage = store.wage[player];
    const cost = Math.round(wage * n.loanShare);
    const wageRoom = g.wageRoom();
    return (
      <ContractPaper
        kicker="Loan request"
        title={store.fullName(player)}
        subtitle={`Loan talks with ${sellingClub.name}`}
        playerId={store.id[player]}
        onClose={() => g.cancelNegotiation()}
      >
        <ContractRow label="His club"><ClubLink id={sellingClub.id} /></ContractRow>
        <ContractRow label="Contract until">{endsLabel(contractEndSeason(store.contractUntil[player]))}</ContractRow>
        <ContractRow label="Wage">{money(wage)} <span className="faint">/ season</span></ContractRow>
        <ContractRow label="Loan">
          {joinsLater && <>{g.dateLabelForDay(joinDay)} – </>}{endsLabel(startSeason)}
          <span className="faint"> · {joinsLater ? 'from when the window opens' : 'to'} the end of the season</span>
        </ContractRow>

        {awaiting}
        {pending === null && (
          <div className="contract-offer">
            <ContractRow label="Playing time">
              <Dropdown
                value={n.loanPlayingTime}
                onChange={(v) => g.setLoanPlayingTime(v)}
                options={LOAN_PLAYING_TIMES.map((pt) => ({
                  value: pt, label: PLAYING_TIME_NAMES[pt], hint: `about ${Math.round(PLAYING_TIME_SHARE[pt] * 100)}% of the play`,
                }))}
              />
            </ContractRow>
            <ContractRow label="You pay">
              <Dropdown
                value={n.loanShare}
                onChange={(v) => g.setLoanShare(v)}
                options={LOAN_WAGE_SHARES.map((s) => ({
                  value: s, label: `${Math.round(s * 100)}% of his wage`, hint: money(Math.round(wage * s)),
                }))}
              />
            </ContractRow>
            <p className="contract-hint">
              {sellingClub.shortName} pay the rest: {money(wage - cost)} · Room in the wage budget:{' '}
              <b className={wageRoom < cost ? 'bad' : ''}>{money(wageRoom)}</b>
              {windowHint}
            </p>
            <p className="contract-hint">
              Clubs lend players to see them play: promising more games makes a yes likelier, especially for a young
              player. Keep your promise — fall well short and {sellingClub.shortName} will complain, then recall him.
            </p>
          </div>
        )}
        {pending === null && n.message !== null && (
          <p className="contract-note"><Icon name="alert" size={15} /> {n.message}</p>
        )}
        {pending === null && n.message === null && t.reply === 'feeRejected' && (
          <p className="contract-note">
            <Icon name="alert" size={15} />
            <span>
              They turned down lending him with you paying {Math.round((t.lastOffer.wageShare ?? 0.5) * 100)}% of his
              wage. Offering to cover more of it is the surest way to change their mind.
            </span>
          </p>
        )}

        {actions(<button className="primary" onClick={() => g.submitLoanRequest()}>Request loan</button>)}
      </ContractPaper>
    );
  }

  if (t.stage === 'fee' && sellingClub !== null) {
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
        {t.rivalBid !== undefined && (
          <ContractRow label="Rival bid">
            <span className="warn-text">{money(t.rivalBid.fee)}</span>
            <span className="faint">
              <ClubLink id={t.rivalBid.clubId} short /> · beat it by {g.dateLabelForDay(t.rivalBid.until)}
            </span>
          </ContractRow>
        )}
        {clause !== null && (
          <ContractRow label="Release clause">
            <span className="gold-text">{money(clause)}</span>
            {pending === null && (
              <button
                className="sm"
                disabled={clause > ceiling}
                title={clause > ceiling ? 'More than your transfer budget' : 'Bid the clause: his club cannot refuse it'}
                onClick={() => g.payReleaseClause()}
              >
                Pay the clause
              </button>
            )}
          </ContractRow>
        )}
        {rivalsRow}

        {awaiting}
        {pending === null && (
          <div className="contract-offer">
            <ContractRow label="Your bid">
              <MoneyInput value={n.feeOffer} onChange={(v) => g.setFeeOffer(v)} />
            </ContractRow>
            <p className="contract-hint">
              Transfer budget: {money(ceiling)}
              {t.valuation !== null && <> · valued around {money(t.valuation)}</>}
              {windowHint}
            </p>
          </div>
        )}
        {pending === null && n.message !== null && (
          <p className="contract-note"><Icon name="alert" size={15} /> {n.message}</p>
        )}
        {pending === null && n.message === null && t.reply === 'feeRejected' && (
          <p className="contract-note">
            <Icon name="alert" size={15} />
            <span>They turned down {money(t.lastOffer.fee)}{t.valuation !== null && <> — they value him at around <b>{money(t.valuation)}</b></>}.</span>
          </p>
        )}

        {actions(<button className="primary" onClick={() => g.submitFeeOffer()}>Make bid</button>)}
      </ContractPaper>
    );
  }

  // Terms. A renewal has to run past the current deal.
  const minOption = renewal ? yearsLeft(world, player) + 1 : 1;
  const yearOptions: number[] = [];
  for (let y = minOption; y <= Math.max(minOption, MAX_CONTRACT_YEARS); y++) yearOptions.push(y);
  const d = t.demands;
  const demandYears = d.minYears === d.maxYears ? `${d.minYears}` : `${d.minYears}–${d.maxYears}`;
  const demandDates = d.minYears === d.maxYears
    ? endsLabel(startSeason + d.minYears - 1)
    : `${endsLabel(startSeason + d.minYears - 1)} – ${endsLabel(startSeason + d.maxYears - 1)}`;
  // A renewal's new wage replaces what he earns now.
  const wageRoom = g.wageRoom() + (renewal ? store.wage[player] : 0);

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
      {(stepper !== false || rivals.length > 0) && <div className="contract-steps-row">{stepper}{rivalsRow}</div>}
      <div className="contract-grid">
        <div className="contract-col">
          <h4 className="section-label">{renewal ? 'Current contract' : 'The player'}</h4>
          <ContractRow label="Wage">{money(store.wage[player])} <span className="faint">/ season</span></ContractRow>
          {(renewal || store.clubId[player] >= 0) && (
            <ContractRow label="Contract until">{endsLabel(contractEndSeason(store.contractUntil[player]))}</ContractRow>
          )}
          {sellingClub !== null
            ? <ContractRow label="Agreed fee"><span className="gold-text">{money(t.agreedFee)}</span></ContractRow>
            : <ContractRow label="Market value">{money(store.value[player])}</ContractRow>}
          <ContractRow label="Agent">
            <span className="contract-agent" title={agent.agency}>
              {agent.name}
              <span className={`faint${agent.style === 'hardball' ? ' warn' : ''}`}>{AGENT_STYLE_NAMES[agent.style]}</span>
            </span>
          </ContractRow>

          <div className="contract-demands">
            <div className="contract-demands-head">
              <span className="contract-demands-title"><Icon name="user" size={13} /> His demands</span>
              {/* His last answer: what is shown is where he stands now. */}
              {pending === null && t.reply === 'close' && <span className="contract-reply close">Close — he would sign for this</span>}
              {pending === null && t.reply === 'far' && <span className="contract-reply far">Nowhere near — this is what he wants</span>}
            </div>
            <ContractRow label="Wage">{money(d.wage)} <span className="faint">/ season</span></ContractRow>
            <ContractRow label="Role">{SQUAD_ROLE_NAMES[d.role]}</ContractRow>
            <ContractRow label="Length">
              <span className="contract-demand-length">
                {demandYears} season{d.maxYears === 1 ? '' : 's'}
                <span className="faint">{demandDates}</span>
              </span>
            </ContractRow>
            <ContractRow label="Agent's fee">{money(d.agentFee ?? 0)} <span className="faint">on signing</span></ContractRow>
            <ContractRow label="Release clause">
              {d.clauseMax !== undefined && d.clauseMax !== null
                ? <>At most {money(d.clauseMax)}</>
                : <span className="faint">Not asked for</span>}
            </ContractRow>
            {pending === null && (
              <button className="sm" onClick={() => g.matchDemands()}>
                <Icon name="check" size={13} /> Match his demands
              </button>
            )}
          </div>
        </div>

        <div className="contract-col">
          <h4 className="section-label">Your offer</h4>
          {awaiting}
          {pending === null && (
            <>
              <div className="contract-offer">
                <ContractRow label="Annual wage">
                  <MoneyInput value={n.termsWage} onChange={(v) => g.setTermsWage(v)} />
                </ContractRow>
                <ContractRow label="Promised role">
                  <Dropdown
                    value={n.termsRole}
                    onChange={(v) => g.setTermsRole(v)}
                    options={ROLE_OPTIONS.map((r) => ({ value: r, label: SQUAD_ROLE_NAMES[r] }))}
                  />
                </ContractRow>
                <ContractRow label="Contract until">
                  <label
                    className={`contract-option${n.termsYears >= MAX_CONTRACT_YEARS ? ' disabled' : ''}`}
                    title={n.termsYears >= MAX_CONTRACT_YEARS
                      ? 'Not on a five-season deal'
                      : 'The club may add one more season on the same terms — yours to take up by 1 May of the last season'}
                  >
                    <input
                      type="checkbox"
                      checked={n.termsOption}
                      disabled={n.termsYears >= MAX_CONTRACT_YEARS}
                      onChange={(e) => g.setSmallPrint({ termsOption: e.target.checked })}
                    />
                    +1 option
                  </label>
                  <Dropdown
                    value={n.termsYears}
                    onChange={(v) => g.setTermsYears(v)}
                    options={yearOptions.map((y) => ({
                      value: y, label: endsLabel(startSeason + y - 1), hint: `${y} season${y === 1 ? '' : 's'}`,
                    }))}
                  />
                </ContractRow>
              </div>
              <div className="contract-print">
                <span className="contract-demands-title"><Icon name="contract" size={13} /> The small print</span>
                <div className="contract-print-grid">
                  <div className="contract-print-cell">
                    <span>Appearance bonus</span>
                    <MoneyInput value={n.termsAppearance} onChange={(v) => g.setSmallPrint({ termsAppearance: v })} />
                    <small>a match · ~{EXPECTED_APPS[n.termsRole]} a season</small>
                  </div>
                  <div className="contract-print-cell">
                    <span>Title bonus</span>
                    <MoneyInput value={n.termsTitleBonus} onChange={(v) => g.setSmallPrint({ termsTitleBonus: v })} />
                    <small>for each trophy won</small>
                  </div>
                  <div className="contract-print-cell">
                    <span>Release clause</span>
                    <MoneyInput value={n.termsClause} onChange={(v) => g.setSmallPrint({ termsClause: v })} />
                    <small>
                      {n.termsClause > 0
                        ? `${(n.termsClause / Math.max(1, store.value[player])).toFixed(1)}× his value`
                        : 'none'}
                    </small>
                  </div>
                  <div className="contract-print-cell">
                    <span>Agent's fee</span>
                    <MoneyInput value={n.termsAgentFee} onChange={(v) => g.setSmallPrint({ termsAgentFee: v })} />
                    <small>paid on signing</small>
                  </div>
                </div>
              </div>
              <p className="contract-hint">
                Room in the wage budget: <b className={wageRoom < n.termsWage ? 'bad' : ''}>{money(wageRoom)}</b>
                {joinsLater && <> · the window is shut: he joins on {g.dateLabelForDay(joinDay)}</>}
              </p>
            </>
          )}

          <div className="contract-patience" title="Rejected offers he will still sit through before walking out">
            <span className="faint">His patience</span>
            <span className="patience-dots">
              {Array.from({ length: Math.max(t.patience, renewal || t.kind === 'transfer' ? agentPatience(agent.style) : TALKS_PATIENCE) }, (_, i) => (
                <span key={i} className={`patience-dot${i < t.patience ? ' on' : ''}${t.patience <= 1 ? ' low' : ''}`} />
              ))}
            </span>
          </div>

          {pending === null && n.message !== null && (
            <p className="contract-note"><Icon name="alert" size={15} /> {n.message}</p>
          )}
        </div>
      </div>

      {actions(<button className="primary" onClick={() => g.submitTermsOffer()}>Offer contract</button>)}
    </ContractPaper>
  );
}
