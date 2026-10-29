/** Only this approval-gated API may serve installer bytes, never arbitrary/public URLs. */
export function installerDownloadPath(url: string | null, base: string) {
  return url === "/api/desktop/installers/windows-x64"
    ? `${base.replace(/\/?$/, "/")}api/desktop/installers/windows-x64`
    : null;
}
