import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root is missing from index.html');

createRoot(el).render(
  <StrictMode>
    <a href="#main" className="sr-only-focusable rounded-full bg-fanta px-4 py-2 font-bold text-ink">
      Skip to the game
    </a>
    <App />
  </StrictMode>,
);
