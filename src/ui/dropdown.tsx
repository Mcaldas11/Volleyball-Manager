/**
 * The game's own dropdown, in place of the browser's: the closed box matches
 * every other control, and the list it opens — which a native <select>
 * leaves to the operating system — is drawn in the theme, with icons (a
 * flag, a crest), groups, a tick on the current choice and, for a long
 * list, a search box. It opens over everything, below its box or above when
 * there is no room, and works from the keyboard as a select does.
 */

import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.tsx';

export interface DropOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Plain text for searching, and for type-ahead, when the label is markup. */
  text?: string;
  icon?: ReactNode;
  /** Faint text on the right. */
  hint?: ReactNode;
  /** Options sharing a group are listed together under its name. */
  group?: string;
  disabled?: boolean;
}

/** Lists longer than this get a search box. */
const SEARCH_FROM = 12;
const MENU_MAX = 320;

function textOf<T extends string | number>(o: DropOption<T>): string {
  return o.text ?? (typeof o.label === 'string' || typeof o.label === 'number' ? String(o.label) : String(o.value));
}

export function Dropdown<T extends string | number>({
  value, options, onChange, placeholder = 'Choose…', disabled = false, className, size = 'md', searchable, title,
  menuWidth,
}: {
  value: T | null;
  options: ReadonlyArray<DropOption<T>>;
  onChange: (v: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  /** A search box at the top of the list; on by default for long lists. */
  searchable?: boolean;
  title?: string;
  /** The list's width, when it should be wider than the box. */
  menuWidth?: number;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const typed = useRef({ text: '', at: 0 });

  const withSearch = searchable ?? options.length > SEARCH_FROM;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? options : options.filter((o) => textOf(o).toLowerCase().includes(q));
  }, [options, query]);
  const current = options.find((o) => o.value === value);

  const close = (focus = true): void => {
    setOpen(false);
    setQuery('');
    if (focus) trigger.current?.focus();
  };
  const choose = (o: DropOption<T>): void => {
    if (o.disabled === true) return;
    onChange(o.value);
    close();
  };
  const openMenu = (): void => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  // Below the box, or above it when there is no room underneath.
  useLayoutEffect(() => {
    if (!open || trigger.current === null) return;
    const r = trigger.current.getBoundingClientRect();
    // Never so narrow that a country's name is cut short.
    const width = Math.max(r.width, menuWidth ?? 200);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom - 12;
    const up = below < Math.min(MENU_MAX, 40 + options.length * 34) && r.top > below;
    setPlace(up
      ? { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(MENU_MAX, r.top - 12) }
      : { left, width, top: r.bottom + 6, maxHeight: Math.min(MENU_MAX, below) });
  }, [open, menuWidth, options.length]);

  // Anywhere else — a click, the page scrolling, the window resizing — closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event): void => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || trigger.current?.contains(t)) return;
      close(false);
    };
    const resize = (): void => close(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', resize);
    if (withSearch) search.current?.focus();
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => setActive(0), [query]);

  const step = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i < shown.length; i += dir) if (shown[i].disabled !== true) return i;
    return from;
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab') { close(e.key === 'Escape'); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, -1)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(step(-1, 1)); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(step(shown.length, -1)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const o = shown[active];
      if (o !== undefined) choose(o);
      return;
    }
    // Without a search box, typing jumps to the option that starts with it.
    if (!withSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const hit = shown.findIndex((o) => o.disabled !== true && textOf(o).toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  let lastGroup: string | undefined;
  return (
    <div className={`dd dd-${size}${className !== undefined ? ` ${className}` : ''}`}>
      <button
        ref={trigger}
        type="button"
        className={`dd-trigger${open ? ' open' : ''}`}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKey}
      >
        <span className={`dd-value${current === undefined ? ' dd-placeholder' : ''}`}>
          {current?.icon}
          <span className="dd-value-text">{current?.label ?? placeholder}</span>
        </span>
        <Icon name="chevronDown" size={14} className="dd-chevron" />
      </button>
      {open && createPortal(
        // Events from a portal still bubble up the component tree: the list's
        // clicks stop here, so a row or card around the box never sees them.
        <div
          ref={menu}
          className={`dd-menu dd-menu-${size}`}
          style={place}
          onKeyDown={onKey}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {withSearch && (
            <input
              ref={search}
              className="dd-search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="dd-list" role="listbox" id={listId}>
            {shown.length === 0 && <div className="dd-empty">Nothing matches.</div>}
            {shown.map((o, i) => {
              const header = o.group !== undefined && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const selected = o.value === value;
              return (
                <div key={String(o.value)}>
                  {header !== null && <div className="dd-group">{header}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-active={i === active}
                    className={`dd-option${i === active ? ' active' : ''}${selected ? ' selected' : ''}`}
                    disabled={o.disabled}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o)}
                  >
                    <span className="dd-tick">{selected && <Icon name="check" size={13} />}</span>
                    {o.icon}
                    <span className="dd-option-label">{o.label}</span>
                    {o.hint !== undefined && <span className="dd-option-hint">{o.hint}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
