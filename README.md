# ResearchWeave

**Real-Time Research Collaboration & RAG Platform**

ResearchWeave is a TypeScript research workspace for small teams. It combines secure Research Spaces, realtime collaboration, real academic discovery, durable document indexing, semantic retrieval, and citation-grounded knowledge answers in one modular monolith.

## Current status

ResearchWeave completed **Phase 10 — Product Integration Experience** through Phase 10A–10D with `v0.10.0`. The current release baseline is `v0.10.1`, a post-`v0.10.0` application-demo stability patch. The delivered Phase 10 scope adds durable global workspace read models, the Overview and unified Activity experience, and Space-scoped abstract-based Saved Paper comparison. Final repository audit, clean-machine reproducibility, browser end-to-end validation, performance evaluation, portfolio polish, and deployment remain post-release work.

Implemented through Phase 10:

- secure registration, login, session restoration, protected routes, and logout
- Research Space creation, membership authorization, owner controls, and connections
- PostgreSQL-backed chat with authenticated WebSocket delivery, presence, reconnect, and REST recovery
- real arXiv search, paper detail, Space-scoped Saved Papers, and clearly labelled abstract-based summaries
- PDF, Markdown, and TXT upload with durable storage, extraction, deterministic chunking, embeddings, reindexing, retry, and failure states
- Space-authorized pgvector semantic retrieval and grounded answers with exact source citations
- integrated Research-to-Saved-Papers and Space-to-Knowledge workflows
- system-managed Agent definitions, Space-scoped immutable Tasks, retry Runs, cancellation, and durable execution traces
- bounded Agent execution through an immutable allowlist of arXiv search, Knowledge retrieval, and grounded-answer tools
- production Agent Worker readiness, PostgreSQL leases, heartbeats, fencing, recovery, and lifecycle shutdown coordination
- authorization-aware PostgreSQL-backed Overview and Activity read models, including stable reverse-keyset Activity pagination
- global Overview summaries and unified Activity with URL-backed category and Space filters
- comparison of two to four unique current-Space Saved Papers using stored arXiv metadata and abstract evidence
- a responsive, accessible comparison workflow whose generated result is local, ephemeral, and never assigned a history record or comparison ID
- responsive desktop, tablet, and mobile navigation with accessible focus, status, error, and realtime-announcement behavior
- shared Zod contracts, versioned Drizzle migrations, structured errors, Origin checks, rate limits, and automated authorization coverage

Agent definitions, Tasks, Runs, and server-validated evidence are available through the authenticated Agent workspace. Overview and Activity are derived from durable authorized records. Paper comparison remains explicitly abstract-based: it does not compare PDFs, full text, or indexed Knowledge documents, and comparison results are not persisted. Complete browser end-to-end evaluation remains post-release work.

## Development setup

### Prerequisites

- Node.js 22.13.0 or newer
- npm 11 or newer
- Docker with Docker Compose

### First run

1. Copy `.env.example` to `.env` and keep the local values or replace them with your own development settings.
2. Install dependencies with `npm install`.
3. Start PostgreSQL and pgvector with `docker compose up -d --wait`.
4. Apply versioned database migrations with `npm run db:migrate`.
5. Start the client and API together with `npm run dev`.

The Vite client runs at `http://localhost:5173`. The Express API runs at `http://localhost:3001`; `GET /api/v1/health` performs a real database probe and returns `503` when PostgreSQL is unavailable.

### Optional model-backed capabilities

`LLM_BASE_URL` and `LLM_API_KEY` enable the OpenAI-compatible embedding adapter used for document indexing and semantic retrieval. Adding `LLM_MODEL` also enables abstract-based paper summaries, abstract-based paper comparison from stored paper metadata and abstracts, grounded answer generation, and the production Agent runtime.

The Agent runtime is configured only when all three `LLM_*` values are present. With the complete triple, the API starts one Agent Worker after HTTP listening and reports Agent availability only after its initial database claim probe succeeds. With missing or partial configuration, the application still starts, no Agent Worker is constructed, and Agent definitions report `provider_unconfigured`. Agent availability does not change the database-only `/api/v1/health` result.

These values are server-only. If they are absent, the corresponding operations return explicit unavailable or failed states rather than generated fallback content. Original documents are stored under `DOCUMENT_STORAGE_DIR` and are never served as a public directory.

## Product areas

### Collaboration

Research Spaces are the authorization and collaboration boundary. Members can work with shared chat history, saved papers, and indexed documents; owners control membership and Space lifecycle. WebSocket messages are authorized against current durable membership and persisted before broadcast.

### Research

Research uses real arXiv metadata. Search results retain canonical and versioned identifiers, abstracts, source links, and normalized metadata. Optional generated summaries are restricted to paper metadata and abstract content and are labelled **Abstract-based Summary**.

Saved Papers are explicit Space-scoped records. Saving a paper does not claim that its full text has been downloaded or indexed.

### Knowledge

Space members can upload PDF, Markdown, or TXT documents. A durable worker extracts text, creates deterministic chunks and embeddings, and exposes queued, processing, ready, and failed states. Reindexing preserves the last good active index until replacement succeeds.

Semantic retrieval filters all vector queries by current Space membership and compatible active indexes. Grounded answers cite only the authorized chunks supplied to the model and report insufficient context instead of inventing an answer.

### Agents

The application exposes the system Research Agent, Space-scoped task submission, durable Runs, retries, cancellation, and execution traces. The production Worker uses PostgreSQL claims, leases, heartbeats, and fencing; local process shutdown leaves interrupted work recoverable through lease expiry rather than persisting a cancellation or failure. The client presents runtime availability, immutable task history, safe step observations, and server-validated evidence through REST polling.

### Overview and Activity

Overview provides a bounded, authorization-aware summary of recent Spaces, active document or Agent work, and recent Activity. Unified Activity projects durable collaboration, Research, Knowledge, and Agent records with stable reverse-keyset pagination. Category and Space filters are URL-backed and are reauthorized on every page request.

### Paper comparison

Space members can explicitly compare two to four unique Saved Papers from the current Space. The comparison service receives only stored arXiv metadata and abstracts. Selection is restored from repeated `paper` query parameters, while generated results remain local to the current page session and are not persisted as comparison history or IDs.

## Current application routes

```text
/
/login
/register
/overview
/activity
/research
/research/papers/:paperId
/agents
/agents/tasks
/agents/tasks/:taskId
/agents/runs/:runId
/spaces
/spaces/new
/spaces/:spaceId
/spaces/:spaceId/chat
/spaces/:spaceId/saved-papers
/spaces/:spaceId/saved-papers/compare
/spaces/:spaceId/knowledge
/spaces/:spaceId/members
/spaces/:spaceId/settings
/connections
```

This list reflects the current runtime router. It does not include unimplemented global Knowledge, Settings, or alternative comparison routes.

## Versioned APIs

```text
GET  /api/v1/health

GET  /api/v1/activity
GET  /api/v1/overview

POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/auth/session
POST /api/v1/auth/logout

GET    /api/v1/connections
POST   /api/v1/connections/requests
PATCH  /api/v1/connections/:connectionId
DELETE /api/v1/connections/:connectionId

GET    /api/v1/spaces
POST   /api/v1/spaces
GET    /api/v1/spaces/:spaceId
PATCH  /api/v1/spaces/:spaceId
DELETE /api/v1/spaces/:spaceId

GET    /api/v1/spaces/:spaceId/members
POST   /api/v1/spaces/:spaceId/members
DELETE /api/v1/spaces/:spaceId/members/:userId

GET /api/v1/spaces/:spaceId/messages
WS  /api/v1/realtime

GET    /api/v1/research/papers/search
GET    /api/v1/research/papers/:paperId
GET    /api/v1/research/papers/:paperId/summary
PUT    /api/v1/research/papers/:paperId/summary
GET    /api/v1/spaces/:spaceId/saved-papers
PUT    /api/v1/spaces/:spaceId/saved-papers/:paperId
DELETE /api/v1/spaces/:spaceId/saved-papers/:paperId
POST   /api/v1/spaces/:spaceId/paper-comparisons

POST   /api/v1/spaces/:spaceId/documents
GET    /api/v1/spaces/:spaceId/documents
GET    /api/v1/spaces/:spaceId/documents/:documentId
POST   /api/v1/spaces/:spaceId/documents/:documentId/reindex
DELETE /api/v1/spaces/:spaceId/documents/:documentId

POST /api/v1/spaces/:spaceId/knowledge/retrieve
POST /api/v1/spaces/:spaceId/knowledge/ask

GET  /api/v1/agents
GET  /api/v1/agents/:agentId
POST /api/v1/spaces/:spaceId/agent-tasks
GET  /api/v1/spaces/:spaceId/agent-tasks
GET  /api/v1/agent-tasks/:taskId
POST /api/v1/agent-tasks/:taskId/runs
GET  /api/v1/agent-runs/:runId
GET  /api/v1/agent-runs/:runId/steps
POST /api/v1/agent-runs/:runId/cancel
```

## Quality and production commands

```text
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`npm run build` creates production client and server artifacts in `dist/`. Express serves both the API and client-side routes when started in production mode.

PostgreSQL/pgvector smoke tests require separate, empty disposable databases whose names contain the indicated smoke identifier:

```powershell
$env:PHASE6_SMOKE_DATABASE_URL = "postgresql://.../phase6_smoke"
npm run test:phase6:postgres

$env:PHASE7A_SMOKE_DATABASE_URL = "postgresql://.../phase7a_smoke"
npm run test:phase7a:postgres

$env:PHASE9_SMOKE_DATABASE_URL = "postgresql://.../phase9_smoke"
npm run test:phase9:postgres

$env:PHASE10A_SMOKE_DATABASE_URL = "postgresql://.../phase10a_smoke"
npm run test:phase10a:postgres
```

The smoke scripts refuse to use the normal `DATABASE_URL` or a non-empty target. CI provisions isolated databases for all four checks, including the Phase 9 runtime lifecycle gate and the Phase 10A durable workspace read-model gate.

Database migration commands:

```text
npm run db:generate
npm run db:migrate
```

All runtime configuration is validated on startup. `.env` and original document storage are ignored by Git; commit only the documented placeholders in `.env.example`.

## Architecture and design documentation

- [Product architecture](docs/architecture/product-architecture.md)
- [Technical architecture](docs/architecture/technical-architecture.md)
- [Implementation roadmap](docs/architecture/implementation-roadmap.md)
- [UI/UX specification](docs/design/ui-ux-spec.md)
- [Design system](docs/design/design-system.md)
- [Navigation and routes](docs/design/navigation-and-routes.md)
- [Screen specifications](docs/design/screen-specifications.md)

See [CHANGELOG.md](CHANGELOG.md) for release history.
