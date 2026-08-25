# ResearchWeave

**Real-Time Research Collaboration & RAG Agent Platform**

ResearchWeave is a planned research and engineering SaaS application that brings collaborative research spaces, real-time discussion, document knowledge bases, grounded retrieval-augmented generation, arXiv discovery, paper comparison, and tool-calling research agents into one coherent product.

## Current status

ResearchWeave has completed **Phase 1 — Foundation** and now includes a runnable full-stack engineering skeleton: a React client, an Express API, PostgreSQL with pgvector, versioned Drizzle migrations, structured logging, configuration validation, and automated tests.

**Phase 2 — UI/UX & Design System Specification** documents the future application shell, navigation, design tokens, responsive behavior, accessibility, and screen interactions. It is design/documentation only. Authentication, collaboration, RAG, agent, document-ingestion, arXiv, WebSocket, and LLM business features remain planned work.

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

## Planned core capabilities

- Research Spaces with members, connections, and real-time chat
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
