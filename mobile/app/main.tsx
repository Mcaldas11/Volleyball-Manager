/*
 * Volleyball Manager on Android: the computer version's game (src/, copied in by npm run sync), with
 * the phone's own screen fitting (screen.ts) and layout (phone.css) in place of the computer's
 * window fitting.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App.tsx';
import '../src/ui/styles.css';
import './phone.css';
import { startLanguage } from '../src/ui/language.ts';
import { applyPreferences, loadPreferences } from '../src/ui/preferences.ts';
import { watchScreen } from './screen.ts';
import { keepTutorialOnScreen } from './keepTutorialOnScreen.ts';

watchScreen();
keepTutorialOnScreen();
applyPreferences(loadPreferences());
startLanguage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
