/**
 * Choosing how the manager looks on the touchline: the outfit, its colours, the shoes, skin, hair, a
 * beard and glasses — with him turning beside it in 3D as he will stand at the bench. Used when a
 * career begins, and from his profile later.
 */

import { useRef, useState, type JSX, type ReactNode, type Ref } from 'react';
import type { ManagerLook } from '../engine/world/world.ts';
import { CoachPreview, type CoachPreviewHandle } from './coachPreview.tsx';
import {
  CLOTH_COLOURS, COACH_SKINS, DEFAULT_LOOK, figureLook, HAIR_COLOURS, OUTFITS, SHIRT_COLOURS, SHOE_COLOURS, TIE_COLOURS,
} from './coachLook.ts';
import { Card, Segmented } from './components.tsx';
import type { Kit } from './figure3d.ts';
import { Icon } from './icons.tsx';

/** Before a club is picked, 'club' colours are shown as a club's might be. */
const SAMPLE_KIT: Kit = { shirt: '#2a5bb8', shorts: '#f2f3f5', libero: '#d7a73f' };

function Swatches({ value, options, onChange, club, none }: {
  value: string | null;
  options: readonly string[];
  onChange: (v: string | null) => void;
  /** Offer the club's own colours. */
  club?: boolean;
  /** Offer none at all — no tie. */
  none?: boolean;
}): JSX.Element {
  return (
    <div className="look-swatches">
      {none === true && (
        <button type="button" className={`look-swatch none${value === null ? ' on' : ''}`} title="None" onClick={() => onChange(null)}>
          <Icon name="close" size={12} />
        </button>
      )}
      {club === true && (
        <button type="button" className={`look-swatch club${value === 'club' ? ' on' : ''}`} title="The club's colours" onClick={() => onChange('club')}>
          Club
        </button>
      )}
      {options.map((c) => (
        <button key={c} type="button" className={`look-swatch${value === c ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="look-row">
      <span className="look-label">{label}</span>
      {children}
    </div>
  );
}

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** A look picked at random from everything on offer. */
function surprise(women: boolean): ManagerLook {
  const outfit = pick(OUTFITS).id;
  return {
    outfit,
    top: Math.random() < 0.35 ? 'club' : pick(CLOTH_COLOURS),
    shirt: pick(SHIRT_COLOURS),
    tie: Math.random() < 0.25 ? null : pick(TIE_COLOURS),
    trousers: pick(CLOTH_COLOURS.slice(0, 7)),
    shoes: outfit === 'tracksuit' ? '#f6f7f9' : pick(SHOE_COLOURS.slice(0, 2)),
    skin: Math.floor(Math.random() * COACH_SKINS.length),
    hair: pick(HAIR_COLOURS),
    hairStyle: Math.floor(Math.random() * 3),
    beard: women ? 0 : pick([0, 0, 1, 2] as const),
    glasses: Math.random() < 0.3,
  };
}

/** Changing outfit, what goes with it: dark shoes with trousers, trainers with a tracksuit; a jacket a
 *  suit's colour and a tie with it, unless chosen already. */
function dressFor(look: ManagerLook, outfit: ManagerLook['outfit']): ManagerLook {
  const smart = outfit === 'suit' || outfit === 'shirt';
  const wasSmart = look.outfit === 'suit' || look.outfit === 'shirt';
  return {
    ...look,
    outfit,
    top: outfit === 'suit' && look.top === 'club' ? CLOTH_COLOURS[1] : look.top,
    tie: smart && !wasSmart && look.tie === null ? TIE_COLOURS[0] : look.tie,
    shoes: outfit === 'tracksuit' ? '#f6f7f9' : look.shoes === '#f6f7f9' ? '#15181e' : look.shoes,
  };
}

/** The editor: the figure on the left, the choices on the right. `kit` for the club's colours, if there is a club. */
export function LookEditor({ look, onChange, women, kit, previewRef }: {
  look: ManagerLook;
  onChange: (look: ManagerLook) => void;
  women: boolean;
  kit?: Kit;
  previewRef?: Ref<CoachPreviewHandle>;
}): JSX.Element {
  const set = <K extends keyof ManagerLook>(k: K, v: ManagerLook[K]): void => onChange({ ...look, [k]: v });
  const suit = look.outfit === 'suit';
  const shirtOnly = look.outfit === 'shirt';
  const topName = suit ? 'Jacket' : look.outfit === 'tracksuit' ? 'Top' : 'Polo';
  return (
    <div className="look-editor">
      <Card title="On the touchline" icon="user" flush className="look-preview-card">
        <CoachPreview ref={previewRef} look={figureLook(look, kit ?? SAMPLE_KIT, women)} />
        <span className="look-hint faint">Drag to turn him round</span>
      </Card>
      <Card title="Style" icon="gear" className="look-options"
        actions={<button type="button" className="sm" onClick={() => onChange(surprise(women))}><Icon name="star" size={12} /> Surprise me</button>}>
        <div className="look-outfits">
          {OUTFITS.map((o) => (
            <button key={o.id} type="button" className={`look-outfit${look.outfit === o.id ? ' on' : ''}`}
              onClick={() => onChange(dressFor(look, o.id))}>
              <b>{o.name}</b>
              <small>{o.hint}</small>
            </button>
          ))}
        </div>
        <div className="look-grid">
          {!shirtOnly && <Row label={topName}><Swatches value={look.top} options={CLOTH_COLOURS} club onChange={(v) => set('top', v ?? 'club')} /></Row>}
          {(suit || shirtOnly) && <Row label="Shirt"><Swatches value={look.shirt} options={SHIRT_COLOURS} onChange={(v) => set('shirt', v ?? SHIRT_COLOURS[0])} /></Row>}
          {(suit || shirtOnly) && <Row label="Tie"><Swatches value={look.tie} options={TIE_COLOURS} none onChange={(v) => set('tie', v)} /></Row>}
          <Row label="Trousers"><Swatches value={look.trousers} options={CLOTH_COLOURS} onChange={(v) => set('trousers', v ?? CLOTH_COLOURS[0])} /></Row>
          <Row label="Shoes"><Swatches value={look.shoes} options={SHOE_COLOURS} onChange={(v) => set('shoes', v ?? SHOE_COLOURS[0])} /></Row>
          <Row label="Skin"><Swatches value={COACH_SKINS[look.skin] ?? null} options={COACH_SKINS} onChange={(v) => set('skin', Math.max(0, COACH_SKINS.indexOf(v ?? '')))} /></Row>
          <Row label="Hair"><Swatches value={look.hair} options={HAIR_COLOURS} onChange={(v) => set('hair', v ?? HAIR_COLOURS[0])} /></Row>
          <Row label="Style">
            <Segmented size="sm" value={look.hairStyle} onChange={(v) => set('hairStyle', v)}
              options={women ? [[0, 'Ponytail'], [1, 'Bun'], [2, 'Bob']] : [[0, 'Cropped'], [1, 'Short'], [2, 'Shaved']]} />
          </Row>
          {!women && (
            <Row label="Beard">
              <Segmented size="sm" value={look.beard} onChange={(v) => set('beard', v)} options={[[0, 'None'], [1, 'Stubble'], [2, 'Full']]} />
            </Row>
          )}
          <Row label="Glasses">
            <Segmented size="sm" value={look.glasses ? 1 : 0} onChange={(v) => set('glasses', v === 1)} options={[[0, 'No'], [1, 'Yes']]} />
          </Row>
        </div>
      </Card>
    </div>
  );
}

/** From his profile: change his look, and his portrait with it. */
export function EditLookDialog({ initial, women, kit, onSave, onClose }: {
  initial: ManagerLook | undefined;
  women: boolean;
  kit?: Kit;
  onSave: (look: ManagerLook, portrait: string | null) => void;
  onClose: () => void;
}): JSX.Element {
  const [look, setLook] = useState<ManagerLook>(initial ?? DEFAULT_LOOK);
  const preview = useRef<CoachPreviewHandle>(null);
  return (
    <div className="hol-overlay" onClick={onClose}>
      <div className="hol-card look-dialog" role="dialog" aria-label="Your look" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs"><Icon name="user" size={12} /> <b>Your look</b></span>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <LookEditor look={look} onChange={setLook} women={women} kit={kit} previewRef={preview} />
        <footer className="look-dialog-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave(look, preview.current?.portrait() ?? null)}><Icon name="check" size={14} /> Save</button>
        </footer>
      </div>
    </div>
  );
}
