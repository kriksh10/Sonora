---
name: Private installer delivery
description: Large download verification must be separate from approval and metadata checks.
---

Validate large installer delivery using the actual full-size private object through
the HTTP handler and client assembly, not only metadata, HEAD or small fixtures.

**Why:** Production approval and HEAD succeeded while the subsequent installer GET
aborted. Earlier small-fixture tests did not expose that failure. Direct storage
readback was intact, so storage integrity alone did not prove delivery worked.
The precise production interruption cause was not conclusively identified; do not
assert an undocumented hosting response limit.

**How to apply:** Preserve approval checks for every range and checksum verification
before saving. Distinguish local full-file transport verification from a signed-in
browser download on the published deployment, and both from native installation.
