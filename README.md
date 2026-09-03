# ResearchWeave

**Real-Time Research Collaboration & RAG Platform**

ResearchWeave is a TypeScript research workspace for small teams. It combines secure Research Spaces, realtime collaboration, real academic discovery, durable document indexing, semantic retrieval, and citation-grounded knowledge answers in one modular monolith.

## Current status

ResearchWeave has completed **Phase 8B — Product UX Refinement & Accessibility**. The current release line integrates the shipped collaboration, Research, and Knowledge workflows behind a responsive, keyboard-accessible application shell.

Implemented through Phase 8B:

- secure registration, login, session restoration, protected routes, and logout
- Research Space creation, membership authorization, owner controls, and connections
- PostgreSQL-backed chat with authenticated WebSocket delivery, presence, reconnect, and REST recovery
- real arXiv search, paper detail, Space-scoped Saved Papers, and clearly labelled abstract-based summaries
- PDF, Markdown, and TXT upload with durable storage, extraction, deterministic chunking, embeddings, reindexing, retry, and failure states
- Space-authorized pgvector semantic retrieval and grounded answers with exact source citations
- integrated Research-to-Saved-Papers and Space-to-Knowledge workflows
- responsive desktop, tablet, and mobile navigation with accessible focus, status, error, and realtime-announcement behavior
- shared Zod contracts, versioned Drizzle migrations, structured errors, Origin checks, rate limits, and automated authorization coverage

ResearchWeave does **not** yet implement the Agent runtime, execution traces, unified Activity, or paper comparison. These remain planned work and are not represented by placeholder routes or fabricated data.

## Development setup

### Prerequisites

- Node.js 22 or newer
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

`LLM_BASE_URL` and `LLM_API_KEY` enable the OpenAI-compatible embedding adapter used for document indexing and semantic retrieval. Adding `LLM_MODEL` also enables abstract-based paper summaries and grounded answer generation.

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

## Current application routes

```text
/
/login
/register
/research
/research/papers/:paperId
/spaces
/spaces/new
/spaces/:spaceId
/spaces/:spaceId/chat
/spaces/:spaceId/saved-papers
/spaces/:spaceId/knowledge
/spaces/:spaceId/members
/spaces/:spaceId/settings
/connections
```

Future destinations such as Agents and Activity are intentionally absent from the runtime router and navigation.

## Versioned APIs

```text
GET  /api/v1/health

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

POST   /api/v1/spaces/:spaceId/documents
GET    /api/v1/spaces/:spaceId/documents
GET    /api/v1/spaces/:spaceId/documents/:documentId
POST   /api/v1/spaces/:spaceId/documents/:documentId/reindex
DELETE /api/v1/spaces/:spaceId/documents/:documentId

POST /api/v1/spaces/:spaceId/knowledge/retrieve
POST /api/v1/spaces/:spaceId/knowledge/ask
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
```

The smoke scripts refuse to use the normal `DATABASE_URL` or a non-empty target. CI provisions isolated databases for both checks.

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
