# Sonora AI

A private, Gemini-powered interview assistant with session preparation, typed question testing, consent-first browser microphone transcription, and saved transcript/answer history.

## Run & Operate

- Use the managed `artifacts/sonora-ai: web` and `artifacts/api-server: API Server` workflows for the routed preview. Ports and base paths are supplied by their artifact configuration.
- `pnpm --filter @workspace/api-server run dev` — run the API server when `PORT` is supplied
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Server configuration: PostgreSQL, Clerk authentication, and the provisioned Replit Gemini integration. Credentials stay server-side; only Clerk's publishable key is exposed to the web client.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: generated Zod validators, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: Vite web frontend and esbuild ESM API bundle

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- Signed-in users create Interview or Regular Call sessions with context and output settings, ask Gemini before microphone access, and reopen their own saved history.
- PDF/TXT/Markdown context is extracted in the browser. Only extracted text is saved; original files and audio bytes are not retained.
- Live speech recognition depends on browser support and permission. This version captures microphone input, not call-platform system audio. Typed questions remain available when speech recognition cannot run.
- The offline Electron build does not connect to the hosted API; see `artifacts/sonora-ai/desktop/README.md` for current desktop limitations.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
