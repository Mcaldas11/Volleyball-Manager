/**
 * The window up while the game waits on something — a save, a load, a career
 * file in or out, a new world — in the processing window's colours: what is
 * being done in gold, a ball in the air, the stages ticking off underneath.
 * Everything that moves is a transform or an opacity, which the browser runs
 * off the main thread: it keeps moving even while a big save holds the page.
 */

import type { JSX } from 'react';
import { Icon } from './icons.tsx';
import { useGame, useTaskProgress } from './state.ts';

export function TaskWindow(): JSX.Element | null {
  const g = useGame();
  const progress = useTaskProgress();
  const task = g.task;
  if (task === null) return null;
  const fraction = progress?.fraction ?? null;
  return (
    <div className="proc-overlay task-overlay">
      <div className="task-window" role="alertdialog" aria-busy="true" aria-label={task.title}>
        <header className="proc-top">
          <span className="proc-title">Processing</span>
        </header>

        <section className="proc-day task-card">
          <div className="task-card-top">
            <span className="task-ball" aria-hidden="true">
              <span className="task-ball-spin"><Icon name="ball" size={24} /></span>
            </span>
            <div className="task-card-text">
              <strong className="task-title">{task.title}</strong>
              {task.detail !== '' && <span className="task-detail">{task.detail}</span>}
            </div>
            <span className="spinner" />
          </div>
          <div className={`task-bar${fraction === null ? ' running' : ''}`}>
            <span style={fraction === null ? undefined : { transform: `scaleX(${fraction})` }} />
          </div>
        </section>

        <ol className="task-steps">
          {task.steps.map((s, i) => (
            <li key={s} className={i < task.step ? 'done' : i === task.step ? 'now' : 'next'}>
              <span className="task-step-mark">{i < task.step ? <Icon name="check" size={12} /> : <i />}</span>
              <span className="task-step-name">{s}</span>
              {i === task.step && progress !== null && <em>{progress.label}</em>}
            </li>
          ))}
        </ol>

        {task.slow && <p className="task-hint">A long career in a large world can take a minute or two.</p>}
      </div>
    </div>
  );
}
