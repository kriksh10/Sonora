---
name: Electron desktop runtime
description: Native Electron checks on this Replit Linux workspace need desktop runtime libraries and may remain visually headless.
---

Electron can be added to a web artifact for desktop shell work, but its binary depends on desktop libraries that are not present by default in this Linux workspace. A virtual X display may also not be exposed to the interactive shell, so treat visual native-window testing here as limited even when the binary and web build are healthy.

**Why:** This is a headless cloud development environment rather than a user's desktop operating system.

**How to apply:** Verify Electron's binary and static desktop code in the workspace, then validate actual window behavior from a local desktop environment or packaged build before describing GUI behavior as fully tested.

## Requested desktop scope

Prioritize Windows first and use a release path that does not require GitHub.

**Why:** The user chose Windows first after GitHub authorization remained blocked and asked to create downloadable apps without GitHub.

**How to apply:** Work on local Windows packaging before Mac delivery; do not make GitHub reconnection a prerequisite for desktop progress.

The user wants a downloadable, working Sonora app for both Mac and Windows. By "hide" during interviews, they mean the assistant stays visible to them but is excluded from screen sharing, not simply minimized.

**Why:** The user explicitly clarified both the target platforms and what "invisible during screen share" means.

**How to apply:** Scope desktop delivery for both operating systems and distinguish supported capture exclusion from ordinary show/hide controls. Explain capture-method limitations and never promise universal invisibility.

## Capture-exclusion feasibility

Do not treat Electron's content-protection flag as evidence that a sharing application excludes the window. Modern macOS ScreenCaptureKit-based capture can ignore the legacy window flag entirely.

**Why:** The user's central requirement is seeing suggestions locally while excluding them from screen sharing, and this is a platform limitation rather than a UI toggle implementation detail.

**How to apply:** Require receiver-side checks for each OS, meeting-app version, and sharing mode. State the Mac limitation before promising parity or a release; use window-specific sharing as a fallback where appropriate.

## Preserve Sonora's product

Keep Sonora's existing interface and Gemini answer system when incorporating native desktop capabilities. Do not replace the product with Meetily's interface.

**Why:** The user explicitly chose to retain Sonora's interface and Gemini answer system after reviewing Meetily.

**How to apply:** Treat Meetily as a potential source of native audio/transcription components, not approval for a wholesale framework or product migration. Clarify the transcription approach separately from Gemini answer generation.

The user selected **native capture + Gemini transcription**, not local speech models.

**Why:** The user explicitly chose that option for the packaged Sonora apps.

**How to apply:** Keep both transcription and answer generation on the existing Gemini service. Do not add Whisper/Parakeet model downloads or convert to Tauri as part of this choice.

## Session-creation reference scope

Use the user-supplied session-creation screenshots and video as a requirements reference, not merely as visual inspiration. The newer screenshots show a two-step Details → Preferences wizard; the accompanying video shows an older Regular Call form. The reviewed inventory and unknowns are recorded in `.local/tasks/session-creation-reference.md`.

**Why:** The user supplied these materials specifically so session-creation behavior would not be missed later.

**How to apply:** Preserve confirmed choices and distinguish observed behavior from assumptions. Keep the existing Sonora/Gemini product scope; screenshots of Mock mode, other model vendors, or transcript contributions are not permission to add those features or share private transcripts.

## Desktop authentication direction

Use regular-browser authentication followed by an explicit desktop-code approval and a native-held, one-time proof exchange. Do not solve embedded OAuth failures by transferring browser cookies or putting authentication credentials in callback URLs.

**Why:** Social providers can reject embedded Electron browsers, and logging in to the regular browser does not create an authenticated Electron session. The user requires both Google and email login to reach the installed app.

**How to apply:** Preserve this security boundary when revising desktop sign-in. Treat backend protocol support, browser approval, and the installed shell as a coordinated release; republishing cannot update native code in an existing installer.

## Hosted access for desktop

Make the hosted Sonora site publicly reachable while retaining Sonora sign-in and owner-restricted session access.

**Why:** The user explicitly selected public hosting with Sonora sign-in retained so the desktop app can reach its service without Replit's private-deployment gate.

**How to apply:** Distinguish hosting visibility from application authentication. Do not remove Sonora's auth checks or bundle a Replit protection-bypass token into installers; publishing actions remain user-controlled.

## Live desktop priorities

The user wants a transparent, freely movable desktop app. Once a session starts, answers must be the main focus, with the transcript collapsed by default and available on demand. New answers must automatically scroll into view rather than requiring navigation through a crowded setup page.

**Why:** After using the installed app, the user clarified that the candidate needs to see answers rather than a dominant transcript. This supersedes their earlier transcript-primary request.

**How to apply:** Use answer-first live mode with optional transcript access. Keep setup/history separate from active-call content, and distinguish visual transparency from screen-share exclusion.

## Source attribution is not speaker identity

Keep microphone and system/call audio separate. Treat speaker labels as explicit user-confirmed source mappings, not voice identification. Candidate and Unknown speech must not independently trigger automatic answers; preserve manual question selection for mixed or uncertain audio.

**Why:** The user asked how interviewer and candidate are distinguished because the earlier question heuristic could answer the candidate's own speech. A system loopback may contain several people, other apps or locally monitored microphone audio.

**How to apply:** Preserve source provenance through transcription, history and answer context. When supporting multiple capture streams, retain a user-wide in-flight limit but allow each source's legitimate cadence; a single shared minimum interval can reject healthy simultaneous streams.