# Sonora desktop release

## Release status

**Source and release pipeline only. No Mac or Windows installer has been produced, signed, notarized, uploaded, or tested on native hardware yet.** The download page deliberately shows unavailable builds rather than offering broken links.

The service has not been published at the time of this implementation. Desktop packaging refuses to use an empty URL, a development preview domain, or an unhealthy/unrecognized service. Do not mark the desktop release complete until the blockers in `VERIFICATION.md` are resolved.

## Targets

- Windows x64: Windows 11 recommended. Electron's capture-exclusion API requires Windows 10 version 2004 or later for exclusion rather than a black rectangle; the sharing application can still behave differently.
- macOS arm64 (Apple Silicon) and x64 (Intel): macOS 14.2 or later for the supported system-audio path.
- No Linux installer or Windows ARM installer in this release.

## Runtime

The packaged app loads the publisher-configured HTTPS Sonora service, not an offline `file://` bundle. Internet and the hosted frontend, authentication, API, database, and Gemini service remain required. It opens visibly on first launch and defaults to a compact session view. Create a session and type a question before granting audio permission to check Gemini independently.

Use email/password sign-in inside the app. Some social identity providers reject embedded browsers; opening a browser externally does not transfer its authenticated session to Electron. Native sign-in must be validated against the production Clerk instance. If required, authorized administrators can configure embedded/native application settings through the Replit-managed Clerk dashboard; do not put secret keys in this package.

### Audio and lifecycle

- Microphone and system audio require explicit user initiation and OS permission. The system-audio native dialog lets users cancel or select a display source. **System audio can include other applications**, not just the interview.
- Electron establishes an audio/video display stream when required by Chromium; Sonora reads only its audio track. Screen pixels are never uploaded or persisted.
- The audio worklet produces independent six-second mono 16 kHz PCM WAV chunks. Gemini `generateContent` transcribes these chunks with rate limiting and bounded retries. This is **not Gemini Live** and is not word-by-word transcription.
- Raw audio is request-scoped and not stored by Sonora. Provider processing applies. Recognized text follows the session's Save Transcript setting.
- Silence is not sent. After 18 seconds of silence the UI asks users to check source, volume, and permissions. A silent track is not proof that OS audio access works.
- If processing falls more than two waiting chunks behind, the app stops with an error instead of silently dropping speech. Stopping discards an unfinished final chunk and cancels in-flight client work; the server/provider may finish a request already received.
- Stop, End, session switching, sign-out/unmount, reload, source-end, failure, and Quit release the tracks. Permission cancellation also stops any stream granted late.
- **Hide does not stop audio.** Capture state and Stop remain available in the tray; the assistant also displays a clear warning before hiding. Quit terminates capture with the app.

### Window privacy

- `Ctrl/Cmd + Shift + Space`: show/hide. A registration failure is shown in the UI.
- Tray: show, hide, Stop capture, pin, and Quit.
- Content protection uses Electron's documented `setContentProtection` on Windows/macOS. The UI reports that the flag is set, **not that the meeting app has verified exclusion**.
- **Modern macOS ScreenCaptureKit capture can ignore this setting entirely.** Windows recording/sharing applications can also differ. There is no universal invisibility or undetectability guarantee.
- Test the exact OS, meeting app, sharing mode, and version before relying on exclusion. Sharing a specific call/application window rather than the whole desktop is the safer fallback where appropriate.
- Use assistance only where the interview rules permit it. This is not a monitoring bypass.

## Build locally on the target OS

Install Node 22+ and pnpm 10.26.1. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/sonora-ai run desktop:test
```

1. Publish the Sonora web/API service with the user's approval. Obtain its actual production URL through deployment metadata; never substitute a preview domain.
2. Set the public `SONORA_RELEASE_URL` build setting to that HTTPS URL in the native runner environment.
3. On Windows: `pnpm --filter @workspace/sonora-ai run desktop:package win x64`
4. On macOS: `pnpm --filter @workspace/sonora-ai run desktop:package mac arm64` and/or `... mac x64`
5. Run `node artifacts/sonora-ai/desktop/checksums.cjs`.

`desktop:prepare` verifies the hosted health and Sonora release marker, then creates an isolated package under `generated-artifacts/desktop-app/` containing only the native shell, public service URL, and generated artwork. No workspace dependencies, credentials, database, or web source are bundled. Installers and checksums go under `generated-artifacts/installers/`, excluded from Git and deployment.

`desktop/package-release.cjs` requires a native OS runner rather than pretending a Linux cross-build establishes a valid Mac/Windows release.

### Native CI

`.github/workflows/desktop-build.yml` is manual-only. Run it on a connected GitHub repository with the published service URL. Its Windows/macOS jobs produce **unsigned preview** artifacts and checksums; they do not publish a GitHub release or change public download links. This workflow has not been executed here.

For a signed release, use electron-builder's standard platform signing/notarization environment on a protected native runner. Windows requires an appropriate code-signing identity; macOS requires an Apple Developer signing identity and notarization credentials. Supply secrets only through the runner's secrets mechanism, never files, frontend code, or chat. The build configuration includes hardened runtime, microphone entitlements, and permission descriptions; it does not acquire certificates or approve publishing. Unsigned artifacts must remain labeled unsigned previews, not verified releases.

## Download delivery

After building and validating native installers:

1. With approval, store the `.exe` / `.dmg` and checksum files in durable release storage (App Storage or an approved release host), not Git.
2. Update `public/desktop-release.json` only with actual, reachable HTTPS download URLs and SHA-256 values. Use `preview` for an untested build; `verified` requires passing the native checklist. Include exact signing/notarization status.
3. Republish the frontend with approval so `/download` and the workspace's Desktop downloads link expose the real builds.

## Development

Generate the tray artwork using `node artifacts/sonora-ai/desktop/build-assets.cjs`.
Set `SONORA_DESKTOP_URL` to a running development URL, then run `pnpm --filter @workspace/sonora-ai run desktop:run`.

`desktop:dev` starts a local frontend helper only. It does not run/proxy the backend or configure Clerk for localhost, so it is not a complete local end-to-end setup. Use the hosted workspace for a full development service. Production packages never use this override.

## References

- https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows
- https://www.electronjs.org/docs/latest/api/desktop-capturer
- https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts
- https://www.electron.build/code-signing
