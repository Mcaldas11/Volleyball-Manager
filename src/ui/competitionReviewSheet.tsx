/**
 * A competition's review as the inbox draws it: the champions, the awards,
 * the team awards with the players who made each, the team of the
 * competition, the favourites, the surprise and the disappointment, the
 * competition in numbers, the best point and play to watch again — and the
 * final standings.
 */

import { useState, type CSSProperties, type JSX } from 'react';
import { POSITION_SHORT, type Position } from '../engine/model/positions.ts';
import { REVIEW_AWARD_NAMES, type CompetitionReview, type ReviewTeamNote } from '../engine/world/competitionReview.ts';
import { ordinal } from '../engine/world/inbox.ts';
import { TEAM_AWARD_HOW, TEAM_AWARD_NAMES, type TeamAward } from '../engine/world/teamAwards.ts';
import { describeHighlight } from '../engine/world/monthAwards.ts';
import { ClubCrest, PlayerFace } from './components.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

export function CompetitionReviewSheet({ review: r }: { review: CompetitionReview }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const comp = world.competitions[r.competitionId];
  const club = (id: number): JSX.Element | null => {
    const c = world.clubs[id];
    return c !== undefined ? <span className="crv-club" onClick={() => g.selectClub(c.id)}><ClubCrest club={c} size={16} /> {c.name}</span> : null;
  };
  const champ = world.clubs[r.champion];
  const note = (n: ReviewTeamNote, how: string): JSX.Element => (
    <div className="crv-team">
      {club(n.clubId)}
      <span className="crv-team-how">{how}</span>
    </div>
  );
  const title = `${comp?.name ?? 'Competition'} · ${world.startYear + r.season}/${String(world.startYear + r.season + 1).slice(2)}`;
  const teamAwards = (r.teamAwards?.length ?? 0) > 0;

  return (
    <div className="crv">
      <div className="crv-hero">
        {champ !== undefined && <ClubCrest club={champ} size={54} />}
        <div>
          <span className="paper-label">{title}</span>
          <b className="crv-champ">{champ?.name ?? '—'}</b>
          <span className="crv-sub">
            Champions{world.clubs[r.runnerUp] !== undefined ? <> · runners-up {world.clubs[r.runnerUp].name}</> : null}
          </span>
        </div>
        {r.you !== null && (
          <div className="crv-you">
            <span>You</span>
            <b>{r.you.finish}</b>
            {r.you.expected !== null && <i>expected {ordinal(r.you.expected)}</i>}
          </div>
        )}
      </div>

      <div className="paper-report">
        <div className="paper-label">The awards</div>
        <div className="crv-awards">
          {r.awards.map((a) => (
            <div key={a.key} className={`crv-award${a.key === 'mvp' ? ' mvp' : ''}`}>
              <PlayerFace playerId={store.id[a.p]} name={store.fullName(a.p)} size={a.key === 'mvp' ? 46 : 36} />
              <div className="crv-award-main">
                <span className="crv-award-label">{REVIEW_AWARD_NAMES[a.key]}</span>
                <strong className="player-link" onClick={() => g.select(a.p)}>{store.fullName(a.p)}</strong>
                <span className="crv-award-value">{a.value}</span>
              </div>
              {world.clubs[a.clubId] !== undefined && <ClubCrest club={world.clubs[a.clubId]} size={18} />}
            </div>
          ))}
        </div>
      </div>

      {teamAwards && (
        <div className="paper-report">
          <div className="paper-label">Team awards</div>
          <div className="crv-taw">
            {r.teamAwards!.map((a) => <TeamAwardCard key={a.key} a={a} />)}
          </div>
        </div>
      )}

      {r.dreamTeam.length > 0 && (
        <div className="paper-report">
          <div className="paper-label">Team of the competition</div>
          <div className="crv-dream">
            {r.dreamTeam.map((d) => (
              <div key={d.p} className="crv-dream-man" onClick={() => g.select(d.p)}>
                <PlayerFace playerId={store.id[d.p]} name={store.fullName(d.p)} size={40} />
                <span className="crv-dream-pos">{POSITION_SHORT[d.pos]}</span>
                <b>{store.shortName(d.p)}</b>
                <i>{d.rating.toFixed(2)}</i>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="paper-report">
        <div className="paper-label">The teams</div>
        <div className="crv-teams">
          <div>
            <span className="crv-team-head">The favourites going in</span>
            {r.favourites.map((f, i) => (
              <div key={f.clubId}>
                {note(f, `${i === 0 ? 'Strongest' : `${ordinal(i + 1)} strongest`} squad — finished ${f.actual > 0 ? ordinal(f.actual) : '—'}`)}
              </div>
            ))}
          </div>
          <div>
            <span className="crv-team-head">Surprise</span>
            {r.surprise !== null ? note(r.surprise, `expected ${ordinal(r.surprise.expected)}, finished ${ordinal(r.surprise.actual)}`)
              : <span className="crv-none">Nobody beat the form book by much.</span>}
            <span className="crv-team-head">Disappointment</span>
            {r.disappointment !== null ? note(r.disappointment, `expected ${ordinal(r.disappointment.expected)}, finished ${ordinal(r.disappointment.actual)}`)
              : <span className="crv-none">Nobody fell far short.</span>}
          </div>
          <div>
            {/* The team awards say it better, with the players, where there are any. */}
            {!teamAwards && r.bestAttack !== null && (<><span className="crv-team-head">Best attack</span>{note({ ...r.bestAttack, expected: 0, actual: 0 }, `${r.bestAttack.perSet.toFixed(1)} points a set`)}</>)}
            {!teamAwards && r.bestDefence !== null && (<><span className="crv-team-head">Best defence</span>{note({ ...r.bestDefence, expected: 0, actual: 0 }, `${r.bestDefence.perSet.toFixed(1)} conceded a set`)}</>)}
            {r.longestRun !== null && (<><span className="crv-team-head">Longest winning run</span>{note({ ...r.longestRun, expected: 0, actual: 0 }, `${r.longestRun.wins} in a row`)}</>)}
          </div>
        </div>
      </div>

      <div className="paper-report">
        <div className="paper-label">In numbers</div>
        <div className="crv-numbers">
          <div><b>{r.numbers.matches}</b><span>matches</span></div>
          <div><b>{r.numbers.sets}</b><span>sets</span></div>
          <div><b>{r.numbers.tieBreaks}</b><span>went to five</span></div>
          <div><b>{r.numbers.sweeps}</b><span>won 3-0</span></div>
        </div>
      </div>

      {(r.bestPoint !== undefined || r.bestPlay !== undefined) && (
        <div className="paper-report">
          <div className="paper-label">Best of the competition</div>
          {([['Point', r.bestPoint], ['Play', r.bestPlay]] as const).map(([what, h]) => h !== undefined && (
            <div key={what} className="crv-best">
              <PlayerFace playerId={store.id[h.star]} name={store.fullName(h.star)} size={36} />
              <div className="crv-award-main">
                <span className="crv-award-label">Best {what.toLowerCase()}</span>
                <strong>{store.fullName(h.star)}</strong>
                <span className="crv-award-value">{(() => { const d = describeHighlight(world, h); return d.charAt(0).toUpperCase() + d.slice(1); })()}.</span>
              </div>
              <button className="paper-btn primary-dark" onClick={() => g.openReplay(h, `${comp?.name ?? 'Competition'} · best ${what.toLowerCase()}`)}>
                <Icon name="play" size={13} /> Watch
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="paper-report">
        <div className="paper-label">Final standings</div>
        <div className="crv-standings" style={{ '--rows': Math.ceil(Math.min(16, r.standings.length) / 2) } as CSSProperties}>
          {r.standings.slice(0, 16).map((id, i) => (
            <div key={id} className={`crv-standing${id === world.userClubId ? ' ours' : ''}`}>
              <span className="crv-pos">{i + 1}</span>
              {club(id)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** How many of a side's players a team award shows before "All". */
const FIRST_SHOWN = 4;

/** A team award: the side, what won it and who came closest — and the players who made it, each with his numbers and his share. */
function TeamAwardCard({ a }: { a: TeamAward }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const [all, setAll] = useState(false);
  const club = world.clubs[a.clubId];
  const shown = all ? a.players : a.players.slice(0, FIRST_SHOWN);
  const shares = a.key !== 'comeback';
  return (
    <div className={`crv-taward${a.clubId === world.userClubId ? ' ours' : ''}`}>
      <div className="crv-taward-head" title={TEAM_AWARD_HOW[a.key]}>
        <Icon name="trophy" size={13} />
        <span className="crv-award-label">{TEAM_AWARD_NAMES[a.key]}</span>
      </div>
      {club !== undefined && (
        <div className="crv-taward-club">
          <ClubCrest club={club} size={28} />
          <div>
            <b onClick={() => g.selectClub(club.id)}>{club.name}</b>
            <span>{a.value}</span>
          </div>
        </div>
      )}
      {a.chasers.length > 0 && (
        <div className="crv-taward-chasers">
          {a.chasers.map((c, i) => (
            <span key={c.clubId} onClick={() => g.selectClub(c.clubId)}>
              {ordinal(i + 2)} <b>{world.clubs[c.clubId]?.name ?? '—'}</b> · {c.value}
            </span>
          ))}
        </div>
      )}
      {a.matches !== undefined && (
        <div className="crv-taward-matches">
          {a.matches.map((m, i) => <span key={i}>{m.score} v {world.clubs[m.opponent]?.name ?? '—'}</span>)}
        </div>
      )}
      <div className="crv-taward-players">
        {shown.map((x) => (
          <div key={x.p} className="crv-taward-man" onClick={() => g.select(x.p)}>
            <PlayerFace playerId={store.id[x.p]} name={store.fullName(x.p)} size={24} />
            <div className="crv-taward-who">
              <div className="crv-taward-row">
                <b>{store.shortName(x.p)} <em>{POSITION_SHORT[store.position[x.p] as Position]}</em></b>
                <strong>{x.value}</strong>
                {shares && (
                  <div className="crv-taward-share" title="His share of the side's">
                    <i style={{ width: `${Math.round(x.share * 100)}%` }} />
                    <small>{Math.round(x.share * 100)}%</small>
                  </div>
                )}
              </div>
              <span>{x.line}</span>
            </div>
          </div>
        ))}
      </div>
      {a.players.length > FIRST_SHOWN && (
        <button className="crv-taward-more" onClick={() => setAll(!all)}>
          {all ? 'Fewer' : `All ${a.players.length}`}
        </button>
      )}
    </div>
  );
}
