/**
 * The editor: the world of this career changed by hand — a club's name, its arena and its money;
 * a player's name, position, nationality, height, potential and every attribute; and each club's
 * kit, designed. Every change is made at once, to this career only. An edited career earns no
 * achievements, as the editor says before anything is changed.
 */

import { useMemo, useState, type JSX } from 'react';
import type { Club, ClubKit } from '../../engine/model/club.ts';
import { ATTR_LABELS, MENTAL_ATTRS, PHYSICAL_ATTRS, TECHNICAL_ATTRS, HIDDEN_ATTRS, type AttributeName } from '../../engine/model/attributes.ts';
import { refreshAbility } from '../../engine/model/ability.ts';
import { POSITION_NAMES, POSITIONS, type Position } from '../../engine/model/positions.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { Card, ClubCrest, Empty, money, PlayerFace, Pos } from '../components.tsx';
import { Dropdown } from '../dropdown.tsx';
import { Icon } from '../icons.tsx';
import { designFrom, hueOf, kitFromHue, toHex } from '../kits.ts';
import { useGame } from '../state.ts';

type Tab = 'clubs' | 'players' | 'kits';

/** A labelled box that commits what was typed when it loses focus, or on Enter. */
function Field({ label, value, onCommit, type = 'text', min, max, width }: {
  label: string;
  value: string | number;
  onCommit: (v: string) => void;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  width?: number;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const commit = (): void => {
    if (draft !== null && draft !== String(value)) onCommit(draft);
    setDraft(null);
  };
  return (
    <label className="ed-field">
      <span>{label}</span>
      <input
        type={type} value={shown} min={min} max={max} style={width !== undefined ? { width } : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

const num = (v: string, lo: number, hi: number): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
};

function ClubPicker({ value, onChange }: { value: number; onChange: (id: number) => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const options = useMemo(() => world.clubs
    .filter((c) => c.players.length > 0)
    .sort((a, b) => a.tier - b.tier || b.reputation - a.reputation)
    .map((c) => ({ value: c.id, label: c.name, hint: `${NATIONS[c.nation]?.code ?? ''} · tier ${c.tier}` })), [world]);
  return <Dropdown value={value} options={options} onChange={onChange} searchable menuWidth={320} />;
}

// ---- Clubs -------------------------------------------------------------------------------

function ClubEditor({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const edit = (f: () => void): void => { f(); g.markEdited(); };
  const f = club.finances;
  return (
    <Card title={<span className="ed-title"><ClubCrest club={club} size={22} /> {club.name}</span>} icon="club" className="ed-card">
      <div className="ed-grid">
        <Field label="Name" value={club.name} onCommit={(v) => { if (v.trim() !== '') edit(() => { club.name = v.trim(); }); }} />
        <Field label="Short name" value={club.shortName} onCommit={(v) => { if (v.trim() !== '') edit(() => { club.shortName = v.trim().slice(0, 14); }); }} />
        <Field label="Arena" value={club.arenaName} onCommit={(v) => { if (v.trim() !== '') edit(() => { club.arenaName = v.trim(); }); }} />
        <Field label="Seats" type="number" min={200} max={30000} value={club.arenaCapacity}
          onCommit={(v) => { const n = num(v, 200, 30000); if (n !== null) edit(() => { club.arenaCapacity = n; }); }} />
        <Field label="Reputation (0-10,000)" type="number" min={0} max={10000} value={club.reputation}
          onCommit={(v) => { const n = num(v, 0, 10000); if (n !== null) edit(() => { club.reputation = n; }); }} />
        <Field label="Board confidence (0-100)" type="number" min={0} max={100} value={Math.round(club.boardConfidence)}
          onCommit={(v) => { const n = num(v, 0, 100); if (n !== null) edit(() => { club.boardConfidence = n; }); }} />
        <Field label={`Balance (${money(f.balance)})`} type="number" value={Math.round(f.balance)}
          onCommit={(v) => { const n = num(v, -1e9, 1e10); if (n !== null) edit(() => { f.balance = n; }); }} />
        <Field label={`Transfer budget (${money(f.transferBudget)})`} type="number" value={Math.round(f.transferBudget)}
          onCommit={(v) => { const n = num(v, 0, 1e10); if (n !== null) edit(() => { f.transferBudget = n; }); }} />
        <Field label={`Wage budget (${money(f.wageBudget)})`} type="number" value={Math.round(f.wageBudget)}
          onCommit={(v) => { const n = num(v, 0, 1e10); if (n !== null) edit(() => { f.wageBudget = n; }); }} />
      </div>
    </Card>
  );
}

// ---- Players -----------------------------------------------------------------------------

const GROUPS: ReadonlyArray<[string, readonly AttributeName[]]> = [
  ['Physical', PHYSICAL_ATTRS], ['Technical', TECHNICAL_ATTRS], ['Mental', MENTAL_ATTRS], ['Hidden', HIDDEN_ATTRS],
];

function PlayerEditor({ p }: { p: number }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  const edit = (f: () => void): void => { f(); g.markEdited(); };
  const nationOptions = useMemo(() => NATIONS.map((n, i) => ({ value: i, label: n.name, hint: n.code })), []);
  const setAttr = (a: AttributeName, v: string): void => {
    const n = num(v, 1, 20);
    if (n === null) return;
    edit(() => { store.setAttr(p, a, n); refreshAbility(store, p); });
  };
  return (
    <Card
      title={<span className="ed-title"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={24} /> {store.fullName(p)}</span>}
      icon="user" className="ed-card ed-player"
      actions={<span className="faint">Ability {store.currentAbility[p]} · potential {store.potentialAbility[p]}</span>}
    >
      <div className="ed-grid">
        <Field label="First name" value={store.names.get(store.firstName[p])}
          onCommit={(v) => { if (v.trim() !== '') edit(() => { store.firstName[p] = store.names.intern(v.trim()); }); }} />
        <Field label="Last name" value={store.names.get(store.lastName[p])}
          onCommit={(v) => { if (v.trim() !== '') edit(() => { store.lastName[p] = store.names.intern(v.trim()); }); }} />
        <label className="ed-field">
          <span>Position</span>
          <Dropdown<number> size="sm" value={store.position[p]} searchable={false}
            options={POSITIONS.map((x) => ({ value: x, label: POSITION_NAMES[x] }))}
            onChange={(v) => edit(() => { store.position[p] = v as Position; refreshAbility(store, p); })} />
        </label>
        <label className="ed-field">
          <span>Nationality</span>
          <Dropdown<number> size="sm" value={store.nation[p]} options={nationOptions} searchable menuWidth={260}
            onChange={(v) => edit(() => { store.nation[p] = v; })} />
        </label>
        <Field label="Height (cm)" type="number" min={160} max={225} value={store.heightCm[p]}
          onCommit={(v) => { const n = num(v, 160, 225); if (n !== null) edit(() => { store.heightCm[p] = n; }); }} />
        <Field label="Potential" type="number" min={1} max={2000} value={store.potentialAbility[p]}
          onCommit={(v) => { const n = num(v, store.currentAbility[p], 2000); if (n !== null) edit(() => { store.potentialAbility[p] = n; }); }} />
      </div>
      <div className="ed-attrs">
        {GROUPS.map(([name, list]) => (
          <div key={name} className="ed-attr-group">
            <div className="ed-sub">{name}</div>
            {list.map((a) => (
              <label key={a} className="ed-attr">
                <span>{ATTR_LABELS[a]}</span>
                <input type="number" min={1} max={20} value={store.getAttr(p, a)} onChange={(e) => setAttr(a, e.target.value)} />
              </label>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PlayerSearch({ selected, onPick }: { selected: number; onPick: (p: number) => void }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const [q, setQ] = useState('');
  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = needle.length >= 2
      ? Array.from({ length: store.count }, (_, i) => i).filter((i) => store.isActive(i) && store.fullName(i).toLowerCase().includes(needle))
      : (g.club?.players ?? []).slice();
    return pool.sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 60);
  }, [q, world, g.club]);
  return (
    <Card title="Players" icon="search" flush className="ed-list-card">
      <div className="ed-search">
        <input placeholder="Search any player by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="faint">{q.trim().length >= 2 ? `${found.length}${found.length === 60 ? '+' : ''} found` : 'Your squad'}</span>
      </div>
      <div className="ed-list">
        {found.map((p) => (
          <button key={p} className={`ed-row${p === selected ? ' on' : ''}`} onClick={() => onPick(p)}>
            <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={22} />
            <span className="ed-row-name">{store.fullName(p)}</span>
            <Pos pos={store.position[p] as Position} />
            <span className="ed-row-ca">{store.currentAbility[p]}</span>
          </button>
        ))}
        {found.length === 0 && <Empty>No player by that name.</Empty>}
      </div>
    </Card>
  );
}

// ---- Kits --------------------------------------------------------------------------------

/** A shirt and shorts, drawn. */
function Jersey({ shirt, shorts, label }: { shirt: string; shorts: string; label: string }): JSX.Element {
  return (
    <figure className="ed-jersey">
      <svg viewBox="0 0 120 150" width={120} height={150} aria-label={label}>
        <path d="M38 8 L22 14 L4 34 L18 50 L28 42 L28 98 L92 98 L92 42 L102 50 L116 34 L98 14 L82 8 Q60 22 38 8 Z" fill={shirt} stroke="rgba(0,0,0,0.35)" strokeWidth="1.5" />
        <path d="M38 8 Q60 22 82 8" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="3" />
        <text x="60" y="76" textAnchor="middle" fontSize="30" fontWeight="800" fill="rgba(255,255,255,0.9)" stroke="rgba(0,0,0,0.3)" strokeWidth="1">10</text>
        <path d="M30 102 L90 102 L94 140 L66 140 L60 118 L54 140 L26 140 Z" fill={shorts} stroke="rgba(0,0,0,0.35)" strokeWidth="1.5" />
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function KitDesigner({ club }: { club: Club }): JSX.Element {
  const g = useGame();
  const kit = club.kit ?? designFrom(club);
  // Colours change nothing on the court: the career keeps its achievements.
  const set = (next: ClubKit): void => { club.kit = next; g.markKitChanged(); };
  const colour = (label: string, key: 'shirt' | 'shorts' | 'libero'): JSX.Element => (
    <label className="ed-colour">
      <span>{label}</span>
      <input type="color" value={toHex(kit[key])} onChange={(e) => set({ ...kit, [key]: e.target.value })} />
    </label>
  );
  return (
    <Card title={<span className="ed-title"><ClubCrest club={club} size={22} /> {club.name}</span>} icon="club" className="ed-card">
      <div className="ed-kit">
        <div className="ed-kit-controls">
          <label className="ed-colour ed-hue">
            <span>Club colour <small>— the crest, the club's pages, the kit if not designed</small></span>
            <input type="range" min={0} max={359} value={Math.round(hueOf(club))}
              onChange={(e) => {
                const hue = Number(e.target.value);
                const k = kitFromHue(hue);
                set({ hue, shirt: toHex(k.shirt), shorts: toHex(k.shorts), libero: toHex(k.libero) });
              }} />
          </label>
          {colour('Shirt', 'shirt')}
          {colour('Shorts', 'shorts')}
          {colour('Libero shirt', 'libero')}
          <button className="sm" disabled={club.kit === undefined} onClick={() => { club.kit = undefined; g.markKitChanged(); }}>
            <Icon name="swap" size={13} /> Back to the club's own
          </button>
          <p className="faint ed-note">Worn in every match, on the 2D court and in 3D. When two sides' kits are too alike, the away side changes.</p>
        </div>
        <div className="ed-kit-preview">
          <ClubCrest club={club} size={96} />
          <Jersey shirt={kit.shirt} shorts={kit.shorts} label="Players" />
          <Jersey shirt={kit.libero} shorts={kit.shorts} label="Libero" />
        </div>
      </div>
    </Card>
  );
}

// ---- The screen --------------------------------------------------------------------------

export function EditorScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [tab, setTab] = useState<Tab>('clubs');
  const [clubId, setClubId] = useState<number>(g.club?.id ?? world.clubs.find((c) => c.players.length > 0)?.id ?? 0);
  const [player, setPlayer] = useState<number>(g.club?.players[0] ?? -1);
  const club = world.clubs[clubId];
  return (
    <div className="ed">
      <div className="ed-bar">
        <div className="tr-tabs" role="tablist">
          {(['clubs', 'players', 'kits'] as const).map((t) => (
            <button key={t} role="tab" className={`hdr-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'clubs' ? 'Clubs' : t === 'players' ? 'Players' : 'Kit designer'}
            </button>
          ))}
        </div>
        <span className="flex-spacer" />
        {tab !== 'players' && <ClubPicker value={clubId} onChange={setClubId} />}
      </div>
      <p className={`ed-warn${world.edited === true ? ' on' : ''}`}>
        <Icon name="alert" size={13} />
        {world.edited === true
          ? 'This career has been edited: it earns no achievements.'
          : tab === 'kits'
            ? 'Changes are made at once, to this career only — new colours keep its achievements.'
            : 'Changes are made at once, to this career only — and an edited career earns no achievements (the kit designer excepted).'}
      </p>
      {tab === 'clubs' && club !== undefined && <ClubEditor key={club.id} club={club} />}
      {tab === 'kits' && club !== undefined && <KitDesigner key={club.id} club={club} />}
      {tab === 'players' && (
        <div className="ed-players">
          <PlayerSearch selected={player} onPick={setPlayer} />
          {player >= 0 && world.players.isActive(player) ? <PlayerEditor key={player} p={player} /> : <Card><Empty>Pick a player.</Empty></Card>}
        </div>
      )}
    </div>
  );
}
