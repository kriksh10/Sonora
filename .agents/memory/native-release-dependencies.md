---
name: Native release dependencies
description: Why Sonora must retain platform-specific optional dependencies for native desktop build runners.
---

Keep optional build-tool binaries available for both supported Mac architectures and Windows x64. Do not restore blanket Linux-only dependency pruning when optimizing cloud installs.

**Why:** The workspace template originally removed non-Linux optional dependencies. That optimization conflicts with the user's requirement for native Mac and Windows release builds, even when the same tests pass on Linux.

**How to apply:** When changing dependency overrides or release installation steps, consider each supported native runner. Confirm readiness on those runners rather than treating successful Linux checks as native validation.
