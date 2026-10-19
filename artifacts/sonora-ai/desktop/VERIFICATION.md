# Session setup and answer preferences

## Current source update — desktop 0.2.1

The live view is transcript-first, with a separate answer pane, independent follow/pause/jump scrolling, a compact consolidated window toolbar, background-opacity controls and persistent safe window bounds. Native capture supports two independently permissioned helper processes with source/time metadata; microphone speech cannot trigger automatic answers, and remote speech requires explicit source confirmation. Question assembly, bounded buffering and deduplication replace single-chunk/question-punctuation triggering.

Verified in the Linux workspace:
- All 62 deterministic JavaScript tests pass. New coverage includes native channel isolation/aggregate state, partial-start rollback and cancellation, serialized dual-source transcription and metadata, per-user concurrency with per-source rate limiting, candidate/Unknown suppression, chunk assembly, bounded question queue/overflow, replay deduplication, scroll follow/pause/jump/resize/reset, opacity validation, monitor-removal recovery, and late activation after End/idempotent-start protection.
- API/frontend type checks, frontend production build and desktop CommonJS syntax checks pass. Both managed services restart, and the actual development health response reports authentication protocol 1 and audio protocol 2.
- A visual-only fixture rendered from the real live-view component was inspected with fictional data. It does not access authentication or APIs and does not establish a working native window, device permissions, real Gemini delivery, or installed sign-in.
- Source/speaker metadata persistence, legacy Unknown behavior, owner isolation, transcript-off enforcement and prompt propagation have mocked route regression coverage. This is not a production-database or real-provider test.

The release remains in progress. Publishing is user-controlled and has not been performed by the agent. A newly built Windows installer, native transparency and dragging/resizing across DPI/monitors, real dual-channel audio/Gemini, installed sign-in, and receiver-side sharing checks still require the Windows PC. Mac equivalents require a Mac runner/device. No native installer, signature/notarization status or screen-sharing exclusion result has been newly certified.

## Previous source update — desktop 0.2.0

The new source implements browser-based desktop authentication for Google and email/password. It replaces embedded sign-in in the updated shell, requires an authenticated same-origin browser to approve the desktop's six-digit code, and binds a single-use exchange to a native-held verifier. Requests expire after five minutes, code approval permits at most five attempts, cancellation revokes pending approval, and issued Clerk tickets expire after 60 seconds. Credentials are not placed in browser callback URLs, source archives, or the handoff table. Concurrent claims, cancellation during issuance, replay, provider failure, and stale desktop callbacks have deterministic regression coverage.

Verified in this workspace:
- 50 JavaScript tests pass, including native-host/audio lifecycle, visibility, preferences, browser-auth host, server authorization state machine, and build preflight.
- API/frontend type checks and the production frontend build pass. Both managed workflows restart successfully.
- Live development API + PostgreSQL checks pass for health protocol discovery, start validation, request persistence, redacted public state, authentication enforcement, verifier binding, pending polling, cancellation, and replay rejection.
- The browser approval route renders its invalid-link state without a runtime error. This is visual smoke coverage, not a signed-in end-to-end test.
- The Rust PCM test results from the preceding audit remain applicable; the Rust source has not changed.
- A small source build kit is exported to generated-artifacts. It excludes credentials files, user uploads, databases, dependency caches, and old build outputs; archive integrity and current native/backend source inclusion were checked.

Still blocked / NOT verified:
- The updated hosted service must be republished, including its additive managed database schema, by the user. Publishing was not performed by the agent.
- The installed Windows shell must be rebuilt to receive the new native bridge and visibility controls. The source archive is not a finished installer. The build gate now requires `desktopAuthProtocol: 1` in the live service health response and refuses the older service.
- No Windows or Mac OS runner/device is available in this workspace. An actual new installer, full Google/email approval → Electron session → authenticated Gemini flow, native microphone/system capture, and receiver-side screen-share behavior have not been verified.
- No current installer has been uploaded or advertised as verified. The desktop release task remains in progress.

## Desktop and published-service audit — 2026-10-19

- The public published service responds to `/api/healthz` with HTTP 200 and `{"status":"ok"}`; `/sign-in` serves HTML with HTTP 200. Serving a sign-in page does not establish successful authentication.
- The published `/api/answer-preferences/defaults` returns HTTP 404, unlike the development endpoint's authenticated route. The hosted preferences update has not reached that published build.
- The published download manifest lists Windows x64, Mac arm64, and Mac x64 as unavailable, with no download URLs. No current installer is being offered by the site.
- The uploaded Windows archive contains a Windows installer and native audio helper. Its staged `main.cjs` differs from the current shell source and lacks the tray capture-exclusion checkbox. That older build cannot establish that the latest native controls work.
- All desktop CommonJS scripts pass `node --check`. The Electron 44.0.0 executable starts in Node mode in this Linux workspace; this checks the runtime binary, not the native GUI.
- The Rust helper's two PCM tests pass with `cargo test --locked` on Linux. They verify chunk encoding/resampling and silence/format handling, not Windows WASAPI capture or Mac audio permissions.
- Existing JavaScript test/type-check/build evidence below remains applicable; no code in those paths changed during this audit.
- Initial audit finding: Google browser sign-in had no browser-to-desktop authentication handoff. This gap is addressed in the current source update above, not yet verified in an installed native app. Do not describe either login path, receiver-side screen-share exclusion, or the release as fully verified.

The hosted app now has a Details → Preferences wizard and an editable session-preferences dialog. Format, length, tone, STAR method, and filler words are persisted per session and included in Gemini's system instructions. Set default writes owner-scoped settings for future sessions only. Existing legacy sessions receive compatible read-time defaults. Regular Call excludes resume context. Transcript writes check the current database flag at the write boundary.

Verification: 40 deterministic JavaScript tests pass, including 10 preference/preview/route tests. The route tests use an in-memory database adapter and mocked Gemini; they do not establish an authenticated browser journey, real database concurrency, or a live Gemini answer. API/frontend type checks and the web build pass; the API workflow restarts and serves health checks. Anonymous defaults/settings requests return 401. No authenticated end-to-end pass was run while the full desktop release remains incomplete.

The additive development schema update introduces nullable session preferences and a per-user defaults table without deleting session history. The published service needs republishing with the corresponding managed database schema changes before its desktop-hosted interface can use these endpoints. This hosted change does not itself require a new native installer. Native sign-in, audio capture, screen-sharing exclusion, and the separate compact floating-toolbar release work remain unresolved; no finished Windows/Mac release is claimed here.

# Visibility-control verification

The hosted desktop-only toolbar now exposes Hide Sonora and a separate Hide from screen sharing switch on all routed pages, including sign-in. Tray and toolbar share the native protection state. New deterministic tests cover protection state synchronization, failed protection changes, unsupported platforms, and hide/restore while audio remains active and tray Stop stays enabled.

Type checking, the production web build, and desktop JavaScript tests pass. The web build requires the existing service PORT and BASE_PATH configuration. Native Windows installation, shortcut registration, tray access, actual active capture, and receiver-side sharing exclusion still require a Windows PC; these tests do not establish native functionality. The previously supplied installer has not been rebuilt here. Republish for hosted toolbar changes, and rebuild/reinstall for native tray updates.

# Desktop release verification

## Current release blockers

- No published Sonora service URL exists yet. Requires user approval to publish.
- No connected/accessible native Mac or Windows release runner has been exercised. The manual build workflow needs a repository/runner or local target machines.
- No installer binaries exist; signing/notarization credentials have not been supplied.
- No real Mac/Windows install, embedded production sign-in, physical microphone/system-audio transcription, or meeting-app capture-exclusion check has been run.

These are **incomplete original scope**, not a verified desktop release.

## Checks possible in this Linux workspace

The GitHub-independent Windows launcher checks Node/pnpm/Rust/Git, MSVC and SDK availability, validates the hosted service before dependency downloads, and stops on failed build commands. Shared prerequisite and service gates are tested here; the `.cmd` launcher, Windows compiler, and NSIS output have not been exercised on Windows.

Run `pnpm --filter @workspace/sonora-ai run desktop:test` for deterministic checks of service-URL/origin/IPC restrictions, no fictitious download links, PCM chunk format/limits, silence handling, rate gating, pending-permission cleanup, provider failure cleanup, and aborting late transcript results.

Native integration checks additionally cover fixed helper executable/arguments, rejected or canceled consent, late-start cancellation, malformed protocol/WAV rejection, process exits, capture-state cleanup, stale-event filtering, and forwarding native chunks to the existing Gemini transcription route. These use simulated child processes, not real audio devices.

Run `CARGO_TARGET_DIR=generated-artifacts/native-target cargo test --locked --manifest-path artifacts/sonora-ai/desktop/native-audio/Cargo.toml` for the shared Rust PCM resampling/WAV and silence/format checks. Linux compilation does not compile the platform-specific Mac or Windows capture code. Each target's CI compilation and real-device checks remain required.

Web/API TypeScript checks and builds establish source compatibility, not native installer functionality. The public `/download` page can be visually checked without sign-in. The renderer's desktop bridge and OS APIs require native validation below.

## Native checklist (all currently blocked / not run)

Record OS build, architecture, Electron version, Sonora version, service URL, installer checksum, signing status, meeting-app/browser version, tester, and date for each row.

| Check | Windows x64 | Mac arm64 | Mac Intel |
| --- | --- | --- | --- |
| Installer produced; checksum matches downloaded bytes | Not run | Not run | Not run |
| Fresh-machine install, first visible launch, uninstall | Not run | Not run | Not run |
| Signature valid; Mac notarization/Gatekeeper validation | Not run | Not run | Not run |
| Email/password sign-in, restart persistence, sign-out | Not run | Not run | Not run |
| Create both session types; context; typed real Gemini answer | Not run | Not run | Not run |
| Real microphone speech → transcript → suggestion | Not run | Not run | Not run |
| Permissioned system audio with headphones → transcript → answer | Not run | Not run | Not run |
| Denied/revoked microphone/system audio; silence warning | Not run | Not run | Not run |
| Stop, End, switch, sign-out, reload, Quit, late permission cleanup | Not run | Not run | Not run |
| Hide while capturing shows active tray state; tray Stop works | Not run | Not run | Not run |
| Pin, dragging, display scaling, multiple monitors, shortcut conflict | Not run | Not run | Not run |
| Service offline, expired auth, Gemini failure, lag recovery | Not run | Not run | Not run |
| Meeting-app window share and whole-desktop capture with flag on/off | Not run | Not run | Not run |

Test Zoom, Teams, and Meet separately when available. For Meet record browser/version. Observe the receiver's shared image/recording, not just Sonora's local flag. Record visible/excluded/black-region behavior; do not generalize one application's result to another. Expect macOS ScreenCaptureKit to ignore legacy content protection.

Do not change a manifest build to `verified` until its installation, authentication, answer, audio, cleanup, and documented sharing behavior have been checked on that OS/architecture.
