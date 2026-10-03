/**
 * The world's news, laid out like a sports site: the stories down the left —
 * rumours and signings, coaches coming and going, awards, results, injuries —
 * filtered by kind and by country, and the open story on the right, with the
 * player or the clubs in it a click away.
 */

import { useState, type CSSProperties, type JSX } from 'react';
import { flagImageUrl, NATIONS } from '../../engine/world/nations.ts';
import type { NewsItem, NewsKind } from '../../engine/world/news.ts';
import { ClubCrest, Empty, PlayerFace } from '../components.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { useGame } from '../state.ts';
import { Dropdown } from '../dropdown.tsx';

/** How each kind of story is badged. */
export const NEWS_KIND: Readonly<Record<NewsKind, { label: string; icon: IconName; color: string }>> = {
  rumour: { label: 'Rumour', icon: 'transfers', color: '#e3a82b' },
  transfer: { label: 'Transfer', icon: 'transfers', color: '#2fbf9b' },
  contract: { label: 'Contract', icon: 'contract', color: '#e0823a' },
  coach: { label: 'Coaching', icon: 'whistle', color: '#4f8dff' },
  award: { label: 'Award', icon: 'star', color: '#d7a73f' },
  result: { label: 'Result', icon: 'ball', color: '#3dbb5c' },
  title: { label: 'Champions', icon: 'trophy', color: '#f0c35a' },
  injury: { label: 'Injury', icon: 'medical', color: '#e5484d' },
};

type Filter = 'all' | 'market' | 'coach' | 'award' | 'result' | 'injury';

const FILTERS: ReadonlyArray<readonly [Filter, string, readonly NewsKind[]]> = [
  ['all', 'All', []],
  ['market', 'Transfers', ['rumour', 'transfer', 'contract']],
  ['coach', 'Coaches', ['coach']],
  ['award', 'Awards', ['award']],
  ['result', 'Results', ['result', 'title']],
  ['injury', 'Injuries', ['injury']],
];

const ALL_COUNTRIES = -2;

function kindStyle(kind: NewsKind): CSSProperties {
  return { '--cat': NEWS_KIND[kind].color } as CSSProperties;
}

/** "Today", "Yesterday", or the date. */
export function useNewsDate(): (day: number) => string {
  const g = useGame();
  const today = g.world?.day ?? 0;
  return (day) => (day === today ? 'Today' : day === today - 1 ? 'Yesterday' : g.dateLabelForDay(day));
}

/** The picture for a story: the player in it, or the club — both clubs when two are in it. */
export function NewsVisual({ item: n, size }: { item: NewsItem; size: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  if (n.playerIdx !== undefined && store.isActive(n.playerIdx) && n.kind !== 'result') {
    return <PlayerFace playerId={store.id[n.playerIdx]} name={store.fullName(n.playerIdx)} size={size} />;
  }
  const club = n.clubId !== undefined ? world.clubs[n.clubId] : undefined;
  const other = n.otherClubId !== undefined ? world.clubs[n.otherClubId] : undefined;
  if (club !== undefined) {
    return (
      <span className="news-crests" style={{ height: size }}>
        <ClubCrest club={club} size={Math.round(size * (other !== undefined ? 0.62 : 0.8))} />
        {other !== undefined && <ClubCrest club={other} size={Math.round(size * 0.62)} />}
      </span>
    );
  }
  return <span className="news-icon" style={{ ...kindStyle(n.kind), width: size, height: size }}><Icon name={NEWS_KIND[n.kind].icon} size={size * 0.45} /></span>;
}

function Flag({ nation }: { nation: number }): JSX.Element | null {
  const url = nation >= 0 ? flagImageUrl(nation) : null;
  return url !== null ? <img className="news-flag" src={url} alt="" /> : <Icon name="world" size={13} />;
}

export function NewsScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const when = useNewsDate();
  const [filter, setFilter] = useState<Filter>('all');
  const [nation, setNation] = useState(ALL_COUNTRIES);
  const [openId, setOpenId] = useState<number | null>(null);

  const kinds = FILTERS.find(([f]) => f === filter)?.[2] ?? [];
  const items = [...world.news].reverse().filter((n) =>
    (kinds.length === 0 || kinds.includes(n.kind)) && (nation === ALL_COUNTRIES || n.nation === nation));
  // The countries in the news, the busiest first.
  const counts = new Map<number, number>();
  for (const n of world.news) counts.set(n.nation, (counts.get(n.nation) ?? 0) + 1);
  const nations = [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const open = items.find((n) => n.id === openId) ?? items[0];

  return (
    <div className="news">
      <section className="news-list">
        <header className="news-head">
          <h2 className="news-title">World News</h2>
          <div className="news-filters">
            {FILTERS.map(([f, label]) => (
              <button key={f} className={`news-chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{label}</button>
            ))}
          </div>
          <Dropdown
            size="sm"
            value={nation}
            onChange={setNation}
            options={[
              { value: ALL_COUNTRIES, label: 'All countries', icon: <Icon name="world" size={14} /> },
              ...nations.map((id) => ({
                value: id,
                label: id < 0 ? 'International' : NATIONS[id]?.name ?? '?',
                icon: id < 0 ? <Icon name="world" size={14} /> : <Flag nation={id} />,
              })),
            ]}
          />
        </header>
        <div className="news-items">
          {items.length === 0 && <p className="news-none">No stories here yet — the papers fill up as the season goes on.</p>}
          {items.map((n) => (
            <button
              key={n.id}
              className={`news-item${open?.id === n.id ? ' on' : ''}`}
              style={kindStyle(n.kind)}
              onClick={() => setOpenId(n.id)}
            >
              <span className="news-thumb"><NewsVisual item={n} size={38} /></span>
              <span className="news-item-text">
                <small><Flag nation={n.nation} /> {NEWS_KIND[n.kind].label} · {when(n.day)}</small>
                <b>{n.headline}</b>
              </span>
            </button>
          ))}
        </div>
      </section>

      <article className="news-article">
        {open !== undefined ? <Story item={open} /> : <Empty>Nothing in the news yet.</Empty>}
      </article>
    </div>
  );
}

/** The open story. */
function Story({ item: n }: { item: NewsItem }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const when = useNewsDate();
  const store = world.players;
  const club = n.clubId !== undefined ? world.clubs[n.clubId] : undefined;
  const other = n.otherClubId !== undefined ? world.clubs[n.otherClubId] : undefined;
  const comp = n.competitionId !== undefined ? world.competitions[n.competitionId] : undefined;
  const player = n.playerIdx !== undefined && store.isActive(n.playerIdx) ? n.playerIdx : undefined;
  const coach = n.staffId !== undefined ? world.staff[n.staffId] : undefined;
  return (
    <div className="news-story" style={kindStyle(n.kind)} key={n.id}>
      <span className="news-kicker"><Icon name={NEWS_KIND[n.kind].icon} size={14} /> {NEWS_KIND[n.kind].label}</span>
      <h1 className="news-headline">{n.headline}</h1>
      <span className="news-meta">
        <Flag nation={n.nation} /> {n.nation >= 0 ? NATIONS[n.nation]?.name : 'International'} <i>|</i> {when(n.day)}
      </span>
      <div className="news-hero"><NewsVisual item={n} size={132} /></div>
      <p className="news-body">{n.body}</p>
      <div className="news-actions">
        {player !== undefined && (
          <button onClick={() => g.select(player)}><Icon name="user" size={14} /> {store.fullName(player)}</button>
        )}
        {coach !== undefined && (
          <button onClick={() => g.selectCoach(coach.id)}><Icon name="user" size={14} /> {coach.firstName} {coach.lastName}</button>
        )}
        {club !== undefined && (
          <button onClick={() => g.selectClub(club.id)}><ClubCrest club={club} size={16} /> {club.name}</button>
        )}
        {other !== undefined && (
          <button onClick={() => g.selectClub(other.id)}><ClubCrest club={other} size={16} /> {other.name}</button>
        )}
        {comp !== undefined && (
          <button onClick={() => g.openCompetition(comp.id)}><Icon name="trophy" size={14} /> {comp.name}</button>
        )}
      </div>
    </div>
  );
}
