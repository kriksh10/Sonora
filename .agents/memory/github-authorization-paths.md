---
name: GitHub authorization paths
description: Avoid treating Git provider connection messages as proof of usable Git or API credentials.
---

Verify Git push authorization separately from connector API authorization. A Git-provider “connected” notification does not by itself prove either path works.

**Why:** Reconnecting through the offered GitHub card still left Git dry runs rejected, while the connector directory remained unauthorized and its credential-fetch path exposed no usable connection. No local Git credential override explained the mismatch.

**How to apply:** Use a non-mutating push dry run for Git and the actual connector status for API setup. If a newly approved connection still fails, report the distinct observed failures rather than repeatedly asking the user to reconnect or claiming upload access is fixed. Never print credentials or bypass the platform's authorization flow.
