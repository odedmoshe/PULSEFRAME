import './strictPage.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@pulseframe/brand/tokens.css';
import './styles.css';
import { App } from './App.tsx';
import './theme.css'; // last: the visual layer restyles what the components and styles.css lay out

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
