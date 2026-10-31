/**
 * Something went wrong: rather than a blank page, a screen that says so — and keeps the career safe.
 * It can be exported as a file, or saved, before the game is reloaded; the error itself is shown, to
 * be copied into a bug report.
 */

import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';
import pkg from '../../package.json';
import { Icon } from './icons.tsx';
import { game } from './state.ts';

interface State {
  error: Error | null;
  /** Where in the interface it happened. */
  where: string;
  copied: boolean;
}

export class ErrorScreen extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, where: '', copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ where: info.componentStack ?? '' });
    console.error(error);
  }

  private report(): string {
    const e = this.state.error;
    return [
      `Volleyball Manager ${pkg.version}`,
      `${e?.name ?? 'Error'}: ${e?.message ?? ''}`,
      e?.stack ?? '',
      this.state.where.trim().split('\n').slice(0, 8).join('\n'),
      navigator.userAgent,
    ].join('\n');
  }

  override render(): ReactNode {
    const e = this.state.error;
    if (e === null) return this.props.children;
    const inCareer = game.world !== null;
    const copy = (): void => {
      void navigator.clipboard?.writeText(this.report()).then(() => this.setState({ copied: true }));
    };
    return <ErrorPanel message={e.message} inCareer={inCareer} copied={this.state.copied} onCopy={copy}
      onRetry={() => this.setState({ error: null, where: '', copied: false })} />;
  }
}

function ErrorPanel({ message, inCareer, copied, onCopy, onRetry }: {
  message: string;
  inCareer: boolean;
  copied: boolean;
  onCopy: () => void;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div className="crash">
      <div className="crash-card" role="alertdialog" aria-label="Something went wrong">
        <Icon name="alert" size={30} />
        <h1>Something went wrong</h1>
        <p>
          The game hit an error it could not get past. {inCareer
            ? 'Your career is still here: export it as a file, or save it, before you reload.'
            : 'Reloading the game usually puts it right.'}
        </p>
        <code className="crash-message">{message}</code>
        <div className="crash-actions">
          {inCareer && (
            <>
              <button className="primary" onClick={() => { void game.exportCurrentCareer(); }}><Icon name="download" size={14} /> Export career file</button>
              <button onClick={() => { void game.saveCurrentGame(); }}><Icon name="save" size={14} /> Save the game</button>
            </>
          )}
          <button onClick={onRetry}><Icon name="back" size={14} /> Try to carry on</button>
          <button onClick={() => window.location.reload()}><Icon name="playOutline" size={14} /> Reload the game</button>
        </div>
        <button className="ghost sm crash-copy" onClick={onCopy}>
          <Icon name={copied ? 'check' : 'news'} size={13} /> {copied ? 'Copied — paste it into your bug report' : 'Copy the details for a bug report'}
        </button>
      </div>
    </div>
  );
}
