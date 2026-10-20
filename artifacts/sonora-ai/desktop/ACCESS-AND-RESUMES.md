# Access, resumes and interview rounds

Source version: 0.3.2. This is not a claim that native installers have been built.

## Publishing and accounts

- The development database schema has additive access and interview-round fields. For this project's Replit-managed PostgreSQL, Publish applies the development-to-production schema diff. Review the Publish UI; do not run a custom production schema script.
- Set server-only `SONORA_OWNER_EMAIL` and optional `SONORA_APPROVER_EMAIL` in the target environment. Neither address belongs in browser code. Shared environment values are configured in this project.
- Each environment bootstraps only matching, verified primary-email Clerk identities. Startup checks existing identities; a later matching verified sign-in can also bootstrap. It does not create accounts, use the first signup as owner, or regrant a previously revoked record.
- The owner uses **Access** to approve, deny or revoke. The additional approver uses **Approvals** and can only approve pending, explicitly requested ordinary-user access. They cannot change roles, deny, revoke or read another person's interview content.
- All other accounts request access and wait. Authentication alone is not permission to use Sonora. The gate polls every 15 seconds and fails closed on errors; server checks also cover answer generation, transcription, files and desktop pairing/redemption.
- Existing browser sign-in protocol 1 and audio protocol 2 remain compatible. Desktop browser pairing requires approval as well as a signed-in browser account. A previously paired app is still subject to access checks.

## Resumes

DOCX, classic DOC, selectable PDF, TXT and Markdown are supported, as is pasted text. The editable preview is the text used when creating the session. Replace and Remove cancel stale reads; a failed replacement preserves previous text. Files are limited to 12 MiB. Context is limited to 40,000 characters, with explicit overflow feedback and no silent truncation.

Word bytes are processed temporarily in a bounded server worker, with ZIP expansion checks, an eight-second deadline and concurrency limits. Raw files are not stored. PDF and text extraction runs in the client. Scanned/image-only PDFs need text pasted or a text-based replacement; OCR is not included. Encrypted, damaged and empty documents produce errors rather than creating empty context.

## Interview rounds and deletion

End the current session, then choose **Start next round**. The same interview keeps its context/preferences and saved history, with a new round and reset timer. It returns to Ready: capture does not restart without an explicit start and permissions. History filters show current or earlier rounds; unavailable legacy dates are not invented. Save Transcript off remains off.

**Delete interview** is available only when ended and asks for permanent confirmation. It removes that interview's rounds and saved transcript/answers, not unrelated interviews or account defaults. Other users—including owners and approvers—cannot access or delete your private interviews through these controls.

## Checks and remaining limits

- Type checks and production builds cover the API and web app.
- `pnpm --filter @workspace/sonora-ai run desktop:test` runs JavaScript regressions, including extraction error, cancellation, overflow and endpoint-contract checks. PDF parser behavior is mocked in those unit checks.
- `node scripts/test-sonora-features.cjs` runs private synthetic identities against the development database. It checks route-level permissions, concurrent/idempotent restart, stale round rejection, ownership, Save Transcript off, deletion, and real DOC/DOCX extraction including table text. It deletes its synthetic data afterward and is not a production route.
- Authenticated browser UI, native sign-in/capture, Windows transparency/dragging, screen-share exclusion and Mac/Windows installers still require target-environment verification. No native binary is included or declared available by this update.
