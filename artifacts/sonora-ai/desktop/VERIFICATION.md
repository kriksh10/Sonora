# Desktop release verification

## Current release blockers

- No published Sonora service URL exists yet. Requires user approval to publish.
- No connected/accessible native Mac or Windows release runner has been exercised. The manual build workflow needs a repository/runner or local target machines.
- No installer binaries exist; signing/notarization credentials have not been supplied.
- No real Mac/Windows install, embedded production sign-in, physical microphone/system-audio transcription, or meeting-app capture-exclusion check has been run.

These are **incomplete original scope**, not a verified desktop release.

## Checks possible in this Linux workspace

Run `pnpm --filter @workspace/sonora-ai run desktop:test` for deterministic checks of service-URL/origin/IPC restrictions, no fictitious download links, PCM chunk format/limits, silence handling, rate gating, pending-permission cleanup, provider failure cleanup, and aborting late transcript results.

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
