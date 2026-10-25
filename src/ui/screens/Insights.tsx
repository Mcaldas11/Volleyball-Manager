/**
 * The newer parts of a career: the Data Hub, the social feed, the coaches' world ranking and their
 * legends, the fantasy draft, the job interview, and the ways to begin — out of work, with a
 * challenge, or with a club of your own.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { CHALLENGES, challengeClubs, type ChallengeId } from '../../engine/world/challenges.ts';
import { coachLegends, coachRanking } from '../../engine/world/coachLegends.ts';
import { clubToReplace, draftNeed, draftPosition, draftTurn } from '../../engine/world/createClub.ts';
import { HUB_METRIC_KEYS, HUB_METRICS, leagueHub, rotationHub, type HubMetric } from '../../engine/world/dataHub.ts';
import { interviewEffect, interviewQuestions, interviewReaction, interviewVerdict, type InterviewReaction } from '../../engine/world/jobInterview.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { socialFeed } from '../../engine/world/socialFeed.ts';
import { POSITION_NAMES, POSITIONS, type Position } from '../../engine/model/positions.ts';
import type { Club } from '../../engine/model/club.ts';
import { abilityClass, Card, ClubCrest, Empty, Flag, PlayerFace, Pos, Segmented, StarMeter } from '../components.tsx';
import { Dropdown } from '../dropdown.tsx';
import { Icon } from '../icons.tsx';
import { clubKit } from '../kits.ts';
import { useGame } from '../state.ts';

const fmt = (m: HubMetric, v: number): string => (HUB_METRICS[m].pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(2));

// ---- The Data Hub -----------------------------------------------------------------------------

export function DataHubScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const leagues = world.competitions.filter((c) => c.kind === 'league' && c.participants.length > 0);
  const [compId, setCompId] = useState(club.leagueId);
  const [x, setX] = useState<HubMetric>('attackEff');
  const [y, setY] = useState<HubMetric>('passPct');
  const hub = useMemo(() => leagueHub(world, compId), [world, compId, world.day]);
  const rot = useMemo(() => rotationHub(world, club.id), [world, club.id, world.day]);
  const metricOptions = HUB_METRIC_KEYS.map((k) => ({ value: k, label: HUB_METRICS[k].name }));

  return (
    <div className="hub">
      <div className="hub-controls">
        <Dropdown size="sm" value={compId} onChange={setCompId} className="hub-league"
          options={leagues.map((l) => ({ value: l.id, label: l.name, icon: <Flag nation={l.nation} />, group: NATIONS[l.nation]?.name }))} />
        <span className="faint">Across</span>
        <Dropdown size="sm" value={x} onChange={setX} options={metricOptions} />
        <span className="faint">Up</span>
        <Dropdown size="sm" value={y} onChange={setY} options={metricOptions} />
      </div>
      <div className="hub-grid">
        <div className="hub-left">
          <Card title={`${HUB_METRICS[y].name} against ${HUB_METRICS[x].name.toLowerCase()}`} icon="stats" className="hub-card">
            {hub.rows.length < 2 ? <Empty>Not enough matches played in this league yet.</Empty> : <Scatter rows={hub.rows} average={hub.average} x={x} y={y} you={club.id} />}
          </Card>
          <Card title="Your rotations: side-out, break point, expected points" icon="tactics" className="hub-rot">
            {rot === null ? <Empty>Play a match to see your rotations.</Empty> : (
              <div className="hub-rots">
                {rot.ours.map((r, i) => (
                  <div key={i} className="hub-rot-col" title={`P${i + 1}: side-out ${Math.round(r.sideOut * 100)}%, break point ${Math.round(r.breakPoint * 100)}%, ${r.expected.toFixed(1)} points per 10 rallies (${r.rallies} rallies)`}>
                    <span className="hub-rot-bars">
                      <i className={`so${r.sideOut >= rot.theirs.sideOut ? ' good' : ' bad'}`} style={{ height: `${r.sideOut * 100}%` }} />
                      <i className="bp" style={{ height: `${r.breakPoint * 100}%` }} />
                      <b className="hub-rot-avg" style={{ bottom: `${rot.theirs.sideOut * 100}%` }} />
                    </span>
                    <small>P{i + 1}</small>
                    <strong>{r.expected.toFixed(1)}</strong>
                  </div>
                ))}
                <div className="hub-rot-key faint">
                  <span><i className="so good" /> Side-out</span><span><i className="bp" /> Break point</span>
                  <span><b className="hub-rot-avg" /> Opponents' side-out: {Math.round(rot.theirs.sideOut * 100)}%</span>
                  <span>Bold: points per 10 rallies</span>
                </div>
              </div>
            )}
          </Card>
        </div>
        <Card title="The league, measured" icon="stats" flush className="hub-card">
          <div className="table-wrap hub-table">
            <table className="data-table">
              <thead>
                <tr><th>Club</th>{HUB_METRIC_KEYS.map((k) => <th key={k} className="num" title={HUB_METRICS[k].name}>{HUB_METRICS[k].short}</th>)}</tr>
              </thead>
              <tbody>
                {[...hub.rows].sort((a, b) => b.values.winPct - a.values.winPct).map((r) => {
                  const c = world.clubs[r.clubId];
                  return (
                    <tr key={r.clubId} className={r.clubId === club.id ? 'row-you' : ''}>
                      <td><span className="rc-club">{c !== undefined && <ClubCrest club={c} size={16} />}{c?.shortName}</span></td>
                      {HUB_METRIC_KEYS.map((k) => {
                        const better = HUB_METRICS[k].higherIsBetter ? r.values[k] > hub.average[k] : r.values[k] < hub.average[k];
                        return <td key={k} className={`num ${better ? 'good-text' : 'dim'}`}>{fmt(k, r.values[k])}</td>;
                      })}
                    </tr>
                  );
                })}
                {hub.rows.length > 0 && (
                  <tr className="row-avg"><td>League average</td>{HUB_METRIC_KEYS.map((k) => <td key={k} className="num">{fmt(k, hub.average[k])}</td>)}</tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Every side as a dot: across and up by the two measures, the league's average as dashed lines. */
function Scatter({ rows, average, x, y, you }: {
  rows: ReturnType<typeof leagueHub>['rows'];
  average: ReturnType<typeof leagueHub>['average'];
  x: HubMetric;
  y: HubMetric;
  you: number;
}): JSX.Element {
  const g = useGame();
  const world = g.world!;
  // Drawn to the size of its box, so the text stays its size however the card is shaped.
  const box = useRef<HTMLDivElement>(null);
  const [[W, H], setSize] = useState<[number, number]>([640, 360]);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const fit = (): void => setSize([Math.max(200, el.clientWidth), Math.max(140, el.clientHeight)]);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pad = { l: 56, r: 18, t: 16, b: 40 };
  const xs = rows.map((r) => r.values[x]);
  const ys = rows.map((r) => r.values[y]);
  const span = (v: number[]): [number, number] => {
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    const m = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 0.1;
    return [lo - m, hi + m];
  };
  const [x0, x1] = span(xs);
  const [y0, y1] = span(ys);
  const px = (v: number): number => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const py = (v: number): number => H - pad.b - ((v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const ticks = (lo: number, hi: number): number[] => Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  return (
    <div className="hub-scatter" ref={box}>
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Scatter of the league's clubs">
      {ticks(x0, x1).map((v) => (
        <g key={`x${v}`}>
          <line x1={px(v)} x2={px(v)} y1={pad.t} y2={H - pad.b} className="hub-grid-line" />
          <text x={px(v)} y={H - pad.b + 16} className="hub-tick" textAnchor="middle">{fmt(x, v)}</text>
        </g>
      ))}
      {ticks(y0, y1).map((v) => (
        <g key={`y${v}`}>
          <line x1={pad.l} x2={W - pad.r} y1={py(v)} y2={py(v)} className="hub-grid-line" />
          <text x={pad.l - 8} y={py(v) + 4} className="hub-tick" textAnchor="end">{fmt(y, v)}</text>
        </g>
      ))}
      <line x1={px(average[x])} x2={px(average[x])} y1={pad.t} y2={H - pad.b} className="hub-avg" />
      <line x1={pad.l} x2={W - pad.r} y1={py(average[y])} y2={py(average[y])} className="hub-avg" />
      <text x={W - pad.r} y={H - 6} className="hub-axis" textAnchor="end">{HUB_METRICS[x].name} →</text>
      <text x={12} y={pad.t + 4} className="hub-axis" transform={`rotate(-90 12 ${pad.t + 4})`} textAnchor="end">← {HUB_METRICS[y].name}</text>
      {rows.map((r) => {
        const c = world.clubs[r.clubId];
        const mine = r.clubId === you;
        const cx = px(r.values[x]);
        const cy = py(r.values[y]);
        return (
          <g key={r.clubId} className={`hub-dot${mine ? ' you' : ''}`}>
            <title>{`${c?.name}: ${HUB_METRICS[x].short} ${fmt(x, r.values[x])}, ${HUB_METRICS[y].short} ${fmt(y, r.values[y])}`}</title>
            <circle cx={cx} cy={cy} r={mine ? 9 : 7} fill={c !== undefined ? clubKit(c).shirt : '#888'} />
            <text x={cx + (mine ? 13 : 10)} y={cy + 4} className="hub-label">{c?.shortName}</text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

// ---- The social feed --------------------------------------------------------------------------

export function SocialScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [filter, setFilter] = useState<'all' | 'club'>('all');
  const feed = useMemo(() => socialFeed(world, g.club !== null ? filter : 'all'), [world, world.day, filter]);
  const trending = [...feed].sort((a, b) => b.likes - a.likes).slice(0, 6);
  return (
    <div className="social">
      <Card title="Timeline" icon="news" flush className="social-feed-card"
        actions={g.club !== null ? <Segmented size="sm" value={filter} onChange={setFilter} options={[['all', 'Everyone'], ['club', 'Your club']]} /> : undefined}>
        <div className="social-feed">
          {feed.length === 0 && <Empty>Nothing yet — the season is young.</Empty>}
          {feed.map((post) => {
            const club = post.clubId !== undefined ? world.clubs[post.clubId] : undefined;
            return (
              <article key={post.key} className={`social-post k-${post.kind}`}>
                <div className="social-avatar">
                  {post.kind === 'player' && post.p !== undefined
                    ? <PlayerFace playerId={world.players.id[post.p]} name={post.author} size={38} />
                    : post.kind === 'club' && club !== undefined ? <ClubCrest club={club} size={34} /> : <span className="social-outlet"><Icon name="news" size={18} /></span>}
                </div>
                <div className="social-body">
                  <div className="social-head">
                    <b className={post.p !== undefined ? 'player-link' : undefined} onClick={post.p !== undefined ? () => g.select(post.p!) : undefined}>{post.author}</b>
                    {post.kind !== 'press' && <Icon name="check" size={11} />}
                    <span className="faint">{post.handle} · {g.dateLabelForDay(post.day)}</span>
                  </div>
                  <p className="social-text">{post.text}</p>
                  <div className="social-meta faint">
                    <span>♥ {post.likes.toLocaleString()}</span><span>↻ {post.reposts.toLocaleString()}</span>
                    {post.replies.length > 0 && <span>💬 {post.replies.length}</span>}
                  </div>
                  {post.replies.map((r, i) => (
                    <div key={i} className="social-reply">
                      <b>{r.handle}</b> <span>{r.text}</span>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </Card>
      <Card title="Trending" icon="star" className="social-side">
        <ol className="social-trending">
          {trending.map((p) => (
            <li key={p.key}>
              <b>{p.author}</b>
              <span>{p.text.split('\n')[0]}</span>
              <small className="faint">♥ {p.likes.toLocaleString()}</small>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

// ---- The coaches ------------------------------------------------------------------------------

export function CoachesScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const ranking = useMemo(() => coachRanking(world).slice(0, 100), [world, world.day]);
  const [by, setBy] = useState<'club' | 'nation'>('club');
  const [clubId, setClubId] = useState(world.userClubId >= 0 ? world.userClubId : world.clubs.find((c) => c.tier === 1)?.id ?? 0);
  const [nation, setNation] = useState(world.manager.nation);
  const legends = useMemo(() => coachLegends(world, by === 'club' ? { clubId } : { nation }), [world, by, clubId, nation]);
  const clubs = world.clubs.filter((c) => c.tier === 1 && c.players.length > 0).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="coaches">
      <Card title="World ranking — head coaches" icon="career" flush className="coaches-card">
        <div className="table-wrap coaches-table">
          <table className="data-table">
            <thead><tr><th className="num">#</th><th>Coach</th><th>Club</th><th className="num">Reputation</th><th className="num">Titles</th><th className="num">W–L</th></tr></thead>
            <tbody>
              {ranking.map((c, i) => {
                const club = world.clubs[c.clubId];
                return (
                  <tr key={c.staffId} className={c.staffId === -1 ? 'row-you' : ''}>
                    <td className="num">{i + 1}</td>
                    <td><span className="rc-club"><Flag nation={c.nation} /> {c.name}{c.staffId === -1 && <span className="your-club-tag">You</span>}</span></td>
                    <td>{club !== undefined ? <span className="rc-club"><ClubCrest club={club} size={16} />{club.shortName}</span> : <span className="faint">Out of work</span>}</td>
                    <td className="num"><StarMeter value={c.reputation} max={10000} size={11} /></td>
                    <td className="num">{c.titles.length}</td>
                    <td className="num dim">{c.won}–{c.lost}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Coaching legends" icon="trophy" flush className="coaches-card">
        <div className="coaches-pick">
          <Segmented size="sm" value={by} onChange={setBy} options={[['club', 'Club'], ['nation', 'Country']]} />
          {by === 'club'
            ? <Dropdown size="sm" value={clubId} onChange={setClubId} options={clubs.map((c) => ({ value: c.id, label: c.name, icon: <ClubCrest club={c} size={14} /> }))} />
            : <Dropdown size="sm" value={nation} onChange={setNation} options={NATIONS.map((n, i) => ({ value: i, label: n.name, icon: <Flag nation={i} /> }))} />}
        </div>
        <div className="coaches-legends">
          {legends.length === 0 && <Empty>No coach has won a title here yet — the first will be a legend.</Empty>}
          {legends.slice(0, 30).map((c, i) => (
            <div key={c.staffId} className="coaches-legend">
              <span className={`coaches-rank${i < 3 ? ` top${i}` : ''}`}>{i + 1}</span>
              <span className="coaches-legend-main"><b><Flag nation={c.nation} /> {c.name}</b><small className="faint">{c.titles.length} titles in all · {c.won}–{c.lost}</small></span>
              <span className="coaches-here"><Icon name="trophy" size={13} /> {c.here}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---- The draft --------------------------------------------------------------------------------

export function DraftScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const d = world.draft!;
  const me = world.userClubId;
  const [pos, setPos] = useState<number>(-1);
  const turn = draftTurn(d);
  const mine = turn === me && !d.done;
  const at = draftPosition(d);
  const need = draftNeed(world, me);
  const pool = d.pool.filter((p) => pos < 0 || store.position[p] === pos).slice(0, 120);
  const squad = d.picks.filter((x) => x.clubId === me).map((x) => x.p);
  return (
    <div className="draft">
      <div className="draft-head">
        <div className="draft-title">
          <b>Fantasy draft</b>
          <span>{world.competitions[d.compId]?.name} · {d.order.length} clubs · {d.rounds} rounds</span>
        </div>
        <div className="draft-clock">
          {d.done ? <b>The draft is done</b> : <><span>Round {at.round} · pick {at.pick}</span><b>{mine ? 'You are on the clock' : 'Waiting…'}</b></>}
        </div>
        <div className="draft-actions">
          {!d.done && <button onClick={() => g.draftAutoPick()} disabled={!mine}><Icon name="star" size={13} /> Pick for me</button>}
          {!d.done && <button onClick={() => g.draftAutoAll()}><Icon name="fastForward" size={13} /> Draft the rest for me</button>}
          {d.done && <button className="primary" onClick={() => g.closeDraft()}>To your squad <Icon name="forward" size={14} /></button>}
        </div>
      </div>
      <div className="draft-grid">
        <Card title={`The pool · ${d.pool.length} left`} icon="scouting" flush className="draft-card"
          actions={<Segmented size="sm" value={pos} onChange={setPos} options={[[-1, 'All'], ...POSITIONS.map((p) => [p, POSITION_NAMES[p].split(' ')[0]] as const)]} />}>
          <div className="table-wrap draft-table">
            <table className="data-table">
              <thead><tr><th>Player</th><th>Pos</th><th className="num">Age</th><th>Ability</th><th className="num">Potential</th><th /></tr></thead>
              <tbody>
                {pool.map((p) => (
                  <tr key={p}>
                    <td><span className="player-link" onClick={() => g.select(p)}>{store.fullName(p)}</span></td>
                    <td><Pos pos={store.position[p] as Position} /></td>
                    <td className="num">{store.ageOn(p, world.year, 181)}</td>
                    <td><span className="ability-cell"><StarMeter value={store.currentAbility[p]} size={11} /><span className={abilityClass(store.currentAbility[p])}>{store.currentAbility[p]}</span></span></td>
                    <td className={`num ${abilityClass(store.potentialAbility[p])}`}>{store.potentialAbility[p]}</td>
                    <td className="num"><button className="sm primary" disabled={!mine} onClick={() => g.draftPick(p)}>Pick</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="draft-side">
          <Card title={`Your squad · ${squad.length}`} icon="squad" flush className="draft-card">
            <div className="draft-list">
              {!d.done && <p className="draft-need">You need most: <Pos pos={need} /> {POSITION_NAMES[need]}</p>}
              {squad.map((p) => (
                <div key={p} className="draft-row"><Pos pos={store.position[p] as Position} /><b>{store.fullName(p)}</b><span className={abilityClass(store.currentAbility[p])}>{store.currentAbility[p]}</span></div>
              ))}
            </div>
          </Card>
          <Card title="Latest picks" icon="news" flush className="draft-card">
            <div className="draft-list">
              {[...d.picks].reverse().slice(0, 40).map((x, i) => {
                const c = world.clubs[x.clubId];
                return (
                  <div key={i} className={`draft-row${x.clubId === me ? ' you' : ''}`}>
                    <small className="faint">#{d.picks.length - i}</small>
                    {c !== undefined && <ClubCrest club={c} size={15} />}
                    <b>{store.shortName(x.p)}</b><Pos pos={store.position[x.p] as Position} />
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---- The job interview ------------------------------------------------------------------------

export function InterviewDialog({ club, onClose }: { club: Club; onClose: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const questions = useMemo(() => interviewQuestions(club), [club]);
  const [reactions, setReactions] = useState<InterviewReaction[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const step = reactions.length;
  const done = step >= questions.length;
  const effect = interviewEffect(reactions);
  const answer = (id: string): void => {
    const q = questions[step];
    setReactions([...reactions, interviewReaction(world, club, q.topic, id)]);
    setChosen([...chosen, q.answers.find((a) => a.id === id)!.text]);
  };
  return (
    <div className="hol-overlay" onClick={onClose}>
      <div className="hol-card iv-card" role="dialog" aria-label="Job interview" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs"><ClubCrest club={club} size={16} /> <b>Interview · {club.name}</b></span>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="iv-body">
          {questions.slice(0, Math.min(step + 1, questions.length)).map((q, i) => (
            <div key={q.topic} className="iv-turn">
              <p className="iv-ask"><b>The board:</b> {q.ask}</p>
              {i < step ? (
                <>
                  <p className="iv-you"><b>You:</b> {chosen[i]}</p>
                  <p className={`iv-react ${reactions[i].score > 0.4 ? 'good' : reactions[i].score < -0.4 ? 'bad' : ''}`}>{reactions[i].line}</p>
                </>
              ) : (
                <div className="iv-answers">
                  {q.answers.map((a) => <button key={a.id} className="iv-answer" onClick={() => answer(a.id)}>{a.text}</button>)}
                </div>
              )}
            </div>
          ))}
          {done && <p className={`iv-verdict ${effect > 0.04 ? 'good' : effect < -0.04 ? 'bad' : ''}`}><Icon name="check" size={14} /> {interviewVerdict(effect)}</p>}
        </div>
        <footer className="iv-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!done} onClick={() => { g.applyForJob(club.id, effect); onClose(); }}>Send the application</button>
        </footer>
      </div>
    </div>
  );
}

// ---- How a career begins ----------------------------------------------------------------------

const SWATCHES = ['#1d4ed8', '#c8324a', '#0f7a3d', '#d7a73f', '#6b2fb3', '#111827', '#f2f3f5', '#e8641b', '#0e7490', '#7a1f2b'];

/** Under the club list: begin out of work, with a challenge, or with a club of your own. */
export function CareerStartOptions(): JSX.Element {
  const g = useGame();
  const [open, setOpen] = useState<'challenge' | 'create' | null>(null);
  return (
    <span className="start-options">
      <button onClick={() => g.startOutOfWork()} title="No club: apply for jobs from the Job Centre"><Icon name="career" size={14} /> Start unemployed</button>
      <button onClick={() => setOpen('challenge')}><Icon name="trophy" size={14} /> Challenges…</button>
      <button onClick={() => setOpen('create')}><Icon name="club" size={14} /> Create a club…</button>
      {open === 'challenge' && <ChallengeDialog onClose={() => setOpen(null)} />}
      {open === 'create' && <CreateClubDialog onClose={() => setOpen(null)} />}
    </span>
  );
}

function ChallengeDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [id, setId] = useState<ChallengeId>('survival');
  const clubs = useMemo(() => challengeClubs(world, id).slice(0, 40), [world, id]);
  const [clubId, setClubId] = useState<number | null>(null);
  const picked = clubId !== null && clubs.includes(clubId) ? clubId : clubs[0];
  const club = picked !== undefined ? world.clubs[picked] : undefined;
  return (
    <div className="hol-overlay" onClick={onClose}>
      <div className="hol-card iv-card" role="dialog" aria-label="Challenges" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs"><Icon name="trophy" size={12} /> <b>Challenges</b></span>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="ch-list">
          {CHALLENGES.map((c) => {
            const possible = challengeClubs(world, c.id).length > 0;
            return (
              <button key={c.id} className={`ch-item${id === c.id ? ' on' : ''}`} disabled={!possible} onClick={() => { setId(c.id); setClubId(null); }}>
                <b>{c.name}</b>
                <span>{c.goal}</span>
                <small className="faint">{possible ? (c.seasons === 1 ? 'One season' : `${c.seasons} seasons`) : 'Not in this world — try a bigger one'}</small>
              </button>
            );
          })}
        </div>
        {clubs.length > 0 && (
          <label className="form-field">
            <span>Club</span>
            <Dropdown value={picked ?? null} onChange={setClubId}
              options={clubs.map((cid) => ({ value: cid, label: world.clubs[cid].name, icon: <ClubCrest club={world.clubs[cid]} size={14} />, hint: world.competitions[world.clubs[cid].leagueId]?.name }))} />
          </label>
        )}
        <footer className="iv-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={club === undefined} onClick={() => { if (club !== undefined) g.takeChargeWithChallenge(club.id, id); }}>
            Take on the challenge <Icon name="forward" size={14} />
          </button>
        </footer>
      </div>
    </div>
  );
}

function CreateClubDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const leagues = world.competitions.filter((c) => c.kind === 'league' && c.participants.length >= 6);
  const [compId, setCompId] = useState(leagues.find((l) => l.nation === world.manager.nation && l.tier === 1)?.id ?? leagues[0]?.id ?? 0);
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  const [shirt, setShirt] = useState(SWATCHES[0]);
  const [shorts, setShorts] = useState(SWATCHES[6]);
  const [draft, setDraft] = useState(true);
  const replaced = clubToReplace(world, compId);
  const valid = name.trim().length >= 3 && short.trim().length >= 2;
  return (
    <div className="hol-overlay" onClick={onClose}>
      <div className="hol-card iv-card" role="dialog" aria-label="Create a club" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs"><Icon name="club" size={12} /> <b>Create a club</b></span>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="cc-form">
          <label className="form-field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lisboa Volley" /></label>
          <label className="form-field"><span>Short name</span><input value={short} maxLength={4} onChange={(e) => setShort(e.target.value.toUpperCase())} placeholder="LIS" /></label>
          <label className="form-field cc-wide"><span>League</span>
            <Dropdown value={compId} onChange={setCompId}
              options={leagues.map((l) => ({ value: l.id, label: l.name, icon: <Flag nation={l.nation} />, group: NATIONS[l.nation]?.name }))} />
          </label>
          <div className="cc-colours cc-wide">
            <span>Shirt</span>
            <div className="look-swatches">{SWATCHES.map((c) => <button key={c} type="button" className={`look-swatch${shirt === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setShirt(c)} />)}</div>
            <span>Shorts</span>
            <div className="look-swatches">{SWATCHES.map((c) => <button key={c} type="button" className={`look-swatch${shorts === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setShorts(c)} />)}</div>
          </div>
          <div className="cc-preview cc-wide">
            <span className="cc-badge" style={{ background: shirt, color: shorts }}>{short.trim() || '???'}</span>
            <span className="faint">
              Takes the place of {replaced !== undefined ? <b>{world.clubs[replaced].name}</b> : 'the weakest club'} — its fixtures, ground and finances.
            </span>
          </div>
          <label className="rc-check cc-wide">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
            Fantasy draft: every club in the league picks its squad from all the league's players, in turn
          </label>
        </div>
        <footer className="iv-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!valid} onClick={() => g.createOwnClub({ name, shortName: short, shirt, shorts, compId }, draft)}>
            Create and take charge <Icon name="forward" size={14} />
          </button>
        </footer>
      </div>
    </div>
  );
}
