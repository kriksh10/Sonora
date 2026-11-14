export type SonoraTheme = "light" | "dark";

const STORAGE_KEY = "sonora-theme";

export function readSonoraTheme(): SonoraTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applySonoraTheme(theme: SonoraTheme) {
  const root = document.documentElement;
  root.dataset.sonoraTheme = theme;
  // color-scheme: light paints an opaque canvas behind a transparent Electron window.
  root.style.colorScheme = root.classList.contains("sonora-desktop") ? "normal" : theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private browsing can block storage */
  }
}