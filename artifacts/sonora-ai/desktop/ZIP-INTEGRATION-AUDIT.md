# Uploaded project integration audit

Reviewed upload: `AI-Transcription-Product_1792644997330.zip`.

## Source coverage

All 343 uploaded files in the application, shared-library, and build-script
folders were accounted for, excluding installed dependencies, compiled output,
local credential files, and environment-specific artifact registration:

- 316 files were byte-identical at the audit.
- 27 files were intentionally adapted rather than omitted.
- No source or asset files were missing from those audited folders.

These counts describe file coverage, not proof that every native feature works.

## Included functionality

- Native microphone/system capture, PCM streaming, phrase encoding, and echo-reference source.
- Optional Speechmatics live transcription with Gemini phrase fallback.
- Gemini streamed answers, question-context selection, and explicit screenshot questions.
- Speaker-label selection for mixed phone audio, reset for each capture.
- Expanded call languages and session preferences.
- Public HTTPS job-description import, with additional network-safety checks.
- Session-list/transcript interface changes, answer-first live view, and scrolling controls.
- Desktop bridge updates, native runtime files, opacity migration, and visibility controls.
- Uploaded native/build-script sources, tests, and existing resume/session-round functionality.

## Intentional adaptations

- Kept approval gates on the download page and installer API.
- Kept private installer storage, authenticated range downloads, progress,
  cancellation, and checksum validation instead of the snapshot's public links.
- Kept storage dependencies and JSON-module support required by that release API.
- Used project Secrets instead of importing a local credential-file loader.
- Registered the live WebSocket route with the existing hosted API.
- Added stream cleanup, round/access checks, and fallback recovery.
- Kept speaker IDs scoped to mixed phone capture rather than treating IDs from
  independent microphone/system recognition streams as a shared voice identity.
- Fixed missing document-text handling and preserved source labels in answer context.
- Added bounded queued-phrase coalescing to respect the existing transcription pacing.
- Regenerated the API contract while preserving private-download operations.
- Merged the upload's secret-file exclusions with existing build/upload exclusions.
- Preserved workspace-specific runtime configuration rather than replacing it with
  configuration from another machine.
- Updated documentation to distinguish verified checks from native test gaps.

## Conflicting installer copies in the upload

Both copies are labeled `Sonora-0.3.5-win-x64.exe`, but they are not the same build.

| Location in uploaded project | Bytes | SHA-256 | Result |
| --- | ---: | --- | --- |
| `generated-artifacts/installers/Sonora-0.3.5-win-x64.exe` | 111124259 | `929ec3488ddca5fc499593a884df28fb4c1bcb4e7960a25a5560acd7d5d6dbf8` | Selected private preview download; inspected embedded runtime matches updated source. |
| Inside `generated-artifacts/installers/installer.zip` | 110902033 | `5f91344c97fe5636e2064b3e1f04c1f370309cfb9804de1b5a449fd89dd5cb9a` | Not selected; embedded main process, preload, and audio host do not match updated source. |

Historical build kits and compiler/dependency caches were not deployed as app
features. The original upload remains available in the workspace.

## Verification boundaries

See `VERIFICATION.md` for completed build, unit, private full-file transport, and
Speechmatics connection checks. Actual Windows audio/device behavior, signed-in
production browser delivery, and screen-sharing exclusion still need native
verification. This upload contains no Mac installer.
