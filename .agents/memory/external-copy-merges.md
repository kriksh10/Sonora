---
name: External Sonora copy integration
description: Preserve local capabilities when bringing changes back from an external copy.
---

Treat external copies of Sonora as a source of changes, not authoritative replacements for this workspace.

**Why:** The user explicitly requires preserving anything that exists here only, including backend, database, authentication/access approval and desktop functionality.

**How to apply:** Compare both sides before integrating. Preserve local-only files, dependencies and configuration; run relevant local regression checks when an imported implementation replaces established behavior.
