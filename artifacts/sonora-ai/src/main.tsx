import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';
import './desktop-parakeet.css';
import { applySonoraTheme, readSonoraTheme } from '@/lib/theme';

// Apply before the first paint so Windows does not composite an opaque body color.
if (window.sonoraDesktop) {
  document.documentElement.classList.add('sonora-desktop');
  applySonoraTheme(readSonoraTheme());
}

const root = createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
});

if (import.meta.env.VITE_SONORA_E2E === '1') {
  const { default: E2EApp } = await import('./e2e/E2EApp');
  root.render(<E2EApp />);
} else {
  const { default: App } = await import('./App');
  root.render(<ErrorBoundary><App /></ErrorBoundary>);
}