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