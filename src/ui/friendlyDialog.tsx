/**
 * Arranging a pre-season friendly: a free date, home or away, and the club to
 * invite — each with a word on how keen it is likely to be — or the board
 * asked to fix one up instead. The invitation's answer comes to the inbox.
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import {
  clubFree, friendliesOf, friendlyDates, friendlyInterest, friendlyRequests, MAX_FRIENDLIES,
} from '../engine/season/friendlies.ts';
import { ClubCrest, Segmented, StarMeter } from './components.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

/** How keen a club is likely to be, in the words a secretary would use. */
function keenness(p: number): { label: string; cls: 'good' | 'warn' | 'bad' } {
  if (p >= 0.7) return { label: 'Keen', cls: 'good' };
  if (p >= 0.4) return { label: 'Possible', cls: 'warn' };
  return { label: 'Unlikely', cls: 'bad' };
}

/** Clubs shown at once — the search narrows the rest. */
const LIST_LIMIT = 60;

export function FriendlyDialog(): JSX.Element | null {
  const g = useGame();
  if (g.world === null || g.club === null || !g.friendlyDialog) return null;
  return <FriendlyForm />;
}

function FriendlyForm(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const dates = friendlyDates(world);
  const [day, setDay] = useState<number | null>(dates[0] ?? null);
  const [home, setHome] = useState(true);
  const [scope, setScope] = useState<'nation' | 'all'>('nation');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') g.closeFriendlyDialog();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const booked = friendliesOf(world, club.id);
  const pending = friendlyRequests(world);
  const taken = new Set([...booked.flatMap((f) => [f.home, f.away]), ...pending.map((r) => r.clubId)]);
  const full = booked.length + pending.length >= MAX_FRIENDLIES;

  // Clubs of a size to play first, then further from it.
  const clubs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return world.clubs
      .filter((c) => c.id !== club.id && c.players.length >= 12 &&
        (scope === 'all' || c.nation === club.nation) &&
        (q === '' || c.name.toLowerCase().includes(q)))
      .sort((a, b) => Math.abs(a.reputation - club.reputation) - Math.abs(b.reputation - club.reputation))
      .slice(0, LIST_LIMIT);
  }, [world, club, scope, query]);

  const why = (clubId: number): string | null => {
    if (taken.has(clubId)) return 'Already arranged';
    if (day !== null && !clubFree(world, clubId, day)) return 'Busy that week';
    return null;
  };
  const pickedOk = picked !== null && day !== null && why(picked) === null;

  return (
    <div className="hol-overlay" onClick={() => g.closeFriendlyDialog()}>
      <div className="hol-card fr-card" role="dialog" aria-label="Arrange a friendly" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs">Calendar <Icon name="chevronRight" size={12} /> <b>Arrange a friendly</b></span>
          <button className="icon-btn" onClick={() => g.closeFriendlyDialog()} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <h2 className="hol-title">Arrange a Friendly</h2>
        <p className="hol-sub">
          {booked.length + pending.length} of {MAX_FRIENDLIES} friendlies arranged this pre-season.
          {' '}Invite a club and it answers within a few days — or have the board fix one up.
        </p>

        {dates.length === 0 || full ? (
          <p className="fr-empty">
            {full
              ? 'The pre-season has no room for another friendly.'
              : 'There are no free dates left in the pre-season.'}
          </p>
        ) : (
          <div className="fr-body">
            <div className="fr-controls">
              <label className="fr-field">
                <span>Date</span>
                <select value={day ?? ''} onChange={(e) => setDay(Number(e.target.value))}>
                  {dates.map((d) => <option key={d} value={d}>{g.longDateLabel(d)}</option>)}
                </select>
              </label>
              <div className="fr-field">
                <span>Venue</span>
                <Segmented size="sm" options={[[1, 'Home'], [0, 'Away']] as const} value={home ? 1 : 0} onChange={(v) => setHome(v === 1)} />
              </div>
              <div className="fr-field">
                <span>Clubs</span>
                <Segmented size="sm" options={[['nation', 'Your country'], ['all', 'Anywhere']] as const} value={scope} onChange={setScope} />
              </div>
              <label className="fr-field fr-search">
                <span>Search</span>
                <input placeholder="Club name" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            </div>

            <div className="fr-list">
              {clubs.length === 0 && <p className="fr-empty">No club matches.</p>}
              {clubs.map((c) => {
                const block = why(c.id);
                const keen = keenness(friendlyInterest(world, c.id, home));
                return (
                  <button
                    key={c.id}
                    className={`fr-club${picked === c.id ? ' active' : ''}`}
                    disabled={block !== null}
                    onClick={() => setPicked(c.id)}
                  >
                    <ClubCrest club={c} size={28} />
                    <span className="fr-club-main">
                      <strong>{c.name}</strong>
                      <span className="faint">{world.competitions[c.leagueId]?.name ?? `Tier ${c.tier}`}</span>
                    </span>
                    <StarMeter value={c.reputation} max={10000} size={12} />
                    <span className={`fr-keen ${block !== null ? 'faint' : keen.cls}`}>{block ?? keen.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <footer className="hol-foot fr-foot">
          <button disabled={dates.length === 0 || full} onClick={() => g.boardFriendly()}>
            <Icon name="board" size={14} /> Let the board arrange one
          </button>
          <span className="flex-spacer" />
          <button onClick={() => g.closeFriendlyDialog()}>Cancel</button>
          <button
            className="primary"
            disabled={!pickedOk}
            onClick={() => { if (picked !== null && day !== null) g.inviteToFriendly(picked, day, home); }}
          >
            Send invitation
          </button>
        </footer>
      </div>
    </div>
  );
}
