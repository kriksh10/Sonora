# Sonora desktop verification

## Uploaded Windows candidate and private downloads

The separately supplied Windows installer is the reviewed candidate, not the
different installer nested in the uploaded full-project archive.

- Filename: `Sonora-0.3.5-win-x64.exe`
- Size: 110,902,033 bytes (105.8 MiB).
- SHA-256: `5f91344c97fe5636e2064b3e1f04c1f370309cfb9804de1b5a449fd89dd5cb9a`
- Signing: no Authenticode certificate table; unsigned.
- NSIS extraction confirmed its embedded ASAR and native helper match the separate
  archive's unpacked files. Required runtime files and local imports pass the
  archive verifier. The embedded service configuration is HTTPS, not localhost
  or a development-preview host.
- The embedded host accepts the current 144044-byte audio format and includes
  `audio-devices.cjs`. Workspace source also retains compatible six-second helpers.
- The installer is stored privately in App Storage, not in a public static folder.
  Upload and a full readback matched the pinned byte count and SHA-256.

The existing **Desktop downloads** option now loads protected release metadata.
Both metadata and installer GET/HEAD requests use the existing approval guard.
Download bytes are streamed through the backend; no public storage URL or
credential is returned. The browser requests authenticated 4 MiB byte ranges,
retries an interrupted part up to twice, and displays progress and cancellation.
Each range checks approval again. Only after assembling the exact byte count and
verifying the complete SHA-256 does the client offer the local EXE for saving.
Already downloaded installers cannot be recalled or prevented from being copied;
application usage still requires current sign-in and approval.

Prior upload checks: **113 JavaScript tests**, **three Rust encoder tests**,
API/frontend typechecks and production builds passed. That JS suite includes
actual Rust encoder output through microphone/system host delivery and server WAV
validation, pause-based routing, and real approval middleware with controlled
identity/database/storage fixtures for HTTP download cases. Anonymous requests
to the running metadata/download endpoints return 401 with private/no-store
headers. The signed-out download page renders correctly.

Download repair checks: the five targeted download tests passed, including an
opt-in real-storage transfer of all 110,902,033 installer bytes through the HTTP
range handler and the client assembler (27 parts, final SHA-256 matched).
Controlled tests cover invalid/suffix/open ranges, approval revocation, interrupted
part retry, auth errors, corrupt bytes, stale servers and cancellation.
API/frontend typechecks and production builds passed again. Both managed services
started cleanly and the signed-out page rendered. The deployed version logged
successful HEAD followed by aborted GET transfers; its underlying interruption
cause was not conclusively identified. A signed-in browser download on the
published repaired version remains to be confirmed after republishing.

**Not established:** native Windows installation/launch, real microphone/meeting/
phone-speaker acoustics, real-call transcription/answer latency, receiver-side
capture exclusion, or macOS release readiness. Fixture checks are not physical
device checks. The desktop release task remains open for these checks.

**Rollout:** publish the updated hosted API and frontend with App Storage
configuration, then sign in with an approved account and open Desktop downloads.
For an older installed 0.3.5 build, manually download and reinstall this candidate:
the version alone cannot distinguish the two 0.3.5 binaries. Use its SHA-256.
Publishing alone does not replace native code already installed on a PC.

For future reviewed candidates, update the server release metadata and run the
API package's `scripts/upload-desktop-installer.mjs` with the local EXE path.
It rejects a file that differs from the pinned size/hash, uploads only to private
storage, and verifies the uploaded bytes. Do not place installers in Git.

## Phone input and focused live view — source 0.3.5

The active call now has a compact toolbar, an opaque readable answer surface,
safe emphasis/list/code rendering, and optional transcript. Session setup,
audio devices, readiness and timing diagnostics are inside **Session**.

**Phone on speaker:** open Session → Input → Phone on speaker, acknowledge the
mixed-microphone capture notice, then press Start phone listening. Audio is not
started by choosing the mode. Put the phone near the computer microphone.
Both voices remain Unknown, not identified interviewer speech. Use Recent to
review the recognized utterance and Answer recent to submit it, or type/edit
the question. Alt+Enter is the default Answer recent shortcut while Sonora has
focus; Session lets you choose Ctrl/Cmd+Shift+Enter instead. It is not a global
shortcut. Optional mixed-audio automation requires a separate explicit opt-in;
it can answer candidate questions too. Pause it in the live strip, or re-enable
it from Session with the warning visible. Do not use it where assistance or
recording is not permitted.

The new native helper and browser worklet emit independent **4.5-second** WAVs
instead of six-second WAVs (25% less chunk buffering). A final chunk with at
least 700ms of trailing quiet can submit recognized questions after a 350ms
assembly wait. Chunks without that signal retain the conservative assembly
fallback; older installed helpers remain compatible, but do not gain the new
native cadence or acoustic-boundary hint just by republishing.

Session → Diagnostics displays the latest local transcription duration and
time until first answer text, measured after Ask or after speech transcription.
These measurements do not include an unmeasured acoustic question-end time and
are not a guaranteed latency. No content or identifiers are sent as timing
telemetry. Network/provider duration and request queuing still vary.

Verified in this Linux workspace:
- 108 deterministic JavaScript tests pass, including phone consent/manual
  shortcuts, mixed-input routing, normal candidate suppression, reset
  invalidation, recent-utterance bounds, Markdown safety, real ASAR inspection,
  and 4.5-second worklet/quiet-boundary behavior.
- Three Rust encoder tests pass for duration/WAV integrity, short speech and
  idle-loopback padding, silence and invalid device formats.
- Frontend type checking and production build pass. The existing large-bundle
  warning remains nonfatal.
- The real live-view component was inspected at 780×720 and 520×650 using
  fictional session data. This establishes visual layout only, not sign-in,
  recording, speech recognition, a real Gemini response or native opacity.

Before release: republish the hosted frontend, extract the 0.3.5 source kit
into a fresh folder on the Windows PC, run BUILD-WINDOWS.cmd and install the
newly generated executable. Verify a real phone-speaker question with both
manual and opt-in automatic answers, candidate misfire behavior, computer-call
audio, elapsed first-text timings, permission denial, Stop, mode/session/round
switches and quit. Existing native sign-in, install, screen-sharing and Mac
acceptance checks below remain required. No Windows/Mac executable or real-call
latency benchmark has been produced or certified in this Linux workspace.

## Startup packaging repair — source 0.3.4

The reported 0.3.3 installed startup crash (`Cannot find module './audio-devices.cjs'`)
was caused by the electron-builder allowlist omitting a module that staging included.
Staging and packaging now share one runtime-module list. Staged imports are audited,
and the post-pack hook reads the actual `app.asar`, rejecting missing runtime files or
relative CommonJS imports before installer creation can succeed. Regression checks
build a real ASAR with the configured allowlist and reject an archive with the
reported omission. These are archive checks, not a Windows-native launch test.

Extract the 0.3.4 kit into a new directory, rebuild with BUILD-WINDOWS.cmd, close the
old Sonora process (including tray), then run the newly produced 0.3.4 installer.
Republishing the hosted site cannot repair files inside an already installed ASAR.

## Call-output routing and answer policy — source 0.3.3

Windows builds now offer local output-device discovery and explicit Meeting output selection. Match this to Meet's Settings → Audio → Speakers; capturing the Windows default alone does not establish capture of a separately routed headset. Names never enter session history or diagnostic exports. Missing/ambiguous selected devices fail visibly instead of silently switching output. Stop capture before changing output, then restart explicitly.

The hosted update paces queued transcription per source to respect the server's four-second guard, recognizes additional interviewer request phrasings, and gives experienced practical answers for topics outside resume coverage while preserving selected length and truthful personal context. The readiness meter uses the selected output and its Gemini check now includes the current round.

Required real Windows checks (not performed in this Linux workspace):
- Route Meet to a non-default headset, select it in Meeting output, start capture with interviewer mapping and Auto Answer explicitly enabled, and verify the Call meter, transcript and streamed answer.
- Ask repeated questions and follow-ups for several minutes; include "I'd like you to explain…", unpunctuated transcription and a topic absent from the resume.
- Disconnect/reconnect the selected output; verify a recoverable error or lack-of-activity guidance, not a falsely healthy answer-ready indicator. Refresh devices and explicitly restart.
- Check both channels, Stop/End, denied permission, source changes and a subsequent interview round.

Existing installed shells need a rebuild/reinstall for output selection. Republishing only updates hosted code and answer policy. A source kit is not an installer and these changes do not establish native Windows/Mac verification.

## Access, resume and round update — source 0.3.2

See [ACCESS-AND-RESUMES.md](ACCESS-AND-RESUMES.md) for the hosted changes, private API integration checks and remaining target-environment checks. Source kits are not native installer artifacts; the desktop release remains unverified until the Windows/Mac checks below are performed.

## Opacity repair — desktop 0.3.1

The title bar now uses a dedicated drag handle; interactive controls and the complete settings subtree explicitly opt out of native dragging. The range previews background alpha immediately, serializes/coalesces native writes, ignores older broadcasts while a newer choice is pending, restores the confirmed value on failure, and reports a five-second timeout rather than staying stuck. The native minimum is now 15%; older shells without the new minimum capability retain their 45% limit, and missing methods have explicit rebuild instructions. Settings remain opaque, but the live answer backdrop uses the shared alpha variable without fading text.

Linux checks: 83 desktop JavaScript regressions pass, including latest-intent ordering, stale broadcasts, failure/retry, timeout, invalid ranges, opaque reset and disposal. Frontend TypeScript passes. These are source checks, not evidence that a Windows compositor or native mouse drag works. Rebuild/reinstall the 0.3.1 Windows shell and execute the contrasting-background / pointer / keyboard / relaunch checklist in WINDOWS.md before claiming native translucency verified. No Windows installer was built by this cloud workspace.

The frontend production build passes with the managed PORT/BASE_PATH configuration. A rendered fixture using the real React control and a simulated bridge confirms a dispatched range-input event updates the displayed percentage, shared background variable and simulated native value to 15%. Its screenshot is a browser check only: no physical mouse, Windows hit-testing, persistence across native relaunch or receiver-side screen sharing is claimed.

## Current source update — desktop 0.3.0

Implemented an answer-first live layout with optional collapsed transcript, real SSE answer delivery, independent answer state/partial interruption display, Retry/Cancel, live length controls, contextual Shorten/Explain more/Answer again, and local keyboard shortcuts. Audio readiness uses locally processed activity meters with explicit consent, Stop/close cleanup and a 45-second limit; a separate real Gemini test does not save test history. Offline detection stops capture rather than silently restarting it on reconnect. Native title-bar maintenance exposes a manual allowlisted diagnostic export and user-approved installer discovery; no update is advertised without a compatible manifest and an available binary-served file.

The native helper emits status independently of complete chunks. Responsive quiet loopback is no longer classified as a dead helper; bounded silence padding finishes short speech chunks while reporting real source inactivity separately. Real device errors, microphone no-data and stalled processes remain failures. The compact window keeps enough minimum height for an answer rather than shrinking to a few unreadable lines.

Verified in this Linux workspace:
- JavaScript regression coverage includes real progressive SSE parsing, completion validation, interrupted/disconnected/no-save streams, authenticated owner restrictions, contextual actions, locally processed readiness levels with zero transcription requests, 75 seconds of simulated idle-loopback health, malformed status/device failure, answer-first control wiring and per-session transcript collapse, update approval boundaries, missing/HTML installer rejection, and diagnostics content exclusion.
- Three Rust PCM tests pass, including short speech followed by loopback padding, silence handling and format/error behavior. These test the encoder, not Windows or macOS capture drivers.
- API/frontend type checks, a frontend production build and desktop CommonJS syntax checks pass.
- A real `gemini-2.5-flash` streaming SDK request returned non-empty content through the configured integration. It is not an installed-desktop or authenticated-browser end-to-end check and does not establish latency under interview conditions.
- Both managed development workflows restarted successfully; the proxied health response reports authentication 1, audio 2 and answer 1. The real live-view component was rendered with fictional data and inspected at desktop and narrow widths. This visual-only fixture has no working controls, authentication or audio access.

**Still blocked for release:** this workspace cannot run a Windows or Mac installer and has no attached native runner. Publishing remains user-controlled. Republish the hosted changes, build the current shell on the Windows PC, then verify installed sign-in, long-running real microphone/system audio, automatic remote-question answers, permission/device recovery, native window translucency/dragging, and receiver-side sharing. Mac packaging and native verification still require a Mac. No new installer, signature/notarization result, or screen-share invisibility result has been certified. The desktop release task remains in progress.

## Previous source update — desktop 0.2.1

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
