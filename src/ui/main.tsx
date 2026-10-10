import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { watchWindowFit } from './fitWindow.ts';

// Laid out to what can be seen of the window, not what the browser says it is.
watchWindowFit();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
