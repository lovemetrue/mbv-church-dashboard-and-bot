import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './shared/theme/base.css';
import { App } from './app/App';
import { Providers } from './app/Providers';
import { applyTheme, loadTheme } from './shared/theme/theme';

// Тему ставим до первого рендера, чтобы страница не мигала светлой перед тёмной.
applyTheme(loadTheme());

const root = document.getElementById('root');
if (!root) throw new Error('В index.html нет #root');

createRoot(root).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
