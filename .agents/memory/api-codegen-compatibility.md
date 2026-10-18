---
name: API code generation compatibility
description: Why catalog-managed Zod needs an explicit generator target and request schemas need distinct names.
---

Keep Orval's Zod output target explicit and aligned with the installed Zod major; do not rely on automatic version detection for pnpm catalog dependencies.

**Why:** The generator could not infer the installed major from a `catalog:` dependency and fell back to Zod 4 output even though the project used Zod 3, producing validators that did not compile.

**How to apply:** When changing Zod or Orval, check the generator target and regenerate rather than editing generated files.

Use named component schemas for request bodies rather than operation-named inline body types when exporting both generated validators and types from the same barrel.

**Why:** Inline request bodies can cause the generated schema constant and generated type to have the same exported name, making wildcard barrel exports ambiguous.

**How to apply:** Give the shared request schema a distinct domain name in OpenAPI, then regenerate both client types and validators.
