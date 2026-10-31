/**
 * What's new: the changes in this version of the game, opened from the main menu's bar — the newest
 * first. Add to the top of NOTES with each release.
 */

import { useEffect, type JSX } from 'react';
import pkg from '../../package.json';
import { Icon, type IconName } from './icons.tsx';

interface Note {
  icon: IconName;
  title: string;
  text: string;
}

const NOTES: readonly Note[] = [
  { icon: 'sound', title: 'Real sounds and two more languages', text: 'Recorded whistles, spikes, touches, the buzzer and the crowd; and every screen in Portuguese and Spanish — in Preferences.' },
  { icon: 'trophy', title: 'Achievements for the kit designer', text: "A club's colours can be changed in the editor without the career losing its achievements — any other edit still turns them off." },
  { icon: 'swap', title: 'Planned substitutions', text: 'Set up a double switch or a serving specialist for the middles once — the change is made by itself when its rotation comes round, and undone when it should be.' },
  { icon: 'user', title: 'Staff and manager profiles', text: 'Every coach, scout and physio — and you — on one page: how suited they are to each role, their attributes by side of the job, their record and their history.' },
  { icon: 'home', title: 'A new main menu', text: 'Start, load, quick-start a national team or club and country, and your manager standing in the hall in 3D — made once, used for every new career.' },
  { icon: 'gear', title: 'Preferences', text: 'Graphics quality, 3D resolution, shadows and anti-aliasing; a frame-rate limit and counter; the match view and camera; sound and volume; language.' },
  { icon: 'ball', title: 'Ball kids', text: 'Six ball kids keep four balls going round the court: one is thrown to the server before every serve, the dead ball picked up and rolled on.' },
  { icon: 'camera', title: 'Video challenges', text: 'Challenge a call — the point played again on the court in slow motion, then the referee’s verdict.' },
  { icon: 'tactics', title: 'Block plans', text: 'Choose where to block the outside, the opposite and the pipe — or drag the blockers yourself on a 3D court.' },
  { icon: 'stats', title: 'Match reports with charts', text: 'Your assistant’s report after every match: the score flow, the rotations, who played well.' },
  { icon: 'world', title: 'Flags and fonts in the game', text: 'Flags and fonts are part of the game now, not fetched from the internet. Clubs and competitions have names of their own.' },
];

export function WhatsNewDialog({ onClose }: { onClose: () => void }): JSX.Element {
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  return (
    <div className="hol-overlay" onClick={onClose}>
      <div className="hol-card whats-new" role="dialog" aria-label="What's new" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs"><Icon name="star" size={12} /> <b>What's New</b> · version {pkg.version}</span>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="whats-new-list">
          {NOTES.map((n) => (
            <div key={n.title} className="whats-new-item">
              <span className="whats-new-icon"><Icon name={n.icon} size={16} /></span>
              <span><b>{n.title}</b><small>{n.text}</small></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const GAME_VERSION = pkg.version;
