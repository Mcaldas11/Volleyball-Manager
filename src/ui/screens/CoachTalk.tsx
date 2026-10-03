import type { JSX } from 'react';
import {
  canRecall, coachRequests, fitMatches, loanCoachName, PLAYING_TIME_NAMES, PLAYING_TIME_SHARE, promiseShare,
  type LoanPlayingTime,
} from '../../engine/world/loans.ts';
import { ClubLink, ContractPaper, ContractRow, RatingBadge, Segmented } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { Dropdown } from '../dropdown.tsx';

/**
 * A word with the coach of a club playing one of yours on loan too little:
 * where his playing time stands against the deal, what to ask for and how —
 * and the coach's answer, given there and then.
 */
export function CoachTalkScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const t = g.coachTalk;
  if (t === null) return null;
  const store = world.players;
  const p = t.playerIdx;
  const loan = world.loans.find((l) => l.playerIdx === p);
  if (loan === undefined) return null;
  const club = world.clubs[loan.loanClubId];
  const coach = loanCoachName(world, loan);
  const st = loan.stats;
  const fit = fitMatches(st);
  const share = Math.round(promiseShare(st) * 100);
  const injured = (st?.clubMatches ?? 0) - fit;
  const avg = st !== undefined && st.apps > 0 ? st.ratingSum / st.apps : 0;
  // Once he has answered, the choice is what was asked — the options may have moved on.
  const requests = t.result === null ? coachRequests(world, p) : [t.request];
  const option = (r: LoanPlayingTime): string => (r === loan.playingTime && t.result === null
    ? `Keep to the deal — ${PLAYING_TIME_NAMES[r].toLowerCase()}`
    : `${PLAYING_TIME_NAMES[r]} · about ${Math.round(PLAYING_TIME_SHARE[r] * 100)}% of the play`);

  return (
    <ContractPaper
      kicker="Talk to the coach"
      title={store.fullName(p)}
      subtitle={`${coach} · ${club?.name ?? 'Loan club'}`}
      playerId={store.id[p]}
      onClose={() => g.closeCoachTalk()}
    >
      <ContractRow label="On loan at"><ClubLink id={loan.loanClubId} /></ContractRow>
      <ContractRow label="Playing time agreed">
        {loan.playingTime !== undefined ? PLAYING_TIME_NAMES[loan.playingTime] : <span className="faint">Not agreed</span>}
      </ContractRow>
      <ContractRow label="On court when fit">
        <span className={loan.playingTime !== undefined && share < PLAYING_TIME_SHARE[loan.playingTime] * 100 - 10 ? 'bad' : ''}>
          {share}% of the play
        </span>
        {loan.playingTime !== undefined && <span className="faint"> · {Math.round(PLAYING_TIME_SHARE[loan.playingTime] * 100)}% agreed</span>}
      </ContractRow>
      <ContractRow label="Appearances">
        {st?.apps ?? 0} of {st?.clubMatches ?? 0} matches
        {injured > 0 && <span className="faint"> · {injured} missed injured</span>}
      </ContractRow>
      <ContractRow label="Average rating">{avg > 0 ? <RatingBadge value={avg} size="sm" /> : '—'}</ContractRow>

      {t.result === null ? (
        <div className="contract-offer">
          <ContractRow label="Ask for">
            <Dropdown
              value={t.request}
              onChange={(v) => g.setCoachRequest(v)}
              options={requests.map((r) => ({ value: r, label: option(r) }))}
            />
          </ContractRow>
          <ContractRow label="Approach">
            <Segmented
              size="sm"
              options={[['diplomatic', 'Diplomatic'], ['firm', 'Firm']] as const}
              value={t.firm ? 'firm' : 'diplomatic'}
              onChange={(v) => g.setCoachFirm(v === 'firm')}
            />
          </ContractRow>
          <p className="contract-hint">
            Holding him to a deal he is breaking is your strongest card, and firmness helps there. More than the deal is
            his to give: a firm tone tends to put his back up, and no coach gives a player more than his squad allows.
            Good performances help your case.
          </p>
          <div className="contract-footer">
            <button className="accent" onClick={() => g.speakToCoach()}>
              <Icon name="press" size={14} /> Speak to {coach.split(' ').pop()}
            </button>
          </div>
        </div>
      ) : (
        <div className={`coach-reply ${t.result.agreed ? 'agreed' : 'refused'}`}>
          <span className="coach-reply-who">{coach}</span>
          <p className="coach-reply-text">“{t.result.reply}”</p>
          <span className="coach-reply-outcome">
            <Icon name={t.result.agreed ? 'check' : 'close'} size={14} />
            {t.result.agreed ? 'He agrees' : 'He refuses'}
          </span>
        </div>
      )}

      <div className="contract-actions">
        {t.result !== null && !t.result.agreed && canRecall(world, p) && (
          <button className="danger" onClick={() => { g.recallFromLoan(p); g.closeCoachTalk(); }}>
            <Icon name="back" size={14} /> Recall from loan
          </button>
        )}
        <span className="flex-spacer" />
        <button onClick={() => g.closeCoachTalk()}>{t.result === null ? 'Cancel' : 'Close'}</button>
      </div>
    </ContractPaper>
  );
}
