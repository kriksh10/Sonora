---
name: Sonora access policy
description: Owner-approved app access rather than automatic access after signup.
---

Sonora should be usable by people the owner approves, not automatically by anyone who signs up.

**Why:** The user explicitly selected "People I approve" when asked who should be allowed to use Sonora.

**How to apply:** Keep authentication separate from permission to use the app. Apply the same owner-approved access policy to website and desktop usage while preserving individual users' interview privacy.

The owner may designate an additional person to approve access requests.

**Why:** The user explicitly requested that another person be able to approve too.

**How to apply:** Scope this to approval permission without assuming full owner/admin privileges. Keep account identifiers in authorized setup/task configuration, not project memory.

Approved users should also be able to download the desktop installer.

**Why:** The user requested the installer in the download option for anyone who has approval.

**How to apply:** Apply current approval checks to the download bytes, not only the page. Do not expose a permanent public file URL that bypasses approval; already downloaded files cannot be recalled.
