import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { watchWindowFit } from './fitWindow.ts';
import { applyPreferences, loadPreferences } from './preferences.ts';

// The player's own settings: the text size, the colours, the motion.
applyPreferences(loadPreferences());
// Laid out to what can be seen of the window, not what the browser says it is.
watchWindowFit();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
