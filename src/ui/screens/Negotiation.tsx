import type { JSX } from 'react';
import {
  LOAN_PLAYING_TIMES, LOAN_WAGE_SHARES, PLAYING_TIME_NAMES, PLAYING_TIME_SHARE, type LoanPlayingTime,
} from '../../engine/world/loans.ts';
import {
  MAX_CONTRACT_YEARS, SQUAD_ROLE_NAMES, SquadRole, TALKS_PATIENCE, yearsLeft,
} from '../../engine/world/negotiation.ts';
import { contractEndSeason } from '../../engine/world/world.ts';
import {
  ClubLink, ContractPaper, ContractRow, money, MoneyInput,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

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
            : `${renewal ? 'He is' : 'He and his agent are'} considering ${money(pending.offer.wage)} a season until ${endsLabel(startSeason + pending.offer.years - 1)}.`}
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
              <select value={n.loanPlayingTime} onChange={(e) => g.setLoanPlayingTime(e.target.value as LoanPlayingTime)}>
                {LOAN_PLAYING_TIMES.map((pt) => (
                  <option key={pt} value={pt}>{PLAYING_TIME_NAMES[pt]} · about {Math.round(PLAYING_TIME_SHARE[pt] * 100)}% of your play</option>
                ))}
              </select>
            </ContractRow>
            <ContractRow label="You pay">
              <select value={n.loanShare} onChange={(e) => g.setLoanShare(Number(e.target.value))}>
                {LOAN_WAGE_SHARES.map((s) => (
                  <option key={s} value={s}>{Math.round(s * 100)}% of his wage · {money(Math.round(wage * s))}</option>
                ))}
              </select>
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
      {stepper}
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

          <div className="contract-demands">
            <span className="contract-demands-title"><Icon name="user" size={13} /> His demands</span>
            <ContractRow label="Wage">{money(d.wage)} <span className="faint">/ season</span></ContractRow>
            <ContractRow label="Role">{SQUAD_ROLE_NAMES[d.role]}</ContractRow>
            <ContractRow label="Length">
              <span className="contract-demand-length">
                {demandYears} season{d.maxYears === 1 ? '' : 's'}
                <span className="faint">{demandDates}</span>
              </span>
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
                  <select value={n.termsRole} onChange={(e) => g.setTermsRole(Number(e.target.value) as SquadRole)}>
                    {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{SQUAD_ROLE_NAMES[r]}</option>)}
                  </select>
                </ContractRow>
                <ContractRow label="Contract until">
                  <select value={n.termsYears} onChange={(e) => g.setTermsYears(Number(e.target.value))}>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {endsLabel(startSeason + y - 1)} · {y} season{y === 1 ? '' : 's'}
                      </option>
                    ))}
                  </select>
                </ContractRow>
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
              {Array.from({ length: TALKS_PATIENCE }, (_, i) => (
                <span key={i} className={`patience-dot${i < t.patience ? ' on' : ''}${t.patience <= 1 ? ' low' : ''}`} />
              ))}
            </span>
          </div>
          {rivalsRow}

          {pending === null && n.message !== null && (
            <p className="contract-note"><Icon name="alert" size={15} /> {n.message}</p>
          )}
          {pending === null && n.message === null && t.reply === 'close' && (
            <p className="contract-note counter">
              <Icon name="press" size={15} />
              <span>
                Close. He would sign for <b>{money(d.wage)}</b> a season as a {SQUAD_ROLE_NAMES[d.role].toLowerCase()},
                on a {demandYears}-season deal.
              </span>
            </p>
          )}
          {pending === null && n.message === null && t.reply === 'far' && (
            <p className="contract-note">
              <Icon name="alert" size={15} />
              <span>That was nowhere near what he wants. He is asking for <b>{money(d.wage)}</b> a season.</span>
            </p>
          )}
        </div>
      </div>

      {actions(<button className="primary" onClick={() => g.submitTermsOffer()}>Offer contract</button>)}
    </ContractPaper>
  );
}
