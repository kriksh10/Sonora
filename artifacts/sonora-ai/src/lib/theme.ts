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
  document.documentElement.dataset.sonoraTheme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private browsing can block storage */
  }
}
