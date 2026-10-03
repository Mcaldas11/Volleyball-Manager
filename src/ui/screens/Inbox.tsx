import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { INJURY_NAMES } from '../../engine/model/players.ts';
import { POSITION_NAMES, type Position } from '../../engine/model/positions.ts';
import { messageNeedsAction, messageSender, injuryDuration, ordinal } from '../../engine/world/inbox.ts';
import {
  contractEndSeason, messageCategory, type GameMessage, type MessageCategory,
} from '../../engine/world/world.ts';
import {
  canRecall, coachTalkBlock, fitMatches, promiseShare, PLAYING_TIME_NAMES, PLAYING_TIME_SHARE, type LoanReport,
  type LoanStats,
} from '../../engine/world/loans.ts';
import {
  ClubCrest, Flag, initials, money, PlayerFace, RatingBadge, StarMeter,
} from '../components.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { SeasonReviewPreview } from '../seasonReview.tsx';
import { IntlReportSheet } from '../intlReport.tsx';
import { nextTournamentFor, worldRanking } from '../../engine/world/internationals.ts';
import { contractEndYear, currentJob } from '../../engine/world/career.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { useGame } from '../state.ts';

/** How each kind of message is filed and badged — the folder it lives in,
 *  its icon and the colour of its stripe down the list. */
export const CATEGORY_META: Readonly<Record<MessageCategory, { label: string; icon: IconName; color: string }>> = {
  offer: { label: 'Transfers', icon: 'transfers', color: '#e3a82b' },
  contract: { label: 'Contracts', icon: 'contract', color: '#e0823a' },
  task: { label: 'Scouting', icon: 'scouting', color: '#e56b5d' },
  medical: { label: 'Medical', icon: 'medical', color: '#e5484d' },
  matchday: { label: 'Matchday', icon: 'trophy', color: '#3dbb5c' },
  interview: { label: 'Media', icon: 'press', color: '#a684f0' },
  news: { label: 'Club & Season', icon: 'news', color: '#3fb0c9' },
  board: { label: 'Board', icon: 'board', color: '#4f8dff' },
  finance: { label: 'Finance', icon: 'coin', color: '#d9b43c' },
  career: { label: 'Career', icon: 'career', color: '#2fbf9b' },
  international: { label: 'International', icon: 'world', color: '#5fb8ff' },
};

const FOLDER_ORDER: readonly MessageCategory[] = [
  'career', 'offer', 'contract', 'task', 'medical', 'matchday', 'international', 'interview', 'news', 'board', 'finance',
];

type Folder = 'inbox' | 'starred' | 'archive' | MessageCategory;
type Filter = 'all' | 'unread' | 'action';

const FOLDER_TITLE: Readonly<Record<'inbox' | 'starred' | 'archive', string>> = {
  inbox: 'Inbox', starred: 'Starred', archive: 'Archive',
};

function inFolder(m: GameMessage, folder: Folder): boolean {
  if (folder === 'archive') return m.archived === true;
  if (m.archived === true) return false;
  if (folder === 'inbox') return true;
  if (folder === 'starred') return m.starred === true;
  return messageCategory(m) === folder;
}

function catStyle(cat: MessageCategory): CSSProperties {
  return { '--cat': CATEGORY_META[cat].color } as CSSProperties;
}

/**
 * The manager's inbox, laid out like a mail client: folders on the left, the
 * post grouped by day in the middle, and the open message on the right as a
 * sheet of paper — who sent it, what it concerns, and a button for whatever
 * it asks of you.
 */
export function InboxScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [folder, setFolder] = useState<Folder>('inbox');
  const [filter, setFilter] = useState<Filter>('all');
  const listRef = useRef<HTMLDivElement>(null);

  const selected = g.inboxSelected !== null ? world.messages.find((m) => m.id === g.inboxSelected) : undefined;

  // A message opened from elsewhere (Next unread, a round-up after a match)
  // must be findable: show the folder it lives in.
  useEffect(() => {
    if (selected !== undefined && !inFolder(selected, folder)) setFolder(selected.archived === true ? 'archive' : 'inbox');
  }, [g.inboxSelected]);

  // …and scrolled into view.
  useEffect(() => {
    const row = listRef.current?.querySelector('.mail-row.active');
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
  }, [g.inboxSelected, folder]);

  const inThisFolder = world.messages.filter((m) => inFolder(m, folder));
  const shown = inThisFolder
    .filter((m) => {
      if (filter === 'unread') return m.read !== true;
      if (filter === 'action') return messageNeedsAction(world, m);
      return true;
    })
    .reverse();

  // Newest first, under a heading for each day.
  const groups: Array<{ day: number; items: GameMessage[] }> = [];
  for (const m of shown) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.day === m.day) last.items.push(m);
    else groups.push({ day: m.day, items: [m] });
  }

  const unreadIn = (f: Folder): number => world.messages.filter((m) => m.read !== true && inFolder(m, f)).length;
  const title = folder === 'inbox' || folder === 'starred' || folder === 'archive'
    ? FOLDER_TITLE[folder]
    : CATEGORY_META[folder].label;

  const folderButton = (f: Folder, label: string, color: string): JSX.Element => {
    const unread = f === 'archive' ? 0 : unreadIn(f);
    return (
      <button
        key={f}
        className={`mail-folder${folder === f ? ' active' : ''}`}
        style={{ '--cat': color } as CSSProperties}
        onClick={() => setFolder(f)}
      >
        <span className="mail-folder-dot" />
        <span className="mail-folder-label">{label}</span>
        {unread > 0 && <span className="mail-folder-count">{unread}</span>}
      </button>
    );
  };

  return (
    <div className="mail">
      <nav className="mail-folders">
        {folderButton('inbox', 'Inbox', 'var(--gold)')}
        {folderButton('starred', 'Starred', '#8f9bb0')}
        <div className="mail-folders-label">Categories</div>
        {FOLDER_ORDER.map((c) => folderButton(c, CATEGORY_META[c].label, CATEGORY_META[c].color))}
        <div className="mail-folders-sep" />
        {folderButton('archive', 'Archive', '#8f9bb0')}
      </nav>

      <section className="mail-list">
        <header className="mail-list-head">
          <h2 className="mail-list-title">{title}</h2>
          <span className="mail-list-count">{inThisFolder.length} message{inThisFolder.length === 1 ? '' : 's'}</span>
        </header>
        <div className="mail-filters" role="tablist">
          {([['all', 'All'], ['unread', 'Unread'], ['action', 'Action needed']] as const).map(([f, label]) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`mail-filter${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mail-list-scroll" ref={listRef}>
          {groups.length === 0 && (
            <div className="mail-list-empty">
              {filter === 'action' ? 'Nothing is waiting on you.' : filter === 'unread' ? 'All caught up.' : 'No messages here.'}
            </div>
          )}
          {groups.map((grp) => (
            <div key={`${grp.day}-${grp.items[0].id}`} className="mail-day">
              <div className="mail-day-head">{g.longDateLabel(grp.day)}</div>
              {grp.items.map((m) => {
                const cat = messageCategory(m);
                return (
                  <button
                    key={m.id}
                    className={`mail-row${g.inboxSelected === m.id ? ' active' : ''}${m.read !== true ? ' unread' : ''}`}
                    style={catStyle(cat)}
                    onClick={() => g.selectMessage(m.id)}
                  >
                    <MessageAvatar message={m} size={40} />
                    <span className="mail-row-main">
                      <span className="mail-row-from">{messageSender(m)}</span>
                      <span className="mail-row-subject">{m.subject}</span>
                      <span className="mail-row-snippet">{m.body}</span>
                    </span>
                    <span className="mail-row-marks">
                      {m.starred === true && <Icon name="star" size={13} className="icon-filled mail-row-star" />}
                      {messageNeedsAction(world, m) && <span className="mail-row-action" title="Action needed" />}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="mail-reader">
        {selected === undefined
          ? (
            <div className="paper paper-empty">
              <Icon name="inbox" size={30} />
              <strong>Select a message</strong>
              <span>Pick a message from the list to read it here.</span>
            </div>
          )
          : <MessageSheet key={selected.id} message={selected} />}
      </section>
    </div>
  );
}

/** The face beside a message: the player it is about, the club it comes
 *  from, or the office's own badge. */
export function MessageAvatar({ message: m, size }: { message: GameMessage; size: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const cat = messageCategory(m);
  if (m.playerIdx !== undefined && store.isActive(m.playerIdx) && cat !== 'offer' && m.clubId === undefined) {
    return <PlayerFace playerId={store.id[m.playerIdx]} name={store.fullName(m.playerIdx)} size={size} />;
  }
  const club = m.clubId !== undefined ? world.clubs[m.clubId] : undefined;
  if (club !== undefined) {
    return <span className="mail-avatar mail-avatar-crest" style={{ width: size, height: size }}><ClubCrest club={club} size={size * 0.72} /></span>;
  }
  if (m.playerIdx !== undefined && store.isActive(m.playerIdx)) {
    return <PlayerFace playerId={store.id[m.playerIdx]} name={store.fullName(m.playerIdx)} size={size} />;
  }
  return (
    <span className="mail-avatar" style={{ ...catStyle(cat), width: size, height: size }}>
      <Icon name={CATEGORY_META[cat].icon} size={Math.round(size * 0.45)} />
    </span>
  );
}

/** The open message, as a sheet of paper. */
function MessageSheet({ message: m }: { message: GameMessage }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const cat = messageCategory(m);
  const sender = messageSender(m);
  const needsAction = messageNeedsAction(world, m);

  return (
    <article className="paper" style={catStyle(cat)}>
      <div className="paper-toolbar">
        <button
          className={`paper-tool${m.starred === true ? ' on' : ''}`}
          title={m.starred === true ? 'Unstar' : 'Star'}
          onClick={() => g.toggleStar(m.id)}
        >
          <Icon name="star" size={16} className={m.starred === true ? 'icon-filled' : undefined} />
        </button>
        <button
          className={`paper-tool${m.archived === true ? ' on' : ''}`}
          title={m.archived === true ? 'Move back to the inbox' : 'Archive'}
          onClick={() => g.toggleArchive(m.id)}
        >
          <Icon name="archive" size={16} />
        </button>
        <span className="flex-spacer" />
        {needsAction && <span className="paper-flag">Action needed</span>}
      </div>

      <div className="paper-scroll">
        <div className="paper-cat">{CATEGORY_META[cat].label}</div>
        <h2 className="paper-title">{m.subject}</h2>
        <div className="paper-from">
          <span className="paper-from-badge">{initials(sender)}</span>
          <strong>{sender}</strong>
          <span className="paper-date">{g.longDateLabel(m.day)}</span>
        </div>

        {m.intl === undefined && <PlayerContext message={m} />}
        {/* A drawn report says the player-by-player part better than the text. */}
        <p className="paper-text">{m.intl !== undefined ? intlIntro(m.body) : m.body}</p>
        <MessageDetail message={m} />
      </div>

      <MessageActions message={m} />
    </article>
  );
}

/** An international message's text without its player-by-player lines,
 *  which the drawn report shows instead. */
function intlIntro(body: string): string {
  return body.split('\n').filter((l) => !l.startsWith('• ')).join('\n').replace(/:\n/g, '.\n').replace(/:$/, '.');
}

/** "Current player context" — who the message is about, as he stands today. */
function PlayerContext({ message: m }: { message: GameMessage }): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const p = m.playerIdx;
  if (p === undefined || !store.isActive(p)) return null;
  const clubId = store.clubId[p];
  const club = clubId >= 0 ? world.clubs[clubId] : undefined;
  const ours = clubId === world.userClubId;
  return (
    <div className="paper-context">
      <div className="paper-label">Current player context</div>
      <div className="paper-context-body">
        <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={84} />
        <div className="paper-context-grid">
          <strong className="paper-context-name player-link" onClick={() => g.select(p)}>{store.fullName(p)}</strong>
          <Field label="Position">{POSITION_NAMES[store.position[p] as Position]}</Field>
          <Field label="Age">{store.ageOn(p, world.year, 181)}</Field>
          <Field label="Current club">{club?.name ?? 'Free agent'}</Field>
          <Field label="Market value">{money(store.value[p])}</Field>
          <Field label="Current ability"><StarMeter value={store.currentAbility[p]} size={15} /></Field>
          <Field label="Potential">
            {ours ? <StarMeter value={store.potentialAbility[p]} size={15} /> : <span className="paper-muted">Scout to assess</span>}
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="paper-field">
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

function ReportRow({ k, children, tone }: { k: string; children: ReactNode; tone?: 'good' | 'bad' }): JSX.Element {
  return (
    <div className="paper-report-row">
      <span>{k}</span>
      <b className={tone ?? ''}>{children}</b>
    </div>
  );
}

/** Whatever a message carries beyond its text: a medical report, the month's
 *  books, a matchday's results and table, the offer on the table. */
function MessageDetail({ message: m }: { message: GameMessage }): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const cat = messageCategory(m);

  if (m.intl !== undefined) return <IntlReportSheet report={m.intl} />;

  if (m.nationalOffer !== undefined) {
    const offer = world.internationals?.offers.find((o) => o.id === m.nationalOffer!.id);
    const nation = m.nationalOffer.nation;
    const next = nextTournamentFor(world, nation);
    const accepted = offer === undefined && world.career.nationalJobs?.some((j) => j.nation === nation && j.startDay >= m.day) === true;
    return (
      <div className="paper-report">
        <div className="paper-label">The national team job</div>
        <ReportRow k="Nation"><Flag nation={nation} /> {NATIONS[nation]?.name}</ReportRow>
        <ReportRow k="World ranking">{worldRanking(world).indexOf(nation) + 1}</ReportRow>
        <ReportRow k="Next tournament">{next !== undefined ? `${next.name} · ${g.longDateLabel(next.startDay)}` : '—'}</ReportRow>
        <ReportRow k="Status" tone={offer !== undefined || accepted ? 'good' : undefined}>
          {offer !== undefined ? 'Awaiting your answer' : accepted ? 'Accepted' : 'Closed'}
        </ReportRow>
        {offer !== undefined && <ReportRow k="Offer stands until">{g.longDateLabel(offer.expiresOn)}</ReportRow>}
      </div>
    );
  }

  if (cat === 'medical' && m.playerIdx !== undefined) {
    const p = m.playerIdx;
    const out = store.injuryDaysLeft[p];
    return (
      <div className="paper-report">
        <div className="paper-label">Medical report</div>
        {m.injury !== undefined && (
          <>
            <ReportRow k="Diagnosis">{INJURY_NAMES[m.injury.type] ?? 'Injury'}</ReportRow>
            <ReportRow k="Expected absence">{injuryDuration(m.injury.days)}</ReportRow>
            <ReportRow k="Expected return">{g.longDateLabel(m.day + m.injury.days)}</ReportRow>
          </>
        )}
        <ReportRow k="Availability" tone={out > 0 ? 'bad' : 'good'}>
          {out > 0 ? `Injured — ${injuryDuration(out)} to go` : 'Available'}
        </ReportRow>
      </div>
    );
  }

  if (m.statement !== undefined) {
    const s = m.statement;
    const change = s.opening === null ? null : s.balance - s.opening;
    return (
      <div className="paper-report">
        <div className="paper-label">Monthly statement · {s.month}</div>
        <ReportRow k="Closing balance" tone={s.balance < 0 ? 'bad' : undefined}>{money(s.balance)}</ReportRow>
        {change !== null && (
          <ReportRow k="Change on last statement" tone={change >= 0 ? 'good' : 'bad'}>
            {change >= 0 ? '+' : '−'}{money(Math.abs(change))}
          </ReportRow>
        )}
        <ReportRow k="Transfer budget">{money(s.transferBudget)}</ReportRow>
        <ReportRow k="Squad wages">{money(s.wageBill)} a season · {money(s.wageBill / 12)} a month</ReportRow>
        <ReportRow k="Wage budget" tone={s.wageBill > s.wageBudget ? 'bad' : undefined}>{money(s.wageBudget)}</ReportRow>
        <ReportRow k="Gate receipts, season to date">{money(s.gateReceipts)}</ReportRow>
        <ReportRow k="Travel, season to date">{money(s.travel)}</ReportRow>
      </div>
    );
  }

  if (m.roundup !== undefined) return <Roundup message={m} />;

  if (m.loanReport !== undefined) return <LoanReportSheet report={m.loanReport} />;

  if (m.jobOfferId !== undefined && m.clubId !== undefined) {
    const club = world.clubs[m.clubId];
    if (club === undefined) return null;
    const offer = world.career.offers.find((o) => o.id === m.jobOfferId);
    const league = world.competitions[club.leagueId];
    const avg = club.players.length > 0
      ? club.players.reduce((s, p) => s + store.currentAbility[p], 0) / club.players.length
      : 0;
    const status = offer !== undefined ? 'Awaiting your answer'
      : world.userClubId === club.id ? 'Accepted' : 'Closed';
    return (
      <div className="paper-report">
        <div className="paper-label">The job</div>
        <ReportRow k="Club">{club.name}</ReportRow>
        {league !== undefined && <ReportRow k="League">{league.name} · Tier {league.tier}</ReportRow>}
        <ReportRow k="Reputation"><StarMeter value={club.reputation} max={10000} size={14} /></ReportRow>
        <ReportRow k="Board target">Finish {ordinal(club.boardExpectation)} or better</ReportRow>
        <ReportRow k="Squad average"><StarMeter value={avg} size={14} /></ReportRow>
        <ReportRow k="Transfer budget">{money(club.finances.transferBudget)}</ReportRow>
        <ReportRow k="Wage budget">{money(club.finances.wageBudget)} a season</ReportRow>
        {offer?.contract !== undefined && (
          <>
            <ReportRow k="Your wage">{money(offer.contract.wage)} a season</ReportRow>
            <ReportRow k="Contract until">30 June {contractEndYear(world, offer.contract)}</ReportRow>
          </>
        )}
        <ReportRow k="Status" tone={offer !== undefined || status === 'Accepted' ? 'good' : undefined}>{status}</ReportRow>
        {offer !== undefined && <ReportRow k="Offer stands until">{g.longDateLabel(offer.expiresOn)}</ReportRow>}
      </div>
    );
  }

  if (m.contractOfferId !== undefined) {
    const offer = world.career.contractOffer?.id === m.contractOfferId ? world.career.contractOffer : null;
    const now = currentJob(world)?.contract;
    return (
      <div className="paper-report">
        <div className="paper-label">The contract</div>
        {offer !== null && (
          <>
            <ReportRow k="Wage offered">{money(offer.terms.wage)} a season</ReportRow>
            <ReportRow k="Until">30 June {contractEndYear(world, offer.terms)}</ReportRow>
          </>
        )}
        {now !== undefined && (
          <ReportRow k={offer !== null ? 'Your contract now' : 'Your contract'}>
            {money(now.wage)} a season, to 30 June {contractEndYear(world, now)}
          </ReportRow>
        )}
        <ReportRow k="Status" tone={offer !== null ? 'good' : undefined}>
          {offer !== null ? 'Awaiting your signature' : 'Answered'}
        </ReportRow>
        {offer !== null && <ReportRow k="Offer stands until">{g.longDateLabel(offer.expiresOn)}</ReportRow>}
      </div>
    );
  }

  if (m.offerId !== undefined) {
    const offer = world.incomingOffers.find((o) => o.id === m.offerId);
    const buyer = offer !== undefined ? world.clubs[offer.buyingClubId] : undefined;
    const status = offer === undefined ? 'Closed' : offer.status === 'countered'
      ? 'Your asking price is with them'
      : offer.status === 'accepted' ? 'Agreed — the player is deciding' : 'Awaiting your answer';
    return (
      <div className="paper-report">
        <div className="paper-label">The offer</div>
        {buyer !== undefined && <ReportRow k={offer?.loan !== undefined ? 'Borrowing club' : 'Bidding club'}>{buyer.name}</ReportRow>}
        {offer !== undefined && offer.loan !== undefined && (
          <ReportRow k="Loan">To 30 June · they pay {Math.round(offer.loan.wageShare * 100)}% of his wage</ReportRow>
        )}
        {offer !== undefined && offer.loan === undefined && <ReportRow k="Fee offered">{money(offer.fee)}</ReportRow>}
        {offer !== undefined && <ReportRow k="Market value">{money(store.value[offer.playerIdx])}</ReportRow>}
        <ReportRow k="Status" tone={offer === undefined ? undefined : 'good'}>{status}</ReportRow>
        {offer !== undefined && (offer.status ?? 'open') === 'open' && (
          <ReportRow k="Expires">{g.longDateLabel(offer.expiresOnDay)}</ReportRow>
        )}
      </div>
    );
  }

  if (m.talksId !== undefined) {
    const t = world.talks.find((x) => x.id === m.talksId);
    return (
      <div className="paper-report">
        <div className="paper-label">Negotiation</div>
        <ReportRow k="Stage">
          {t === undefined ? 'Over' : t.kind === 'loan' ? 'Asking his club for a loan'
            : t.stage === 'fee' ? 'Agreeing a fee with the club' : 'Personal terms'}
        </ReportRow>
        {t !== undefined && (
          <ReportRow k="Next move" tone={t.pending === null ? 'good' : undefined}>
            {t.pending === null ? 'Yours' : `Their answer by ${g.longDateLabel(t.pending.resolvesOn)}`}
          </ReportRow>
        )}
      </div>
    );
  }

  if (cat === 'interview' && m.fixtureId !== undefined) {
    const f = world.fixtures[m.fixtureId];
    const session = world.pendingInterviews.find((s) => s.fixtureId === m.fixtureId);
    const opp = f !== undefined ? world.clubs[f.home === world.userClubId ? f.away : f.home] : undefined;
    return (
      <div className="paper-report">
        <div className="paper-label">Press conference</div>
        {opp !== undefined && f !== undefined && (
          <ReportRow k="Ahead of">{f.home === world.userClubId ? 'vs' : 'at'} {opp.name} · {g.longDateLabel(f.day)}</ReportRow>
        )}
        <ReportRow k="Questions">{session?.questions.length ?? '—'}</ReportRow>
        <ReportRow k="Status">
          {session === undefined ? 'Closed' : session.finished ? 'Done' : session.currentIndex > 0 ? 'In progress' : 'Waiting for you'}
        </ReportRow>
      </div>
    );
  }

  if (m.seasonReview !== undefined) {
    return <div className="paper-embed"><SeasonReviewPreview messageId={m.id} review={m.seasonReview} /></div>;
  }

  if (m.seasonAwards !== undefined) {
    return (
      <div className="paper-report">
        <div className="paper-label">Season awards</div>
        {m.seasonAwards.map((a, i) => (
          <div key={i} className="paper-report-row clickable" onClick={() => g.select(a.playerIdx)}>
            <span>{a.label}</span>
            <b>{a.detail}</b>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

function pct(n: number, of: number): string {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : '—';
}

/** A loan compiled: the games he has had against the ones promised, what he
 *  did in them, and how he has come on — with the month just gone on its own,
 *  in a monthly update. */
function LoanReportSheet({ report: r }: { report: LoanReport }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const st = r.stats;
  const club = world.clubs[r.loanClubId];
  const fit = fitMatches(st);
  const share = promiseShare(st);
  const promised = r.playingTime !== undefined ? PLAYING_TIME_SHARE[r.playingTime] : null;
  const kept = promised === null || fit < 4 || share >= promised - 0.15;
  const gain = r.abilityNow - r.abilityStart;
  const avg = st.apps > 0 ? st.ratingSum / st.apps : 0;
  const injured = st.clubMatches - fit;
  return (
    <div className="paper-roundup">
      {r.month !== undefined && <LoanMonth label={r.month.label} stats={r.month.stats} abilityChange={r.month.abilityChange} />}
      <div className="paper-report">
        <div className="paper-label">
          {r.final ? 'Final loan report' : r.month !== undefined ? 'The loan so far' : 'Loan report'} · {club?.name ?? 'Loan club'} · {g.longDateLabel(r.fromDay)} – {g.longDateLabel(r.toDay)}
        </div>
        <ReportRow k="Playing time agreed">{r.playingTime !== undefined ? PLAYING_TIME_NAMES[r.playingTime] : 'Not agreed'}</ReportRow>
        <ReportRow k="Appearances">{st.apps} of {st.clubMatches} match{st.clubMatches === 1 ? '' : 'es'}</ReportRow>
        {injured > 0 && <ReportRow k="Missed injured" tone="bad">{injured} match{injured === 1 ? '' : 'es'}</ReportRow>}
        <ReportRow k="Time on court when fit" tone={fit === 0 ? undefined : kept ? 'good' : 'bad'}>
          {fit === 0 ? '—' : `${Math.round(share * 100)}% of the play`}
          {promised !== null && fit > 0 ? ` · ${Math.round(promised * 100)}% promised` : ''}
        </ReportRow>
        <ReportRow k="Average rating">
          {avg > 0 ? <><RatingBadge value={avg} size="sm" /> <span className="paper-muted">best {st.best.toFixed(1)}</span></> : '—'}
        </ReportRow>
        <ReportRow k="Player of the match">{st.mvps}</ReportRow>
        <ReportRow k="Ability" tone={gain >= 8 ? 'good' : gain <= -8 ? 'bad' : undefined}>
          {r.abilityStart} → {r.abilityNow} ({gain >= 0 ? '+' : '−'}{Math.abs(gain)})
        </ReportRow>
        {r.form.length > 0 && (
          <ReportRow k="Recent form">
            <span className="paper-form">{r.form.map((v, i) => <RatingBadge key={i} value={v} size="sm" />)}</span>
          </ReportRow>
        )}
      </div>
      <div className="paper-report">
        <div className="paper-label">Statistics</div>
        <ReportRow k="Points">{st.points}{st.apps > 0 ? ` · ${(st.points / st.apps).toFixed(1)} a match` : ''}</ReportRow>
        {st.attacks > 0 && (
          <ReportRow k="Attack">
            {st.kills} kills · {pct(st.kills, st.attacks)} kill rate · efficiency {pct(st.kills - st.attackFaults, st.attacks)}
          </ReportRow>
        )}
        <ReportRow k="Serve">{st.aces} aces</ReportRow>
        <ReportRow k="Block">{st.blocks} blocks</ReportRow>
        {st.receptions > 0 && <ReportRow k="Reception">{pct(st.goodReceptions, st.receptions)} positive · {st.receptions} passes</ReportRow>}
        <ReportRow k="Defence">{st.digs} digs</ReportRow>
        {st.assists > 0 && <ReportRow k="Setting">{st.assists} assists</ReportRow>}
      </div>
      <div className="paper-report">
        <div className="paper-label">Staff verdict</div>
        <p className="paper-verdict">{r.verdict}</p>
      </div>
    </div>
  );
}

/** One month of a loan, on its own. */
function LoanMonth({ label, stats: m, abilityChange }: { label: string; stats: LoanStats; abilityChange: number }): JSX.Element {
  const avg = m.apps > 0 ? m.ratingSum / m.apps : 0;
  const injured = m.clubMatches - fitMatches(m);
  return (
    <div className="paper-report">
      <div className="paper-label">{label}</div>
      <ReportRow k="Appearances">{m.apps} of {m.clubMatches} match{m.clubMatches === 1 ? '' : 'es'}</ReportRow>
      {injured > 0 && <ReportRow k="Missed injured" tone="bad">{injured} match{injured === 1 ? '' : 'es'}</ReportRow>}
      <ReportRow k="Average rating">{avg > 0 ? <RatingBadge value={avg} size="sm" /> : '—'}</ReportRow>
      <ReportRow k="Points">
        {m.points} · {m.kills} kills · {m.aces} aces · {m.blocks} blocks
      </ReportRow>
      {m.mvps > 0 && <ReportRow k="Player of the match">{m.mvps}</ReportRow>}
      <ReportRow k="Ability this month" tone={abilityChange > 0 ? 'good' : abilityChange < 0 ? 'bad' : undefined}>
        {abilityChange > 0 ? '+' : abilityChange < 0 ? '−' : ''}{Math.abs(abilityChange)}
      </ReportRow>
    </div>
  );
}
/** A league matchday: every result, and the table as it left it. */
function Roundup({ message: m }: { message: GameMessage }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const r = m.roundup!;
  const comp = world.competitions[r.competitionId];
  const fixtures = (comp?.fixtureIds ?? []).map((id) => world.fixtures[id]).filter((f) => f.round === r.round);
  const me = world.userClubId;

  return (
    <div className="paper-roundup">
      <div className="paper-report">
        <div className="paper-label">Results · {comp?.name ?? 'League'}</div>
        {fixtures.map((f) => {
          const home = world.clubs[f.home];
          const away = world.clubs[f.away];
          const homeWon = f.homeSets > f.awaySets;
          const ours = f.home === me || f.away === me;
          return (
            <div key={f.id} className={`paper-result${ours ? ' ours' : ''}`}>
              <span className={`paper-result-team${homeWon ? ' won' : ''}`}>
                {home !== undefined && <ClubCrest club={home} size={18} />} {home?.name ?? '—'}
              </span>
              <span className="paper-result-score">{f.played ? `${f.homeSets}–${f.awaySets}` : 'v'}</span>
              <span className={`paper-result-team right${f.played && !homeWon ? ' won' : ''}`}>
                {away?.name ?? '—'} {away !== undefined && <ClubCrest club={away} size={18} />}
              </span>
            </div>
          );
        })}
      </div>
      <div className="paper-report">
        <div className="paper-label">Table after matchday {r.round + 1}</div>
        <table className="paper-table">
          <thead>
            <tr><th className="num">#</th><th>Club</th><th className="num">P</th><th className="num">W</th><th className="num">L</th><th className="num">Pts</th></tr>
          </thead>
          <tbody>
            {r.table.map(([clubId, played, won, lost, points], i) => {
              const club = world.clubs[clubId];
              return (
                <tr key={clubId} className={clubId === me ? 'me' : ''}>
                  <td className="num">{i + 1}</td>
                  <td>{club !== undefined && <ClubCrest club={club} size={16} />} {club?.name ?? '—'}</td>
                  <td className="num">{played}</td>
                  <td className="num">{won}</td>
                  <td className="num">{lost}</td>
                  <td className="num"><b>{points}</b></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The buttons along the foot of a message — whatever it lets the manager do next. */
function MessageActions({ message: m }: { message: GameMessage }): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const cat = messageCategory(m);
  const out: JSX.Element[] = [];
  const p = m.playerIdx;

  const session = m.fixtureId !== undefined ? world.pendingInterviews.find((s) => s.fixtureId === m.fixtureId) : undefined;
  if (session !== undefined) {
    if (session.currentIndex === 0 && !session.finished) {
      out.push(
        <button key="attend" className="paper-btn primary-dark" onClick={() => g.openInterview(session.fixtureId)}>
          <Icon name="press" size={15} /> Attend press conference
        </button>,
        <button key="decline" className="paper-btn" onClick={() => g.declineInterview(session.fixtureId)}>Decline interview</button>,
      );
    } else {
      out.push(
        <button key="resume" className="paper-btn primary-dark" onClick={() => g.openInterview(session.fixtureId)}>
          {session.finished ? 'View summary' : 'Resume conference'}
        </button>,
      );
    }
  }

  const nationalOffer = m.nationalOffer !== undefined
    ? world.internationals?.offers.find((o) => o.id === m.nationalOffer!.id)
    : undefined;
  if (nationalOffer !== undefined) {
    out.push(
      <button key="accept-nation" className="paper-btn primary-dark" onClick={() => g.acceptNationalOffer(nationalOffer.id)}>
        <Icon name="check" size={15} /> Accept job
      </button>,
      <button key="decline-nation" className="paper-btn" onClick={() => g.declineNationalOffer(nationalOffer.id)}>Decline</button>,
    );
  }

  if (m.contractOfferId !== undefined && world.career.contractOffer?.id === m.contractOfferId) {
    out.push(
      <button key="sign" className="paper-btn primary-dark" onClick={() => g.acceptContractOffer()}>
        <Icon name="check" size={15} /> Sign contract
      </button>,
      <button key="decline-contract" className="paper-btn" onClick={() => g.declineContractOffer()}>Decline</button>,
    );
  }

  const jobOffer = m.jobOfferId !== undefined ? world.career.offers.find((o) => o.id === m.jobOfferId) : undefined;
  if (jobOffer !== undefined) {
    const busy = g.processing || g.matchday !== null || g.postMatch !== null;
    out.push(
      <button key="accept-job" className="paper-btn primary-dark" disabled={busy} onClick={() => g.acceptJobOffer(jobOffer.id)}>
        <Icon name="check" size={15} /> Accept job
      </button>,
      <button key="decline-job" className="paper-btn" onClick={() => g.declineJobOffer(jobOffer.id)}>Decline</button>,
    );
  }
  if (cat === 'career' && m.clubId !== undefined && world.clubs[m.clubId] !== undefined) {
    out.push(<button key="club" className="paper-btn" onClick={() => g.selectClub(m.clubId!)}>View club</button>);
  }
  if (cat === 'career' && jobOffer === undefined && g.unemployed) {
    out.push(<button key="jobs" className="paper-btn" onClick={() => g.go('jobs')}>Job Centre</button>);
  }
  if (m.intl !== undefined && world.internationals?.tournaments.some((t) => t.id === m.intl!.tournamentId)) {
    out.push(
      <button key="tournament" className="paper-btn" onClick={() => g.openTournament(m.intl!.tournamentId)}>
        <Icon name="trophy" size={15} /> View tournament
      </button>,
    );
  }

  if (m.offerId !== undefined && world.incomingOffers.some((o) => o.id === m.offerId)) {
    out.push(
      <button key="offer" className="paper-btn primary-dark" onClick={() => g.openOffer(m.offerId!)}>
        <Icon name="offer" size={15} /> Review offer
      </button>,
    );
  }

  const talks = m.talksId !== undefined ? world.talks.find((t) => t.id === m.talksId) : undefined;
  if (talks !== undefined) {
    out.push(
      <button key="talks" className="paper-btn primary-dark" onClick={() => g.openTalksView(talks.id)}>
        <Icon name="transfers" size={15} /> {talks.pending !== null ? 'View talks' : 'Continue talks'}
      </button>,
    );
  }

  // Only while his contract is still running out — not after he has re-signed.
  const contractTalk = cat === 'contract' && p !== undefined && store.clubId[p] === world.userClubId &&
    contractEndSeason(store.contractUntil[p]) <= world.season && talks === undefined;
  if (contractTalk && p !== undefined) {
    out.push(
      <button key="renew" className="paper-btn primary-dark" onClick={() => g.startRenewal(p)}>
        <Icon name="contract" size={15} /> Open contract talks
      </button>,
    );
  }

  if (cat === 'task' && p !== undefined && out.length === 0) {
    out.push(
      <button key="scout" className="paper-btn primary-dark" onClick={() => g.focusScouting(p)}>
        <Icon name="scouting" size={15} /> Open scouting report
      </button>,
    );
  }

  // One of ours out on loan: have his matches there compiled, as often as you like.
  const lentOut = p !== undefined ? world.loans.find((l) => l.playerIdx === p && l.parentClubId === world.userClubId) : undefined;
  if ((m.loanOut === true || m.loanReport !== undefined) && lentOut !== undefined && p !== undefined) {
    out.push(
      <button key="compile" className="paper-btn primary-dark" onClick={() => g.compileLoanMatches(p)}>
        <Icon name="stats" size={15} /> {m.loanReport !== undefined ? 'Compile again' : 'Compile matches'}
      </button>,
    );
  }
  // Playing too little: have a word with his coach.
  if ((m.loanOut === true || m.loanReport !== undefined) && lentOut !== undefined && p !== undefined &&
    coachTalkBlock(world, p) === null) {
    out.push(
      <button key="coach" className="paper-btn" onClick={() => g.openCoachTalk(p)}>
        <Icon name="press" size={15} /> Talk to the coach
      </button>,
    );
  }
  // A loan club short-changing him on games: he can be brought home.
  if (m.loanRecall === true && p !== undefined && canRecall(world, p)) {
    out.push(
      <button key="recall" className="paper-btn" onClick={() => g.recallFromLoan(p)}>
        <Icon name="back" size={15} /> Recall from loan
      </button>,
    );
  }

  if (m.roundup !== undefined) {
    out.push(<button key="table" className="paper-btn primary-dark" onClick={() => g.go('table')}>Full table</button>);
  }
  if (m.statement !== undefined) {
    out.push(<button key="books" className="paper-btn primary-dark" onClick={() => g.go('finances')}>View finances</button>);
  }

  if (p !== undefined && store.isActive(p)) {
    out.push(<button key="player" className="paper-btn" onClick={() => g.select(p)}>View player</button>);
  }
  return out.length > 0 ? <div className="paper-actions">{out}</div> : null;
}
