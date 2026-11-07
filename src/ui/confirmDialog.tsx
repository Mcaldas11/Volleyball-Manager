/**
 * "Are you sure?", in the game's own window. Never `window.confirm`: in the desktop game the system's
 * box leaves the page unable to take the keyboard afterwards, so no text field can be typed in until
 * the game is restarted.
 */

import { useEffect, useRef, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons.tsx';

export function ConfirmDialog({
  title, icon = 'close', message, detail, confirmLabel, onConfirm, onCancel,
}: {
  title: string;
  icon?: IconName;
  message: string;
  detail?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Enter on an open box must not be what deletes something.
    cancel.current?.focus();
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  // React passes clicks up its own tree, through the portal: they stop here, not in the row that opened it.
  return createPortal(
    <div className="hol-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }}>
      <div className="hol-card confirm-card" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs"><Icon name={icon} size={12} /> <b>{title}</b></span>
          <button className="icon-btn" onClick={onCancel} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="confirm-body">
          <p className="confirm-message">{message}</p>
          {detail !== undefined && <p className="confirm-detail">{detail}</p>}
        </div>
        <footer className="confirm-foot">
          <button ref={cancel} onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>{confirmLabel}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
