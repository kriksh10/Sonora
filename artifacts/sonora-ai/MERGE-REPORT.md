# Sonora GitHub integration

## Source and integration method

Imported `kriksh10/Sonora`, branch `cursor/parakeet-parity-3cea`, at
`8d1f2b4ac48a7195443b8ed9f0a9050d87e27220`. This includes the QA-fix and
Parakeet-parity changes from the two supplied pull requests.

The GitHub repository is a partial copy with unrelated Git ancestry. A wholesale
checkout or mirror would remove this project's backend, database packages,
desktop runtime, installer, artifact configuration, and tests. Changes were
therefore integrated selectively rather than by replacing the workspace.

## Preserved local functionality

- Existing Clerk proxy, browser-to-desktop sign-in exchange, user approval and
  owner/approver permissions.
- Existing sessions, rounds, transcripts, files, live Speechmatics WebSocket
  capture, Gemini answers, cancellation and ownership checks.
- Electron/native Windows and macOS source, packaging workflow, runtime allowlist,
  build commands, native dependencies, and existing Windows installer.
- Anonymous installer downloads; approval remains required to use the app.
- Existing artifact/workflow configuration, database, and other local-only files.

## Reconciled differences and unfinished branch code

- Kept the local audio worklet: the branch replacement failed quiet-speech,
  chunk-boundary and silence regression checks.
- Fixed the branch's 404 middleware, which incorrectly returned 404 for Vite
  runtime scripts and made the preview blank. Unknown document routes still
  return 404 in Vite development/preview; static production hosting controls
  production HTTP status behavior.
- Mounted the branch's `handleTranscribeRequest` through the existing protected
  session transcription route, including its availability probe. It now uses
  the Google SDK with Replit Gemini configuration instead of an unverified
  hand-built REST URL. Audio size/format validation, rate limits, retries,
  cancellation, round checks and ownership remain enforced.
- Used `titleForNewSession` when creating sessions, including mock sessions.
- Registered the branch's five tables in the existing shared Drizzle schema;
  the requested server schema path re-exports that single canonical definition.
  Applied the additive schema changes to the development database.
- Added persisted billing settings, credit balance/round settlement, notes and
  question-bank endpoints. Preparation generation has a separate protected
  endpoint so ended-session notes do not fail against the live-answer guard
  and preparation prompts do not pollute the live interview transcript.
- Removed silent optional-route fallbacks for saving preparation data.
  Notes, questions and auto-extend settings reload from the server.
- Added test-only checkout and raw-body signature-verified webhooks. Credit
  grants use a unique checkout reference inside a transaction to prevent replay.
  Settlement uses server timestamps and a unique session/round reference.
- Model choices are restricted to models supported by the configured Replit
  Gemini integration; OpenAPI and server validation match the frontend.
- Preserved existing dependencies and build scripts, adding only needed packages.
  Restored the missing declared App Storage dependency required by local code.

## Verification

- Full workspace typecheck passed.
- Full workspace build passed with explicit build-time `PORT` and `BASE_PATH`.
  Existing nonfatal sourcemap, module-directive and bundle-size warnings remain.
- Fourteen targeted regression checks passed: persisted tools, approval and
  ownership guards, replay-safe settlement, signed webhook replay and tampering,
  title selection, local answer context, packaged ASAR dependencies, and audio
  worklet behavior, and narrow Clerk load-error/overlay recovery.
- Actual session creation preserved mock type, explicit title, Gemini model,
  language and resume context. A real typed Gemini answer returned successfully.
- Development schema push completed successfully without force or destructive
  migration.
- API and web workflows restarted and served requests.
- Public pricing/privacy/terms pages returned 200; an unknown document route
  returned 404; Vite runtime scripts returned 200; anonymous transcription
  returned 401; release metadata remained public.
- A real SDK request through the configured Replit Gemini integration returned
  HTTP 200 for a synthetic WAV sample. This verifies provider connectivity,
  not the accuracy of real microphone or meeting transcription.
- Mobile landing screenshot at 390px rendered successfully after the startup fix.
  Browser checks confirmed ordinary sign-in/sign-up widgets, dashboard redirection,
  no horizontal overflow at 390px, and a new signed-in QA user blocked with 403
  pending approval. A blocked Clerk script produced recovery controls; the
  development overlay initially obscured them. A final targeted test of the
  actual runtime-overlay plugin confirms that this specific handled SDK error
  is filtered before any overlay/parent notification is sent. Other errors
  remain visible. Unblocking and retrying loaded the ordinary sign-in widget.

## Remaining configuration and platform boundaries

- Nothing has been published; the production database was not migrated.
- Prices in the imported catalog are explicitly marked placeholders, not
  confirmed live offers.
- No Stripe credentials were requested or added. Without test keys and a webhook
  secret, checkout returns `comingSoon: true`; live keys are rejected.
  Actual hosted test checkout additionally requires trusted `SONORA_PUBLIC_URL`.
- Credit accounting is a preview. It does not introduce a payment-based access
  gate, terminate sessions, or change the owner's approval policy.
- Native Windows/macOS capture, real Meet/phone audio, capture exclusion and
  installer installation cannot be established by Linux/browser checks.
  No installer was rebuilt in this change.
- The imported minimal PDF exporter is still limited to a single ASCII page;
  text export retains the full text. This pre-existing branch limitation was
  not expanded into an export redesign during the integration.
