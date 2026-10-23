/**
 * Deadline day: the clock running down to midnight, the day's news as it breaks — the other
 * clubs' late deals, the rumours, the bids for your players — and everything you still have open,
 * to act on before the window shuts.
 */

import { useEffect, useState, type JSX } from 'react';
import { clockLabel, DEADLINE_OPENS, DEADLINE_SHUTS, type DeadlineEvent } from '../../engine/world/deadline.ts';
import { nextTransferWindow, windowCloseDay } from '../../engine/world/world.ts';
import { Card, ClubCrest, Empty, money, Pos, Segmented } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { DirectorDialog } from './Recruitment.tsx';
import type { Position } from '../../engine/model/positions.ts';

/** Where each deadline day's clock had got to, so leaving the screen doesn't wind it back. */
const clocks = new Map<number, number>();

/** Real milliseconds a game minute takes, at each speed. */
const SPEEDS: ReadonlyArray<readonly [number, string]> = [[0, 'Pause'], [400, '1×'], [80, '5×'], [20, '20×']];

const KIND: Readonly<Record<DeadlineEvent['kind'], string>> = { deal: 'Deal', rumour: 'Rumour', bid: 'Bid', talks: 'Your talks', close: 'Deadline' };

export function DeadlineDayScreen(): JSX.Element {
  const g = useGame();
  const plan = g.deadlineToday();
  if (plan === undefined) return <NoDeadline />;
  return <DeadlineLive key={plan.day} />;
}

/** Not today: when the next one is. */
function NoDeadline(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const close = windowCloseDay(world.day);
  let next: number;
  let name: string;
  if (close !== null && close >= world.day) {
    next = close;
    name = 'this window';
  } else {
    const w = nextTransferWindow(world.day);
    next = w.day - w.window.opens + w.window.closes;
    name = w.window.name === 'summer' ? 'the summer window' : 'the January window';
  }
  return (
    <Card title="Deadline day" icon="clock">
      <div className="dl-none">
        <Icon name="clock" size={28} />
        <p>Deadline day is the last day of a transfer window: the phones never stop, every club answers on the day, and the window shuts at midnight.</p>
        <p><b>Next:</b> {name} shuts on <b>{g.longDateLabel(next)}</b>. This screen comes alive that morning.</p>
      </div>
    </Card>
  );
}

function DeadlineLive(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const plan = g.deadlineToday()!;
  const [minute, setMinute] = useState(() => clocks.get(plan.day) ?? DEADLINE_OPENS);
  const [speed, setSpeed] = useState(80);
  const [dialog, setDialog] = useState<number | null>(null);
  const shut = minute >= DEADLINE_SHUTS - 1;

  useEffect(() => {
    if (speed === 0 || shut) return;
    const id = window.setInterval(() => {
      setMinute((m) => {
        const next = Math.min(DEADLINE_SHUTS - 1, m + 1);
        clocks.set(plan.day, next);
        return next;
      });
    }, speed);
    return () => window.clearInterval(id);
  }, [speed, shut, plan.day]);

  const skip = (): void => {
    clocks.set(plan.day, DEADLINE_SHUTS - 1);
    setMinute(DEADLINE_SHUTS - 1);
  };
  const left = DEADLINE_SHUTS - minute;
  // Each event keeps its place in the day's plan as its key, so a new one arriving doesn't replay the rest.
  const feed = plan.events.map((e, i) => ({ e, i })).filter(({ e }) => e.at <= minute).reverse();
  const bids = world.incomingOffers.filter((o) => (o.status ?? 'open') === 'open');
  const talks = world.talks.filter((t) => t.kind !== 'renewal');
  const shortlist = g.shortlist().slice(0, 8);

  return (
    <div className="dl">
      <div className={`dl-head${left <= 60 ? ' late' : ''}`}>
        <div className="dl-title">
          <b>Deadline day</b>
          <span>{g.longDateLabel(world.day)}</span>
        </div>
        <div className="dl-clock" aria-label={`The time is ${clockLabel(minute)}`}>{clockLabel(minute)}</div>
        <div className="dl-left">
          {shut ? <b>The window has shut</b> : <><span>Window shuts in</span><b>{Math.floor(left / 60)}h {String(left % 60).padStart(2, '0')}m</b></>}
        </div>
        <div className="dl-controls">
          <Segmented size="sm" value={shut ? 0 : speed} onChange={setSpeed} options={SPEEDS} />
          <button className="sm" disabled={shut} onClick={skip}><Icon name="fastForward" size={13} /> To midnight</button>
        </div>
      </div>

      {shut && (
        <div className="dl-shut">
          <b>THE WINDOW HAS SHUT</b>
          <span>The deals agreed today go through tonight. Anything else for a player under contract waits for the next window.</span>
          <button className="primary" onClick={() => void g.continueGame()}><Icon name="play" size={14} /> Continue</button>
        </div>
      )}

      <div className="dl-grid">
        <Card title="Live" icon="news" flush className="dl-card">
          <div className="dl-feed">
            {feed.length === 0 && <Empty>The phones are quiet — for now.</Empty>}
            {feed.map(({ e, i }) => (
              <div key={i} className={`dl-item k-${e.kind}${e.kind === 'deal' && (e.fee ?? 0) >= 300_000 ? ' big' : ''}`}>
                <span className="dl-time">{clockLabel(e.at)}</span>
                <span className="dl-kind">{KIND[e.kind]}</span>
                <span className="dl-text">
                  {e.clubId !== undefined && world.clubs[e.clubId] !== undefined && <ClubCrest club={world.clubs[e.clubId]} size={15} />}
                  {e.p !== undefined ? <span className="player-link" onClick={() => g.select(e.p!)}>{e.text}</span> : e.text}
                </span>
                {e.offerId !== undefined && bids.some((o) => o.id === e.offerId) && <button className="sm primary" onClick={() => g.openOffer(e.offerId!)}>Answer</button>}
                {e.talksId !== undefined && world.talks.some((t) => t.id === e.talksId) && <button className="sm" onClick={() => g.openTalksView(e.talksId!)}>Open</button>}
              </div>
            ))}
          </div>
        </Card>

        <div className="dl-side">
          <Card title={`Bids for your players · ${bids.length}`} icon="offer" flush className="dl-card">
            <div className="dl-list">
              {bids.length === 0 && <Empty>No bids on the table.</Empty>}
              {bids.map((o) => (
                <div key={o.id} className="dl-row">
                  {world.clubs[o.buyingClubId] !== undefined && <ClubCrest club={world.clubs[o.buyingClubId]} size={18} />}
                  <span className="dl-row-main"><b>{store.shortName(o.playerIdx)}</b><small>{world.clubs[o.buyingClubId]?.name} · {o.loan !== undefined ? 'loan' : money(o.fee)}</small></span>
                  <button className="sm primary" onClick={() => g.openOffer(o.id)}>Answer</button>
                </div>
              ))}
            </div>
          </Card>
          <Card title={`Your deals in progress · ${talks.length}`} icon="transfers" flush className="dl-card">
            <div className="dl-list">
              {talks.length === 0 && <Empty>No talks open.</Empty>}
              {talks.map((t) => (
                <div key={t.id} className="dl-row">
                  <Pos pos={store.position[t.playerIdx] as Position} />
                  <span className="dl-row-main"><b>{store.shortName(t.playerIdx)}</b>
                    <small>{t.byDirector === true ? 'the director is on it' : t.pending !== null ? 'answer due today' : 'your move'}</small></span>
                  <button className="sm" onClick={() => g.openTalksView(t.id)}>Open</button>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Shortlist" icon="star" flush className="dl-card">
            <div className="dl-list">
              {shortlist.length === 0 && <Empty>Your shortlist is empty.</Empty>}
              {shortlist.map((p) => (
                <div key={p} className="dl-row">
                  <Pos pos={store.position[p] as Position} />
                  <span className="dl-row-main"><b className="player-link" onClick={() => g.select(p)}>{store.shortName(p)}</b>
                    <small>{store.clubId[p] >= 0 ? `${world.clubs[store.clubId[p]]?.shortName} · ${money(store.value[p])}` : 'free agent'}</small></span>
                  <button className="sm primary" disabled={shut && store.clubId[p] >= 0} onClick={() => g.startNegotiation(p)}>Bid</button>
                  <button className="sm" disabled={g.director() === undefined || shut} onClick={() => setDialog(p)} title="Let the Director of Football do it">Director</button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      {dialog !== null && <DirectorDialog p={dialog} kind="transfer" onClose={() => setDialog(null)} />}
    </div>
  );
}
