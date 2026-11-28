/**
 * Save the loaded tactic to a file, or load one from a file, the way FM does
 * it: in the desktop game every file in the `tactics` folder beside the game
 * is listed — drop a friend's file in and it is there — and a tactic is saved
 * into it by name; in a browser the file is downloaded, and loaded from a
 * file picked.
 */

import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tacticFileFormation } from '../engine/model/tacticFile.ts';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';
import {
  hasTacticsFolder, listTacticFiles, openTacticsFolder, readPickedFiles, saveTacticFile, tacticsFolderPath,
  type TacticFileEntry,
} from './tacticFiles.ts';

function Shell({ title, icon, onClose, children, wide }: {
  title: string; icon: 'save' | 'upload'; onClose: () => void; children: ReactNode; wide?: boolean;
}): JSX.Element {
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  return createPortal(
    <div className="hol-overlay" onMouseDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className={`hol-card tfile-card${wide === true ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}
        onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs"><Icon name={icon} size={12} /> <b>{title}</b></span>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function useFolder(): string | null {
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => { void tacticsFolderPath().then(setFolder); }, []);
  return folder;
}

export function SaveTacticDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const g = useGame();
  const saved = g.savedTactics();
  const [name, setName] = useState(saved !== null ? saved.slots[saved.active].name : 'Tactic');
  const [taken, setTaken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const folder = useFolder();
  const desktop = hasTacticsFolder();

  const save = async (overwrite: boolean): Promise<void> => {
    const text = g.loadedTacticFile(name);
    if (text === null || busy) return;
    setBusy(true);
    const r = await saveTacticFile(name, text, overwrite);
    setBusy(false);
    if (r.ok) {
      g.tacticFileSaved(desktop ? `Tactic saved as ${r.file}.` : `Tactic downloaded as ${r.file}.`);
      onClose();
    } else if (r.exists === true) {
      setTaken(r.file);
    } else {
      setError(r.error);
    }
  };

  return (
    <Shell title="Save tactic" icon="save" onClose={onClose}>
      <div className="confirm-body tfile-body">
        <label className="tfile-label" htmlFor="tfile-name">Name</label>
        <input
          id="tfile-name"
          className="tfile-name"
          value={name}
          maxLength={32}
          autoFocus
          onChange={(e) => { setName(e.target.value); setTaken(null); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() !== '') void save(taken !== null); }}
        />
        <p className="confirm-detail">
          {desktop
            ? <>Saved as a file in your tactics folder{folder !== null && <>: <span className="tfile-path">{folder}</span></>}. Share it by sending the file, and load a friend's by dropping it in the folder.</>
            : <>Downloaded as a .vmtac file. Load it here, or in the desktop game, from Load tactic.</>}
        </p>
        <p className="confirm-detail">The formation, team and rotation instructions, plans and team sheet are all saved.</p>
        {taken !== null && <p className="tfile-warn">{taken} already exists. Save again to replace it.</p>}
        {error !== null && <p className="tfile-warn">{error}</p>}
      </div>
      <footer className="confirm-foot">
        {desktop && <button className="tfile-left" onClick={openTacticsFolder}><Icon name="archive" size={13} /> Open folder</button>}
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={name.trim() === '' || busy} onClick={() => void save(taken !== null)}>
          {taken !== null ? 'Replace' : desktop ? 'Save' : 'Download'}
        </button>
      </footer>
    </Shell>
  );
}

function savedOn(iso: string | undefined): string {
  if (iso === undefined) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function LoadTacticDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const g = useGame();
  const desktop = hasTacticsFolder();
  const folder = useFolder();
  const [entries, setEntries] = useState<TacticFileEntry[] | null>(desktop ? null : []);
  const pick = useRef<HTMLInputElement>(null);
  const target = g.tacticFileTarget();

  const refresh = (): void => {
    setEntries(null);
    void listTacticFiles().then(setEntries, () => setEntries([]));
  };
  useEffect(() => { if (desktop) refresh(); }, []);

  const picked = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    const read = await readPickedFiles(files);
    setEntries((was) => [...read, ...(was ?? []).filter((e) => !read.some((r) => r.file === e.file))]);
  };

  const broken = entries?.filter((e) => !e.ok).length ?? 0;

  return (
    <Shell title="Load tactic" icon="upload" onClose={onClose} wide>
      <div className="tfile-list" data-vm-scroll="1">
        {entries === null && <p className="tfile-empty">Reading the tactics folder…</p>}
        {entries !== null && entries.length === 0 && (
          <p className="tfile-empty">
            {desktop
              ? <>No tactic files yet. Save one, or drop .vmtac files in {folder !== null ? <span className="tfile-path">{folder}</span> : 'the tactics folder'} and refresh.</>
              : 'Choose a .vmtac tactic file to load it.'}
          </p>
        )}
        {entries?.map((e) => e.ok ? (
          <div key={e.file} className="tfile-row">
            <span className="tactic-form">{tacticFileFormation(e.tactic)}</span>
            <span className="tfile-main">
              <span className="tfile-title">{e.tactic.name}</span>
              <span className="tfile-sub">
                {[e.file, e.tactic.club, savedOn(e.tactic.saved)].filter((x) => x !== undefined && x !== '').join(' · ')}
              </span>
              {e.warnings.length > 0 && (
                <span className="tfile-fixed" title={e.warnings.join('\n')}>
                  {e.warnings.length === 1 ? '1 setting' : `${e.warnings.length} settings`} could not be read and will use the default
                </span>
              )}
            </span>
            <button className="primary" disabled={!target.allowed} onClick={() => { g.loadTacticFile(e.tactic); onClose(); }}>Load</button>
          </div>
        ) : (
          <div key={e.file} className="tfile-row broken">
            <Icon name="alert" size={14} />
            <span className="tfile-main">
              <span className="tfile-title">{e.file}</span>
              <span className="tfile-sub">{e.error} Skipped.</span>
            </span>
          </div>
        ))}
      </div>
      <p className="confirm-detail tfile-foot-note">
        {!target.allowed
          ? 'Tactics can only be loaded from a file before the match.'
          : target.replaces !== null
            ? `All your tactic slots are taken: a tactic loaded from a file replaces ${target.replaces}.`
            : 'A tactic loaded from a file goes into a new slot. Players not in your squad are picked as usual.'}
        {broken > 0 && ` ${broken === 1 ? 'One file was' : `${broken} files were`} skipped.`}
      </p>
      <footer className="confirm-foot">
        {desktop && <button className="tfile-left" onClick={openTacticsFolder}><Icon name="archive" size={13} /> Open folder</button>}
        {desktop && <button onClick={refresh}>Refresh</button>}
        <button onClick={() => pick.current?.click()}>{desktop ? 'Other file…' : 'Choose file…'}</button>
        <input ref={pick} type="file" accept=".vmtac,.json,application/json" multiple hidden
          onChange={(ev) => { void picked(ev.target.files); ev.target.value = ''; }} />
        <button onClick={onClose}>Close</button>
      </footer>
    </Shell>
  );
}
