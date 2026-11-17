import './strictPage.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ds/tokens.css'; // the design tokens (UX_REDESIGN §3.2): first, so everything after can use them
import './ds/uiFonts.ts';
import './ds/primitives.css'; // the primitives' styles (scoped under .pf-ds), so every area of the editor can use them
import '@pulseframe/brand/tokens.css'; // legacy aliases onto the tokens above
import './styles.css';
import { App } from './App.tsx';
import './theme.css'; // last: the visual layer restyles what the components and styles.css lay out

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
