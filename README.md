# ResearchWeave

**Real-Time Research Collaboration & RAG Agent Platform**

ResearchWeave is a research and engineering SaaS application beginning with secure accounts and durable Research Spaces. Later product domains remain documented plans rather than shipped functionality.

## Current status

ResearchWeave has completed **Phase 4 — Collaboration, Members & Realtime Chat**. It now extends the authenticated Research Space boundary with private connections, owner-controlled membership, durable chat, and authenticated realtime delivery.

Implemented through the current phase:

- Registration, login, session restoration, protected routes, and logout
- bcrypt password hashing and opaque server-side sessions in secure cookie settings
- Responsive authenticated shell with only the implemented Research Spaces navigation
- Research Space list, empty state, creation, detail, owner editing, and confirmed deletion
- Membership-scoped reads and owner-only lifecycle authorization
- Private connection request, accept/reject/cancel, list, and removal workflows
- Connection-based member admission, member leave, and immediate access revocation
- PostgreSQL-backed chat history with stable cursor pagination
- Authenticated, Origin-validated WebSocket subscriptions and persist-before-broadcast chat
- Multi-tab-deduplicated presence, heartbeat, bounded reconnect, resubscribe, and REST recovery
- Shared Zod API contracts, versioned Drizzle migrations, structured errors, rate limiting, Origin checks, and automated authorization tests

Document ingestion, knowledge bases, RAG, paper research, agents, and activity are not implemented in this phase.

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

The Vite client runs at `http://localhost:5173`. The Express API runs at `http://localhost:3001`, and its versioned health endpoint is `GET /api/v1/health`. That endpoint performs a real `SELECT 1` database probe and returns `503` when PostgreSQL is unavailable.

### Authentication behavior

- Registering creates the account and a seven-day server-side session, then opens `/spaces`.
- Login failures use one generic message for unknown accounts and incorrect passwords.
- The browser receives only an opaque session token in an `HttpOnly`, `SameSite=Lax` cookie. Production cookies also use `Secure`.
- The database stores only a SHA-256 hash of the session token; the client does not store authentication truth in local or session storage.
- Protected routes redirect to `/login` and preserve only a validated same-origin return path.
- State-changing API calls require the configured `CLIENT_ORIGIN` in addition to normal CORS controls.

### Research Spaces

Authenticated users can create, list, and open spaces for which they have a membership. Space creation and the owner's membership are committed in one database transaction. Members can read a space; only its owner can rename, edit, or delete it. Deleting a space cascades its membership records.

Owners can add accepted connections as members and remove ordinary members. Members can list the durable membership record and leave a space themselves. Removing a connection does not remove an existing space membership.

Chat history is durable PostgreSQL state and is read through REST with a stable cursor. WebSocket carries only realtime deltas: authenticated clients subscribe to authorized spaces, and messages are persisted before they are broadcast or acknowledged. Presence means that at least one tab for the user is currently subscribed to the space; it is not durable membership truth.

Current routes are limited to `/`, `/login`, `/register`, `/connections`, `/spaces`, `/spaces/new`, `/spaces/:spaceId`, `/spaces/:spaceId/chat`, `/spaces/:spaceId/members`, and `/spaces/:spaceId/settings`. Unimplemented product routes are intentionally absent from the router and navigation.

Versioned APIs:

```text
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

GET    /api/v1/spaces/:spaceId/messages
WS     /api/v1/realtime
```

### Quality and production commands

```text
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`npm run build` creates the client and server production artifacts in `dist/`. Run `npm start` after building; Express serves both the API and the client-side application routes.

Database migration commands:

```text
npm run db:generate
npm run db:migrate
```

All runtime configuration is validated centrally on startup. `.env` is ignored by Git; commit only the documented placeholders in `.env.example`.

## Planned capabilities (not implemented)

- PDF, Markdown, and TXT document ingestion into knowledge bases
- Grounded knowledge questions with retrievable source citations
- Real arXiv paper search and clearly labelled abstract-based summaries
- Paper inspection, saving, and comparison
- Tool-calling research agents with durable task status and execution traces
- A unified activity history across collaboration, knowledge, research, and agents

## Architecture documentation

- [Legacy audit](docs/architecture/legacy-audit.md)
- [Product architecture](docs/architecture/product-architecture.md)
- [Technical architecture](docs/architecture/technical-architecture.md)
- [Migration map](docs/architecture/migration-map.md)
- [Implementation roadmap](docs/architecture/implementation-roadmap.md)

## Design documentation

- [UI/UX specification](docs/design/ui-ux-spec.md)
- [Design system](docs/design/design-system.md)
- [Navigation and routes](docs/design/navigation-and-routes.md)
- [Screen specifications](docs/design/screen-specifications.md)

## Project origin

**Original Team Project:**

[CommandBlock-Nexus](https://github.com/HereWeThink/CommandBlock-Nexus)

ResearchWeave is an independent post-project redesign and extension of the original team project. It is a new product architecture rather than a rename, visual reskin, or mechanical refactor. Future implementation may selectively adapt useful ideas or code from CommandBlock-Nexus—such as room-based real-time communication, API integration patterns, or arXiv metadata parsing—only after security, correctness, licensing, and architectural review.

Accordingly, ResearchWeave should not be described as “built completely from scratch” if any legacy implementation is later reused. Its accurate provenance is: an independent redesign and extension informed by the original team project, with selective reuse decisions documented in this repository.
