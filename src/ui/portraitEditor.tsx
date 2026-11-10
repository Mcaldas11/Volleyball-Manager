/**
 * A player's portrait, picked by the manager: a photo of his choosing, zoomed and dragged to frame the
 * face, cropped square and compressed — and his own photo back at any time. The career's portraits go
 * out to a file of their own and come back from one (see portraits.ts): they are kept apart from the save.
 */

import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { playerFaceUrl } from './faces.ts';
import { Icon } from './icons.tsx';
import { exportPortraits, importPortraits, portraitCount, setPortrait, usePortrait } from './portraits.ts';

/** The preview, and the portrait it is saved as, px. */
const VIEW = 320;
const OUT = 256;
const MAX_ZOOM = 4;

/** The pencil on a player's photo that opens his portrait editor. */
export function PortraitButton({ playerId, name, hasPlayer }: {
  playerId: number; name: string; hasPlayer: (playerId: number) => boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="portrait-btn" title={`Change ${name}'s photo`} aria-label={`Change ${name}'s photo`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        <Icon name="pencil" size={14} />
      </button>
      {open && <PortraitEditor playerId={playerId} name={name} hasPlayer={hasPlayer} onClose={() => setOpen(false)} />}
    </>
  );
}

function PortraitEditor({ playerId, name, hasPlayer, onClose }: {
  playerId: number; name: string; hasPlayer: (playerId: number) => boolean; onClose: () => void;
}): JSX.Element {
  const custom = usePortrait(playerId);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [note, setNote] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  // The photo scaled to cover the square at zoom 1, then zoomed and moved — never so far as to show past its edge.
  const fit = (im: HTMLImageElement, z: number, o: { x: number; y: number }): { s: number; x: number; y: number } => {
    const s = Math.max(VIEW / im.naturalWidth, VIEW / im.naturalHeight) * z;
    const w = im.naturalWidth * s;
    const h = im.naturalHeight * s;
    const maxX = (w - VIEW) / 2;
    const maxY = (h - VIEW) / 2;
    return { s, x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) };
  };

  const draw = (target: HTMLCanvasElement, size: number): void => {
    const ctx = target.getContext('2d');
    if (ctx === null || img === null) return;
    const f = fit(img, zoom, offset);
    const k = size / VIEW;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    const w = img.naturalWidth * f.s * k;
    const h = img.naturalHeight * f.s * k;
    ctx.drawImage(img, (size - w) / 2 + f.x * k, (size - h) / 2 + f.y * k, w, h);
  };

  useEffect(() => { if (canvas.current !== null) draw(canvas.current, VIEW); }, [img, zoom, offset]);

  const pick = (file: File | undefined): void => {
    if (file === undefined) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setNote('Only JPG, PNG and WebP photos.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const im = new Image();
      im.onload = () => { setImg(im); setZoom(1); setOffset({ x: 0, y: 0 }); setNote('Preview ready. Adjust the zoom or drag the photo before saving.'); };
      im.onerror = () => setNote('That photo could not be read.');
      im.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const save = async (): Promise<void> => {
    if (img === null) return;
    const out = document.createElement('canvas');
    out.width = OUT;
    out.height = OUT;
    draw(out, OUT);
    let data = out.toDataURL('image/webp', 0.86);
    // A browser that can't write WebP hands back a PNG: a JPEG is far smaller.
    if (!data.startsWith('data:image/webp')) data = out.toDataURL('image/jpeg', 0.88);
    await setPortrait(playerId, data);
    setImg(null);
    setNote('Photo saved.');
  };

  const down = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (img === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current;
    if (d === null || img === null) return;
    const scale = e.currentTarget.getBoundingClientRect().width / VIEW || 1;
    const f = fit(img, zoom, { x: d.ox + (e.clientX - d.x) / scale, y: d.oy + (e.clientY - d.y) / scale });
    setOffset({ x: f.x, y: f.y });
  };

  const exportAll = (): void => {
    const n = portraitCount();
    if (n === 0) { setNote('No portraits in this career yet.'); return; }
    const blob = new Blob([JSON.stringify(exportPortraits())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'volleyball-manager-portraits.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setNote(n === 1 ? 'Exported 1 portrait.' : `Exported ${n} portraits.`);
  };

  const importAll = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    try {
      const n = await importPortraits(JSON.parse(await file.text()), hasPlayer);
      setNote(n === 1 ? 'Imported 1 portrait.' : `Imported ${n} portraits.`);
    } catch {
      setNote('That is not a portraits file.');
    }
  };

  // React passes clicks up its own tree, through the portal: they stop here.
  return createPortal(
    <div className="hol-overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="hol-card portrait-card" role="dialog" aria-modal="true" aria-label={`${name} · portrait`} onClick={(e) => e.stopPropagation()}>
        <header className="portrait-head">
          <div>
            <span className="portrait-kicker">Volleyball Manager · Portraits</span>
            <b>{name}</b>
            <span className="portrait-sub">Customise his photo. It changes none of the player's data and turns no achievements off.</span>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={18} /></button>
        </header>
        <div className="portrait-body">
          <div className="portrait-frame">
            {img !== null
              ? <canvas ref={canvas} width={VIEW} height={VIEW} className="portrait-canvas"
                onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
              : <img src={custom ?? playerFaceUrl(playerId)} alt={name} />}
          </div>
          <div className="portrait-side">
            <button className="primary portrait-choose" onClick={() => fileInput.current?.click()}>Choose photo…</button>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            <label className="portrait-zoom">
              <span>Zoom</span>
              <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} disabled={img === null}
                onChange={(e) => { const z = Number(e.target.value); setZoom(z); if (img !== null) { const f = fit(img, z, offset); setOffset({ x: f.x, y: f.y }); } }} />
            </label>
            <b className="portrait-howto">Drag to frame the face</b>
            <p className="portrait-hint">Accepts JPG, PNG and WebP. The photo is cropped square and compressed automatically.</p>
            {note !== null && <p className="portrait-note">{note}</p>}
          </div>
        </div>
        <footer className="portrait-foot">
          <button onClick={exportAll}>Export portraits</button>
          <button onClick={() => importInput.current?.click()}>Import portraits</button>
          <input ref={importInput} type="file" accept="application/json,.json" hidden
            onChange={(e) => { void importAll(e.target.files?.[0]); e.target.value = ''; }} />
          <span className="portrait-gap" />
          <button disabled={custom === undefined && img === null}
            onClick={() => { void setPortrait(playerId, null); setImg(null); setNote('His own photo is back.'); }}>
            Restore original
          </button>
          <button className="primary" disabled={img === null} onClick={() => { void save(); }}>Save photo</button>
        </footer>
        <p className="portrait-foot-note">When you export a career, export its portraits from here too: they are kept separately.</p>
      </div>
    </div>,
    document.body,
  );
}
