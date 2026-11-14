import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applySonoraTheme, readSonoraTheme, type SonoraTheme } from '@/lib/theme';

export default function HomepageThemeToggle() {
  const [theme, setTheme] = useState<SonoraTheme>(() => readSonoraTheme());

  useEffect(() => {
    applySonoraTheme(theme);
  }, [theme]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'sonora-theme' || event.key === null) setTheme(readSonoraTheme());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return (
    <button
      type="button"
      className="sm-theme-toggle"
      onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      data-testid="button-homepage-theme"
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
