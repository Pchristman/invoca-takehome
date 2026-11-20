import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MotionRoot } from './useMotion';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/print.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <MotionRoot>
      <App />
    </MotionRoot>
  </ErrorBoundary>,
);
