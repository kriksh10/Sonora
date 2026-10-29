/** Installer downloads are public, but restricted to this known Sonora endpoint. */
export function installerDownloadPath(url: string | null, base: string) {
  return url === "/api/desktop/installers/windows-x64"
    ? `${base.replace(/\/?$/, "/")}api/desktop/installers/windows-x64`
    : null;
}