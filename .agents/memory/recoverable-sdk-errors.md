---
name: Recoverable SDK errors in development
description: Expected third-party script failures can show a blocking development overlay even when recovery UI renders.
---

Verify recovery controls are usable, not merely mounted, when testing a third-party SDK outage in the development preview.

**Why:** A blocked Clerk script rejected outside React. Recovery UI rendered correctly, but the development runtime overlay still intercepted its retry button; a browser error listener alone did not prevent the overlay.

**How to apply:** Keep a recovery boundary outside the SDK provider and narrowly filter only the known, handled load-failure error in the development overlay. Do not disable unrelated runtime errors or treat an SDK outage as successful authentication.
