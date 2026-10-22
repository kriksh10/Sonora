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

Treat installer identity as version plus checksum, not the displayed version alone.

**Why:** User-supplied replacement installers have reused the same version while
containing different desktop code. Version-only update checks cannot detect such
a replacement, and a matching version label does not establish which binary was tested.
A single uploaded project archive can also contain conflicting standalone and
nested installer copies with the same filename and version.

**How to apply:** Pin and verify the exact checksum when importing a supplied build.
Tell users when manual reinstallation is required; use a new version for future
newly built releases rather than silently treating a replacement as an automatic update.
When an archive contains multiple copies, compare their embedded runtimes with the
intended updated source before selecting the downloadable build; do not choose by
filename alone.
