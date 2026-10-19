# Session setup and answer preferences

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
