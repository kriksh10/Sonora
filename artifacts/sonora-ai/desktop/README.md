# Sonora desktop release

## Live view and separate audio channels

The current source is version 0.3.2. Native transparency, saved window placement, idle-channel health, activity meters and maintenance tools require rebuilding and installing this shell; republishing only replaces the hosted interface.

Approval-gated access, editable resume imports and interview rounds are hosted features shared by the browser and packaged app. See [access, resumes and rounds](ACCESS-AND-RESUMES.md) for setup and checks.

- Drag the Sonora handle on the left of the persistent top bar to move the window, including while the content is scrolling. Controls and the entire settings popup are outside the drag region. Resize from window edges. Window settings provide background opacity from 15% to 100% and an opaque fallback. Slider preview is immediate; native writes are serialized and intermediate values coalesced so older responses cannot snap it back. This changes the backdrop, not the text opacity or screen-sharing protection. Settings deliberately remain opaque for readability. Older supported shells retain their 45% minimum and show rebuild guidance; shells without the native method show an explicit unavailable message.
- Opening a session switches to the answer-first live view. The transcript is collapsed by default and opens on demand without enabling saving. Panes follow the latest content until you scroll up; Jump to latest resumes following. Gemini answer text streams as received. Supported native builds can stream live PCM to configured Speechmatics transcription; if unavailable, finished phrases use Gemini transcription, with each captured phrase capped at 4.5 seconds. Queued phrases may be combined within the server's eight-second limit to respect request pacing.
- Readiness opens a pre-interview check with explicit Start/Stop, separate local source meters and a 45-second automatic stop. This level check sends no audio to Gemini. A separate fixed question tests real Gemini answer connectivity without adding question/answer history; it does not prove audio-to-answer or start recording automatically.
- Live length controls affect subsequent answers. Shorten, Explain more and Answer again use the current question without duplicating interviewer transcript lines. Ctrl/Cmd+Enter asks the draft, or re-asks the current question when focus is outside text fields. Enter in the question box asks; Shift+Enter adds a line.
- Interrupted output is marked partial with Retry, and Cancel stops the request. Current answer/draft stay visible through network failures; offline detection stops capture and reconnecting never restarts it silently. Sign-out/session switches clear protected live state.
- On desktop, choose Call audio for remote speech or Both for separately captured microphone and system audio. Confirm “Mic = me · call = interviewer” only when that is true for your setup. Enable Auto Generate in Answer settings if desired; its state is shown in the live title.
- Microphone speech never independently triggers automatic answers. Confirmed remote question turns can trigger them; uncertain sources stay Unknown/Remote and can be selected manually. Source mapping is not voice identification or multi-person diarization. System audio can include other applications, multiple people, or your voice if your system monitors it. Use headphones, and leave the mapping unconfirmed if uncertain.
- Both channels require separate native permissions. Denial/failure cancels the group and stops already-started capture. Stop, End, session switch, sign-out and Quit clean up every channel. Hiding retains the documented active-capture behavior; use the window or tray Stop control.
- Current packaging requires hosted health support for authentication protocol 1, audio protocol 2 and answer protocol 1. Publish the latest service before building. No current installer is advertised as verified until real platform checks pass.

## Release status

**Desktop release is not yet verified.** A user-built older Windows installer exists, but it predates the current browser sign-in handoff and visibility updates. No current Windows/Mac installer is hosted. The download page deliberately shows unavailable builds rather than offering broken links.

The service is published, but it must be republished with the latest API and database schema before the updated desktop can sign in. Packaging checks `desktopAuthProtocol: 1` in the hosted health response and refuses old/unhealthy services, empty URLs, and preview domains. Do not mark the desktop release complete until the blockers in `VERIFICATION.md` are resolved.

## Targets

For a local Windows build without GitHub, see [WINDOWS.md](WINDOWS.md) and use `BUILD-WINDOWS.cmd` from the project root.

- Windows x64: Windows 11 recommended. Electron's capture-exclusion API requires Windows 10 version 2004 or later for exclusion rather than a black rectangle; the sharing application can still behave differently.
- macOS arm64 (Apple Silicon) and x64 (Intel): macOS 14.4 or later for native system-audio capture.
- No Linux installer or Windows ARM installer in this release.

## Runtime

The packaged app loads the publisher-configured HTTPS Sonora service, not an offline `file://` bundle. Internet and the hosted frontend, authentication, API, database, and Gemini service remain required. It opens visibly on first launch and defaults to a compact session view. Create a session and type a question before granting audio permission to check Gemini independently.

The updated shell signs in through the regular browser for both Google and email/password. Click **Sign in with browser**, authenticate, then enter the six-digit code displayed in the desktop app on the browser approval page. Return to Sonora for completion. Requests expire after five minutes and can be cancelled; starting again creates a new request. Older shells show an update-required message rather than offering a broken social-login flow.

The desktop keeps a random verifier only in native memory. The browser URL carries only a random request id; the browser never receives that verifier or the resulting ticket. A signed-in, same-origin browser must explicitly approve the matching code (five attempts maximum). The native proof redeems approval once for a 60-second, single-use Clerk ticket. The renderer exchanges it for its own persistent Clerk session. No browser cookies, passwords, API keys, or sign-in tickets are bundled or stored in the handoff table. Native production sign-in still requires end-to-end validation on the target machine.

### Audio and lifecycle

- Microphone and system audio require explicit user initiation, a cancelable Sonora consent dialog, and OS permission. **System audio can include other applications**, not just the interview.
- Packaged apps use a bundled Rust helper: CPAL microphone capture, Windows WASAPI output loopback through CPAL, and a macOS Core Audio process tap adapted from Meetily. This path captures no screen video. The older Chromium/audio-worklet path remains only for compatibility with older desktop bridges; a failed native start never silently falls back.
- The helper downsamples to independent 4.5-second mono 16 kHz PCM WAV chunks. Gemini `generateContent` transcribes these chunks through the existing authenticated API with rate limiting and bounded retries. This is **not Gemini Live** and is not word-by-word transcription. Sonora's interface and Gemini answer generation are unchanged; no speech models are downloaded.
- The main process fixes the helper path and accepted sources, restricts native IPC to the trusted hosted main frame, validates WAV messages, and does not pass provider secrets to the helper. Capture stops on renderer exit/navigation, Quit, tray Stop, control-pipe EOF, protocol/queue errors, or startup timeout. Native captures keep the tray active until the helper exits.
- The helper has no network client or audio-file output. Audio remains in bounded memory buffers until sent to Gemini by the existing client. It emits validated status heartbeats independently of complete audio chunks. Idle system loopback is not treated as a dead process: bounded silence padding finishes short speech chunks, while UI source status still reports the absence of actual samples. Microphone no-data, device errors, helper loss and stalled pipes remain explicit failures; no fabricated transcripts are returned.
- Raw audio is request-scoped and not stored by Sonora. Provider processing applies. Recognized text follows the session's Save Transcript setting.
- Silence is not sent. After 18 seconds of silence the UI asks users to check source, volume, and permissions. A silent track is not proof that OS audio access works.
- If processing falls more than two waiting chunks behind, the app stops with an error instead of silently dropping speech. Stopping discards an unfinished final chunk and cancels in-flight client work; the server/provider may finish a request already received.
- Stop, End, session switching, sign-out/unmount, reload, source-end, failure, and Quit release the tracks. Permission cancellation also stops any stream granted late.
- **Hide does not stop audio.** Capture state and Stop remain available in the tray; the assistant also displays a clear warning before hiding. Quit terminates capture with the app.

### Maintenance and updates

Open the native title-bar Window settings → About, diagnostics & updates, including on sign-in pages. It displays installed native version/protocol information and checks hosted compatibility separately.

Diagnostic export is manual, previewable and allowlisted; no audio, transcripts, questions, answers, credentials, account information, local paths or device identifiers are exported or uploaded. Native report contents are fixed by the main process.

Update checks read the trusted hosted `desktop-release.json`, require a matching platform/architecture and valid version, SHA-256 and signing description. Available installer URLs must be same-origin HTTPS, without credentials/query/fragment, ending in `.exe` or `.dmg`; redirects are rejected. HEAD responses must serve a binary installer content type (for example `application/octet-stream`); HTML/JSON fallback pages are rejected. The app checks availability before offering a download and asks for native confirmation before opening the browser. Compare the downloaded file’s SHA-256 with the displayed hash before installing: downloaded bytes are not automatically verified. Installation remains manual, with no forced restart. The publisher must upload a real installer to a durable same-origin download route before marking a manifest build available. Missing/unavailable manifests never imply the installed app is current.

### Window privacy

- `Ctrl/Cmd + Shift + Space`: show/hide. A registration failure is shown in the UI.
- Tray: show, hide, Stop capture, pin, and Quit.
- Content protection uses Electron's documented `setContentProtection` on Windows/macOS. The UI reports that the flag is set, **not that the meeting app has verified exclusion**.
- **Modern macOS ScreenCaptureKit capture can ignore this setting entirely.** Windows recording/sharing applications can also differ. There is no universal invisibility or undetectability guarantee.
- Test the exact OS, meeting app, sharing mode, and version before relying on exclusion. Sharing a specific call/application window rather than the whole desktop is the safer fallback where appropriate.
- Use assistance only where the interview rules permit it. This is not a monitoring bypass.

## Build locally on the target OS

Install Node 22+, pnpm 10.26.1, and Rust 1.88 with the target OS's native compiler/SDK. macOS cross-architecture builds also require that Rust target. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/sonora-ai run desktop:test
cargo test --locked --manifest-path artifacts/sonora-ai/desktop/native-audio/Cargo.toml
```

1. Publish the Sonora web/API service with the user's approval. Obtain its actual production URL through deployment metadata; never substitute a preview domain.
2. Set the public `SONORA_RELEASE_URL` build setting to that HTTPS URL in the native runner environment.
3. Build the helper first: `pnpm --filter @workspace/sonora-ai run desktop:build-native x64` on Windows; use `arm64` or `x64` on macOS.
4. On Windows: `pnpm --filter @workspace/sonora-ai run desktop:package win x64`. On macOS: `... desktop:package mac arm64` and/or `... mac x64`.
5. Run `node artifacts/sonora-ai/desktop/checksums.cjs`.

`desktop:prepare` verifies hosted health, the Sonora release marker, and the target's compiled audio helper. It then recreates isolated staging under `generated-artifacts/desktop-app/` with the shell, helper, public URL, artwork, and attribution notice. The helper is bundled outside ASAR under `resources/native`, inside the app bundle for macOS code signing. Native release verification must confirm that nested executable's signature and audio permissions. No workspace dependencies, provider credentials, database, or web source are bundled. Installers, Rust target output, and helper binaries stay under ignored `generated-artifacts/`.

`desktop/package-release.cjs` requires a native OS runner rather than pretending a Linux cross-build establishes a valid Mac/Windows release.

### Native CI

`.github/workflows/desktop-build.yml` runs native helper compilation/tests and desktop checks on Windows x64, Mac Apple Silicon, and Mac Intel when relevant code is pushed to `main`. Intel uses an Intel runner so its test executable is not assumed to work through Rosetta. These automatic checks do not produce installers. To build installers, run the workflow manually with the published service URL. Its Windows/macOS jobs produce **unsigned preview** artifacts and checksums; they do not publish a GitHub release or change public download links.

The macOS capture adapter derives from MIT-licensed Meetily code. `native-audio/THIRD_PARTY_NOTICES.txt` preserves its copyright/license notice and is copied into packaged releases. Meetily's frontend, transcription models, telemetry, and meeting-summary product are not incorporated.

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
