/**
 * The season's awards as the inbox shows them: a team of the season drawn on
 * the court, and a night of awards — a league's or the world's — each award
 * with its winner and the two who ran him closest.
 */

import type { JSX } from 'react';
import { Position, POSITION_SHORT } from '../engine/model/positions.ts';
import { accoladeTitle, type AwardsNight, type Nominee } from '../engine/world/accolades.ts';
import type { DreamPick } from '../engine/world/competitionReview.ts';
import { ClubCrest, initials, PlayerFace } from './components.tsx';
import { useGame } from './state.ts';

/** Where each pick stands: the front row 4-3-2, the back row 5-6-1, as the coach looks at the court from behind it. */
function lineUp(picks: readonly DreamPick[]): { front: Array<DreamPick | undefined>; back: Array<DreamPick | undefined>; libero?: DreamPick } {
  const at = (pos: Position, i: number): DreamPick | undefined => picks.filter((d) => d.pos === pos)[i];
  return {
    front: [at(Position.OutsideHitter, 0), at(Position.MiddleBlocker, 0), at(Position.Opposite, 0)],
    back: [at(Position.OutsideHitter, 1), at(Position.MiddleBlocker, 1), at(Position.Setter, 0)],
    libero: at(Position.Libero, 0),
  };
}

/** A team of the season on the court: the six in their zones, the libero beside it. */
export function DreamCourt({ picks }: { picks: readonly DreamPick[] }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const { front, back, libero } = lineUp(picks);
  const card = (d: DreamPick | undefined, zone: string): JSX.Element => {
    if (d === undefined) return <div key={zone} className="dc-card empty">—</div>;
    const club = world.clubs[d.clubId];
    return (
      <div key={zone} className={`dc-card${d.clubId === world.userClubId ? ' ours' : ''}`} onClick={() => g.select(d.p)} title={store.fullName(d.p)}>
        <span className="dc-pos">{POSITION_SHORT[d.pos]}</span>
        <PlayerFace playerId={store.id[d.p]} name={store.fullName(d.p)} size={46} />
        <b>{store.shortName(d.p)}</b>
        <span className="dc-meta">
          {club !== undefined && <ClubCrest club={club} size={14} />}
          <i>{d.rating.toFixed(2)}</i>
        </span>
      </div>
    );
  };
  return (
    <div className="dc">
      <div className="dc-court">
        <div className="dc-net"><span>Net</span></div>
        <div className="dc-row">{front.map((d, i) => card(d, ['4', '3', '2'][i]))}</div>
        <div className="dc-line" />
        <div className="dc-row">{back.map((d, i) => card(d, ['5', '6', '1'][i]))}</div>
      </div>
      <div className="dc-libero">
        <span className="dc-libero-label">Libero</span>
        {card(libero, 'L')}
      </div>
    </div>
  );
}

/** A team of the season, in a message of its own. */
export function TeamOfSeasonSheet({ team }: { team: { title: string; picks: DreamPick[] } }): JSX.Element {
  return (
    <div className="paper-report">
      <div className="paper-label">{team.title}</div>
      <DreamCourt picks={team.picks} />
    </div>
  );
}

/** One of the shortlisted: a player, a coach, or the manager himself. */
function NomineeRow({ n, winner }: { n: Nominee; winner: boolean }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const club = world.clubs[n.clubId];
  const you = n.coach === -1;
  const coach = n.coach !== undefined && n.coach >= 0 ? world.staff[n.coach] : undefined;
  const name = n.p !== undefined ? store.fullName(n.p)
    : you ? `${world.manager.firstName} ${world.manager.lastName}` : coach !== undefined ? `${coach.firstName} ${coach.lastName}` : '—';
  const open = (): void => {
    if (n.p !== undefined) g.select(n.p);
    else if (coach !== undefined) g.selectCoach(coach.id);
    else if (you) g.go('career');
  };
  return (
    <div className={`aw-nominee${winner ? ' winner' : ''}${you || n.clubId === world.userClubId ? ' ours' : ''}`} onClick={open}>
      {n.p !== undefined
        ? <PlayerFace playerId={store.id[n.p]} name={name} size={winner ? 50 : 34} />
        : <span className={`aw-coach${winner ? ' lg' : ''}`}>{initials(name)}</span>}
      <div className="aw-nominee-main">
        <strong>{name}{you && <span className="aw-you">You</span>}</strong>
        <span className="aw-nominee-club">{club !== undefined && <><ClubCrest club={club} size={14} /> {club.name}</>}</span>
        <span className="aw-nominee-value">{n.value}</span>
      </div>
    </div>
  );
}

/** A night of awards: each with its winner and the two behind him, the team of the season, and the world's other honours. */
export function AwardsNightSheet({ night }: { night: AwardsNight }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const season = `${world.startYear + night.season}/${String(world.startYear + night.season + 1).slice(2)}`;
  return (
    <div className="aw">
      {night.awards.map((a) => (
        <div key={a.kind} className={`paper-report aw-award ${a.kind}`}>
          <div className="paper-label">{accoladeTitle(world, { kind: a.kind, scope: night.scope })} · {season}</div>
          <NomineeRow n={a.shortlist[0]} winner />
          {a.shortlist.length > 1 && (
            <div className="aw-shortlist">
              <span className="aw-shortlist-label">Also shortlisted</span>
              {a.shortlist.slice(1).map((n, i) => <NomineeRow key={i} n={n} winner={false} />)}
            </div>
          )}
        </div>
      ))}
      {night.team.length > 0 && (
        <div className="paper-report">
          <div className="paper-label">{accoladeTitle(world, { kind: 'team', scope: night.scope })}</div>
          <DreamCourt picks={night.team} />
        </div>
      )}
      {night.extras !== undefined && night.extras.length > 0 && (
        <div className="paper-report">
          <div className="paper-label">Also honoured</div>
          {night.extras.map((x, i) => (
            <div key={i} className="paper-report-row clickable" onClick={() => g.select(x.playerIdx)}>
              <span>{x.label}</span>
              <b>{x.detail}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
