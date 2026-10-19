---
name: Electron desktop runtime
description: Native Electron checks on this Replit Linux workspace need desktop runtime libraries and may remain visually headless.
---

Electron can be added to a web artifact for desktop shell work, but its binary depends on desktop libraries that are not present by default in this Linux workspace. A virtual X display may also not be exposed to the interactive shell, so treat visual native-window testing here as limited even when the binary and web build are healthy.

**Why:** This is a headless cloud development environment rather than a user's desktop operating system.

**How to apply:** Verify Electron's binary and static desktop code in the workspace, then validate actual window behavior from a local desktop environment or packaged build before describing GUI behavior as fully tested.

## Requested desktop scope

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