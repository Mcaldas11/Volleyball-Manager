import { useState, type JSX } from 'react';
import { compareTableRows, setRatio } from '../../engine/model/club.ts';
import type { RallyContact, RallyLogEntry } from '../../engine/match/engine.ts';
import { matchRating } from '../../engine/match/playerRating.ts';
import { aggregateTeam, sideOutPct, breakPointPct } from '../../engine/match/stats.ts';
import type { Position } from '../../engine/model/positions.ts';
import { playoffBandSizes } from '../../engine/season/playoffs.ts';
import type { Competition, PlayoffGroup, PlayoffTie, World } from '../../engine/world/world.ts';
import {
  Card, ClubCrest, ClubLink, Empty, FormGuide, PlayerLink, RatingBadge, Segmented, StatTile,
} from '../components.tsx';
import { useGame } from '../state.ts';

type NameLookup = { shortName: (i: number) => string };

export function FixturesScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const fixtures = g.ownFixtures();
  const watched = g.reviewLast();
  const played = fixtures.filter((f) => f.played);
  const wins = played.filter((f) => {
    const isHome = f.home === world.userClubId;
    return isHome ? f.homeSets > f.awaySets : f.awaySets > f.homeSets;
  }).length;
  const nextIdx = fixtures.findIndex((f) => !f.played);

  return (
    <>
      <div className="tiles">
        <StatTile label="Played" value={`${played.length}/${fixtures.length}`} sub="matches this season" />
        <StatTile label="Won" value={wins} tone="good" />
        <StatTile label="Lost" value={played.length - wins} tone={played.length - wins > 0 ? 'bad' : undefined} />
        <StatTile
          label="Win rate"
          value={played.length > 0 ? `${Math.round((wins / played.length) * 100)}%` : '—'}
        />
      </div>

      {watched !== null && <MatchScreen />}

      <Card title="Schedule" icon="schedule" flush>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Rd</th>
                <th>Competition</th>
                <th>Venue</th>
                <th>Opponent</th>
                <th>Result</th>
                <th>Sets</th>
              </tr>
            </thead>
            <tbody>
              {fixtures.map((f, i) => {
                const isHome = f.home === world.userClubId;
                const opponent = world.clubs[isHome ? f.away : f.home];
                const comp = world.competitions[f.competitionId];
                const won = f.played && ((isHome && f.homeSets > f.awaySets) || (!isHome && f.awaySets > f.homeSets));
                return (
                  <tr key={f.id} className={i === nextIdx ? 'next-fixture' : ''}>
                    <td className="dim">
                      {g.weekdayLabelForDay(f.day)} {g.dateLabelForDay(f.day)}
                      {i === nextIdx && <span className="next-tag">Next</span>}
                    </td>
                    <td className="num faint">{f.round >= 1000 ? 'PO' : f.round + 1}</td>
                    <td className="faint">{comp?.name ?? ''}</td>
                    <td><span className={`venue-tag ${isHome ? 'home' : 'away'}`}>{isHome ? 'Home' : 'Away'}</span></td>
                    <td>{opponent !== undefined ? <ClubLink id={opponent.id} /> : '—'}</td>
                    <td>
                      {f.played
                        ? (
                          <span className={`result-badge ${won ? 'win' : 'loss'}`}>
                            {won ? 'W' : 'L'} {isHome ? f.homeSets : f.awaySets}-{isHome ? f.awaySets : f.homeSets}
                          </span>
                        )
                        : <span className="faint">—</span>}
                    </td>
                    <td className="faint mono">
                      {f.setScores.map(([h, a]) => `${isHome ? h : a}-${isHome ? a : h}`).join('  ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

type ReportTab = 'log' | 'box' | 'rotations';

/**
 * The match viewer.
 *
 * This is where the rally engine earns its keep: every point can be read back
 * contact by contact, with the running win probability and the full box score
 * alongside. If a set was lost in rotation 3, the rotation table says so.
 */
export function MatchScreen(): JSX.Element {
  const g = useGame();
  const watched = g.reviewLast();
  const [tab, setTab] = useState<ReportTab>('log');
  if (watched === null) return <Empty>No match has been played yet.</Empty>;

  const { result, homeName, awayName } = watched;
  const world = g.world!;
  const homeClub = world.clubs[watched.fixture.home];
  const awayClub = world.clubs[watched.fixture.away];
  const homeWon = result.homeSets > result.awaySets;

  return (
    <Card
      title="Last Match Report"
      icon="stats"
      className="match-report"
      actions={(
        <Segmented<ReportTab>
          size="sm"
          options={[['log', 'Rally log'], ['box', 'Box score'], ['rotations', 'Rotation analysis']]}
          value={tab}
          onChange={setTab}
        />
      )}
    >
      <div className="report-score">
        <div className={`report-team${homeWon ? ' won' : ''}`}>
          {homeClub !== undefined && <ClubCrest club={homeClub} size={44} />}
          <ClubLink id={watched.fixture.home} crest={false} />
        </div>
        <div className="report-center">
          <div className="report-sets">
            <span className={homeWon ? 'won' : ''}>{result.homeSets}</span>
            <span className="report-sep">–</span>
            <span className={!homeWon ? 'won' : ''}>{result.awaySets}</span>
          </div>
          <div className="set-chips">
            {result.setScores.map(([h, a], i) => (
              <span key={i} className="set-chip">
                <span className={h > a ? 'won' : ''}>{h}</span>
                <span className={a > h ? 'won' : ''}>{a}</span>
              </span>
            ))}
          </div>
        </div>
        <div className={`report-team right${!homeWon ? ' won' : ''}`}>
          <ClubLink id={watched.fixture.away} crest={false} />
          {awayClub !== undefined && <ClubCrest club={awayClub} size={44} />}
        </div>
      </div>
      <div className="report-meta">
        {result.mvp >= 0 && <span className="mvp-tag">MVP</span>}
        {result.mvp >= 0 && <PlayerLink idx={result.mvp} />}
        {result.mvp >= 0 && <MvpRating />}
        <span className="faint">{result.totalRallies} rallies simulated</span>
      </div>

      {tab === 'log' && (
        <RallyLog
          log={result.log ?? []}
          homeCode={homeClub?.shortName ?? homeName.slice(0, 3).toUpperCase()}
          awayCode={awayClub?.shortName ?? awayName.slice(0, 3).toUpperCase()}
        />
      )}
      {tab === 'box' && <BoxScore />}
      {tab === 'rotations' && <RotationAnalysis />}
    </Card>
  );
}

function RallyLog({
  log, homeCode, awayCode,
}: {
  log: RallyLogEntry[];
  homeCode: string;
  awayCode: string;
}): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  // Only the last set is shown by default; a full five-setter is 200+ rallies.
  const [setFilter, setSetFilter] = useState<number>(-1);
  const sets = [...new Set(log.map((r) => r.set))];
  const shown = setFilter < 0 ? log.slice(-60) : log.filter((r) => r.set === setFilter);

  return (
    <>
      <div className="toolbar">
        <Segmented
          size="sm"
          options={[[-1, 'Last 60'], ...sets.map((s) => [s, `Set ${s + 1}`] as const)]}
          value={setFilter}
          onChange={setSetFilter}
        />
      </div>
      <div className="ticker-scroll">
        <RallyTicker entries={shown} store={store} homeCode={homeCode} awayCode={awayCode} showProb />
      </div>
    </>
  );
}

/**
 * A live-ticker style feed: one card per rally, the scoring team's code, and
 * a short headline built around whoever decided the point.
 */
export function RallyTicker({
  entries, store, homeCode, awayCode, showProb = false,
}: {
  entries: RallyLogEntry[];
  store: NameLookup;
  homeCode: string;
  awayCode: string;
  showProb?: boolean;
}): JSX.Element {
  return (
    <div className="ticker">
      {entries.map((r, i) => {
        const { before, player, after } = describeRallyHighlight(r, store);
        const isHome = r.winner === 0;
        return (
          <div key={i} className={`ticker-entry ${isHome ? 'home-point' : 'away-point'}`}>
            <span className="ticker-score mono">{r.scoreBefore[0]}-{r.scoreBefore[1]}</span>
            <span className={`ticker-pill ${isHome ? 'home' : 'away'}`}>{isHome ? homeCode : awayCode}</span>
            <span className="ticker-text">
              {before}
              {player !== '' && <strong className="ticker-player">{player}</strong>}
              {after}
            </span>
            {showProb && (
              <span className="ticker-prob" title="Home win probability">
                {(r.homeWinProb * 100).toFixed(0)}%
              </span>
            )}
          </div>
        );
      })}
      {entries.length === 0 && <div className="ticker-entry dim">No rallies recorded.</div>}
    </div>
  );
}

/** Turn a rally's contacts into a sentence a volleyball person would recognise. */
export function describeRally(r: RallyLogEntry, store: NameLookup): string {
  const parts: string[] = [];
  for (const c of r.contacts) {
    parts.push(describeContact(c, store));
  }
  const text = parts.filter((p) => p !== '').join(' → ');
  return text === '' ? 'Rally' : text;
}

function describeContact(c: RallyContact, store: NameLookup): string {
  const who = store.shortName(c.player);
  switch (c.kind) {
    case 'serve': return `${who} serves (${c.detail})`;
    case 'ace': return `ACE ${who}`;
    case 'serveError': return `${who} serve error`;
    case 'reception': return `${who} passes ${c.detail}`;
    case 'receptionError': return `${who} shanks the pass`;
    case 'setError': return `${who} setting error`;
    case 'attack': return `${who} attacks (${c.detail})`;
    case 'kill': return `KILL ${who} (${c.detail})`;
    case 'attackError': return `${who} attack error`;
    case 'blocked': return `${who} STUFFED`;
    case 'blockTouch': return `${who} touch`;
    case 'dig': return `${who} digs`;
    case 'freeball': return 'free ball over';
    default: return '';
  }
}

/** One-line headline for a rally, built around whoever decided the point — for the live ticker. */
const HIGHLIGHT_TEMPLATES: Partial<Record<RallyContact['kind'], [string, string]>> = {
  ace: ['Ace — ', ' serves it straight through.'],
  kill: ['Kill — ', ' finishes it off.'],
  blocked: ['Stuffed at the net — ', "'s attack goes nowhere."],
  attackError: ['Attack error — ', ' puts it wide.'],
  serveError: ['Serve error — ', ' into the net.'],
  receptionError: ['Reception error — ', ' shanks the pass.'],
  setError: ['Setting error — ', ' the set goes astray.'],
  digError: ['Dig error — ', " can't keep it up."],
};

export function describeRallyHighlight(
  r: RallyLogEntry,
  store: NameLookup,
): { before: string; player: string; after: string } {
  const last = r.contacts[r.contacts.length - 1];
  const template = last !== undefined ? HIGHLIGHT_TEMPLATES[last.kind] : undefined;
  if (last === undefined || template === undefined) {
    return { before: describeRally(r, store), player: '', after: '' };
  }
  return { before: template[0], player: store.shortName(last.player), after: template[1] };
}

/** The match MVP's rating, read off the same stat line as the box score. */
function MvpRating(): JSX.Element | null {
  const g = useGame();
  const watched = g.reviewLast();
  if (watched === null) return null;
  const { result } = watched;
  const store = g.world!.players;
  const homeLine = result.stats.home.players.get(result.mvp);
  const line = homeLine ?? result.stats.away.players.get(result.mvp);
  if (line === undefined) return null;
  const [setsFor, setsAgainst] = homeLine !== undefined
    ? [result.homeSets, result.awaySets]
    : [result.awaySets, result.homeSets];
  return <RatingBadge value={matchRating(line, store.position[result.mvp] as Position, setsFor, setsAgainst)} />;
}

function BoxScore(): JSX.Element {
  const g = useGame();
  const watched = g.reviewLast()!;
  const store = g.world!.players;

  const table = (
    label: string,
    teamStats: typeof watched.result.stats.home,
    setsFor: number,
    setsAgainst: number,
  ): JSX.Element => {
    const rows = [...teamStats.players.values()]
      .filter((s) => s.attacksTotal > 0 || s.servesTotal > 0 || s.receptionsTotal > 0)
      .sort((a, b) =>
        (b.attackKills + b.serveAces + b.blockPoints) - (a.attackKills + a.serveAces + a.blockPoints));
    const total = aggregateTeam(teamStats);
    return (
      <div className="box-score">
        <h4 className="section-label">{label}</h4>
        <table className="data-table">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num" title="Match rating">Rat</th>
              <th className="num" title="Total points">Pts</th>
              <th className="num" title="Kills / attempts">K/Att</th>
              <th className="num" title="Attack efficiency">Eff</th>
              <th className="num" title="Aces">Ace</th>
              <th className="num" title="Block points">Blk</th>
              <th className="num" title="Errors">Err</th>
              <th className="num" title="Reception positivity">Rec+</th>
              <th className="num" title="Digs">Dig</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const eff = s.attacksTotal > 0
                ? (s.attackKills - s.attackErrors - s.attackBlocked) / s.attacksTotal : 0;
              const recPos = s.receptionsTotal > 0
                ? (s.receptionPerfect + s.receptionPositive) / s.receptionsTotal : 0;
              return (
                <tr key={s.playerIdx} className="clickable" onClick={() => g.select(s.playerIdx)}>
                  <td className="strong">{store.fullName(s.playerIdx)}</td>
                  <td className="num">
                    <RatingBadge
                      value={matchRating(s, store.position[s.playerIdx] as Position, setsFor, setsAgainst)}
                      size="sm"
                    />
                  </td>
                  <td className="num"><strong>{s.attackKills + s.serveAces + s.blockPoints}</strong></td>
                  <td className="num dim">{s.attackKills}/{s.attacksTotal}</td>
                  <td className={`num ${eff > 0.3 ? 'good' : eff < 0.1 ? 'bad' : ''}`}>
                    {s.attacksTotal > 0 ? eff.toFixed(3) : '—'}
                  </td>
                  <td className="num">{s.serveAces}</td>
                  <td className="num">{s.blockPoints}</td>
                  <td className="num bad">{s.attackErrors + s.serveErrors + s.receptionErrors}</td>
                  <td className="num dim">
                    {s.receptionsTotal > 0 ? `${(recPos * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="num dim">{s.digsTotal}</td>
                </tr>
              );
            })}
            <tr className="total-row">
              <td>Team</td>
              <td />
              <td className="num">{total.attackKills + total.serveAces + total.blockPoints}</td>
              <td className="num dim">{total.attackKills}/{total.attacksTotal}</td>
              <td className="num">
                {total.attacksTotal > 0
                  ? ((total.attackKills - total.attackErrors - total.attackBlocked) / total.attacksTotal).toFixed(3)
                  : '—'}
              </td>
              <td className="num">{total.serveAces}</td>
              <td className="num">{total.blockPoints}</td>
              <td className="num bad">{total.attackErrors + total.serveErrors + total.receptionErrors}</td>
              <td className="num dim">
                {total.receptionsTotal > 0
                  ? `${(((total.receptionPerfect + total.receptionPositive) / total.receptionsTotal) * 100).toFixed(0)}%`
                  : '—'}
              </td>
              <td className="num dim">{total.digsTotal}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="grid2">
      {table(watched.homeName, watched.result.stats.home, watched.result.homeSets, watched.result.awaySets)}
      {table(watched.awayName, watched.result.stats.away, watched.result.awaySets, watched.result.homeSets)}
    </div>
  );
}

/**
 * Per-rotation breakdown — the screen that tells a coach *where* a match was
 * lost, rather than merely that it was.
 */
function RotationAnalysis(): JSX.Element {
  const g = useGame();
  const watched = g.reviewLast()!;

  const table = (label: string, stats: typeof watched.result.stats.home): JSX.Element => (
    <div className="box-score">
      <h4 className="section-label">{label}</h4>
      <table className="data-table">
        <thead>
          <tr>
            <th>Rotation</th>
            <th className="num" title="Rallies played receiving">Rec</th>
            <th className="num" title="Side-out percentage">Side-out</th>
            <th className="num" title="Rallies played serving">Srv</th>
            <th className="num" title="Break-point percentage">Break</th>
            <th className="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {stats.rotations.map((r, i) => {
            const so = sideOutPct(r);
            const bp = breakPointPct(r);
            const net = (r.sideOutsWon + r.servePointsWon) -
              ((r.receiveRallies - r.sideOutsWon) + (r.serveRallies - r.servePointsWon));
            return (
              <tr key={i}>
                <td className="strong">P{i + 1}</td>
                <td className="num dim">{r.receiveRallies}</td>
                <td className={`num ${so > 0.68 ? 'good' : so < 0.55 ? 'bad' : ''}`}>
                  {r.receiveRallies > 0 ? `${(so * 100).toFixed(0)}%` : '—'}
                </td>
                <td className="num dim">{r.serveRallies}</td>
                <td className={`num ${bp > 0.42 ? 'good' : bp < 0.30 ? 'bad' : ''}`}>
                  {r.serveRallies > 0 ? `${(bp * 100).toFixed(0)}%` : '—'}
                </td>
                <td className="num">
                  <span className={`net-badge ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}`}>
                    {net > 0 ? `+${net}` : net}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="grid2">
        {table(watched.homeName, watched.result.stats.home)}
        {table(watched.awayName, watched.result.stats.away)}
      </div>
      <p className="footnote">
        Rotations are named for the zone the setter occupies. Side-out above 68% is strong; below 55%
        is a rotation that needs a different first-ball option — change it under Tactics › Rotations.
      </p>
    </>
  );
}

/** Each club's last five results in a competition, oldest first. */
function formByClub(comp: Competition, world: World): Map<number, Array<'W' | 'L'>> {
  const form = new Map<number, Array<'W' | 'L'>>();
  const played = comp.fixtureIds
    .map((id) => world.fixtures[id])
    .filter((f) => f !== undefined && f.played)
    .sort((a, b) => a.day - b.day);
  for (const f of played) {
    const homeWon = f.homeSets > f.awaySets;
    for (const [club, won] of [[f.home, homeWon], [f.away, !homeWon]] as const) {
      const list = form.get(club) ?? [];
      list.push(won ? 'W' : 'L');
      if (list.length > 5) list.shift();
      form.set(club, list);
    }
  }
  return form;
}

export function TableScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const comp = world.competitions[club.leagueId];
  const [tab, setTab] = useState('table');
  if (comp === undefined) return <Empty>No league assigned.</Empty>;

  const rows = [...comp.table].sort(compareTableRows);
  const { championship: champSize, relegation: relegationSize } = playoffBandSizes(comp);
  const activeGroup = comp.playoffGroups.find((grp) => grp.id === tab);
  const form = formByClub(comp, world);

  return (
    <>
      <div className="comp-bar">
        <div className="comp-bar-title">
          <span className="comp-bar-name">{comp.name}</span>
          <span className="faint">Tier {comp.tier} · {comp.participants.length} clubs</span>
        </div>
        {comp.playoffGroups.length > 0 && (
          <Segmented
            options={[['table', 'Table'], ...comp.playoffGroups.map((grp) => [grp.id, grp.label] as const)]}
            value={tab}
            onChange={setTab}
          />
        )}
      </div>

      {activeGroup !== undefined ? (
        <Card title={activeGroup.label} icon="trophy">
          <BracketView group={activeGroup} world={world} />
        </Card>
      ) : (
        <Card
          title="League Table"
          icon="trophy"
          flush
          actions={<span className="faint">3 pts for a 3-0 or 3-1 win, 2 for 3-2, 1 for losing 2-3</span>}
        >
          <div className="table-wrap">
            <table className="data-table league-table">
              <thead>
                <tr>
                  <th className="num">Pos</th>
                  <th>Club</th>
                  <th className="num">P</th>
                  <th className="num">W</th>
                  <th className="num">L</th>
                  <th className="num">Sets</th>
                  <th className="num">Ratio</th>
                  <th>Form</th>
                  <th className="num">Pts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const zone = i < champSize ? 'zone-champ' : i >= rows.length - relegationSize ? 'zone-releg' : '';
                  return (
                    <tr key={r.clubId} className={`${zone}${r.clubId === club.id ? ' me' : ''}`}>
                      <td className="num pos-cell">{i + 1}</td>
                      <td><ClubLink id={r.clubId} /></td>
                      <td className="num dim">{r.played}</td>
                      <td className="num">{r.won}</td>
                      <td className="num">{r.lost}</td>
                      <td className="num dim">{r.setsFor}:{r.setsAgainst}</td>
                      <td className="num dim">{setRatio(r).toFixed(2)}</td>
                      <td><FormGuide results={form.get(r.clubId) ?? []} /></td>
                      <td className="num pts-cell">{r.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {activeGroup === undefined && champSize > 0 && (
        <p className="legend">
          <span className="zone-key champ" /> Top {champSize} — championship playoff
          {relegationSize > 0 && (
            <><span className="zone-key releg" /> Bottom {relegationSize} — relegation playoff</>
          )}
        </p>
      )}
    </>
  );
}

/** How many rounds a bracket of `seedCount` entrants eventually needs. */
function totalPlayoffRounds(seedCount: number): number {
  let size = 1;
  let rounds = 0;
  while (size < seedCount) { size *= 2; rounds++; }
  return rounds;
}

function roundLabel(index: number, total: number): string {
  const fromEnd = total - index;
  if (fromEnd === 1) return 'Final';
  if (fromEnd === 2) return 'Semifinals';
  if (fromEnd === 3) return 'Quarterfinals';
  return `Round ${index + 1}`;
}

/** A single-elimination bracket: one column per round, filled in as results
 *  come in. Rounds not yet reached show as empty "TBD" placeholders so the
 *  whole shape of the playoff is visible from the day it is drawn. */
function BracketView({ group, world }: { group: PlayoffGroup; world: World }): JSX.Element {
  const totalRounds = totalPlayoffRounds(group.seeds.length);

  return (
    <div className="bracket">
      {Array.from({ length: totalRounds }, (_, ri) => {
        const round = group.rounds[ri];
        const tieCount = 2 ** (totalRounds - ri - 1);
        return (
          <div className="bracket-round" key={ri}>
            <div className="bracket-round-label">{roundLabel(ri, totalRounds)}</div>
            <div className="bracket-ties">
              {round !== undefined
                ? round.map((tie, ti) => (
                  <BracketTie key={ti} tie={tie} group={group} world={world} />
                ))
                : Array.from({ length: tieCount }, (_, ti) => (
                  <div className="bracket-tie bracket-tie-pending" key={ti}>
                    <span className="faint">TBD</span>
                  </div>
                ))}
            </div>
          </div>
        );
      })}
      {group.resolved && (
        <div className="bracket-round bracket-round-winner">
          <div className="bracket-round-label">Winner</div>
          <div className="bracket-tie">
            <div className="bracket-slot winner">
              <ClubLink id={group.finalOrder[0]} short />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BracketTie({
  tie, group, world,
}: {
  tie: PlayoffTie;
  group: PlayoffGroup;
  world: World;
}): JSX.Element {
  const fixture = tie.fixtureId >= 0 ? world.fixtures[tie.fixtureId] : undefined;
  const played = fixture !== undefined && fixture.played;

  const slot = (seed: number, sets: number | undefined): JSX.Element | null => {
    if (seed === -1) return null;
    const clubId = group.seeds[seed];
    return (
      <div className={`bracket-slot${tie.winnerSeed === seed ? ' winner' : ''}`}>
        <span className="bracket-seed">{seed + 1}</span>
        <ClubLink id={clubId} short />
        <span className="bracket-score">{played ? sets : ''}</span>
      </div>
    );
  };

  return (
    <div className="bracket-tie">
      {slot(tie.homeSeed, fixture?.homeSets)}
      {tie.awaySeed === -1
        ? <div className="bracket-slot bracket-bye"><span className="faint">Bye</span></div>
        : slot(tie.awaySeed, fixture?.awaySets)}
    </div>
  );
}
