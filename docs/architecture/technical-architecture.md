# ResearchWeave Technical Architecture

## Architecture style

ResearchWeave should be a **Pragmatic TypeScript Modular Monolith**: one React frontend, one Express backend process, one PostgreSQL database, and a small in-process job worker. Modules have explicit application-service and repository boundaries, but deploy together.

```text
React + TypeScript + Vite
        | HTTPS REST                       | authenticated WebSocket
        v                                  v
Express HTTP adapters               WebSocket event adapters
        |                                  |
        +--------- Application services ---+
                    |  Auth / Spaces / Chat / Connections
                    |  Documents / Knowledge / Research
                    |  Agents / Activity
                    v
          Repositories and integration adapters
             | PostgreSQL + pgvector
             | development file storage
             | arXiv API
             | server-configured LLM/embedding provider
```

This is not a microservice architecture. Module boundaries exist for ownership, tests, and explanation—not independent deployment.

## Proposed repository structure

ResearchWeave uses vertical backend modules instead of over-centralized `routes/` and `services/` directories that create file-by-layer coupling. Shared contracts, persistence, integrations, and tests remain explicit architectural boundaries. Add new module directories only when their implementation phase begins; do not create empty folders prematurely.

```text
ResearchWeave/
├─ src/                         # browser application only
│  ├─ app/                     # router, layouts, providers, route guards
│  ├─ components/ui/           # reusable presentational primitives
│  ├─ features/
│  │  ├─ overview/
│  │  ├─ collaboration/
│  │  ├─ knowledge/
│  │  ├─ research/
│  │  ├─ agents/
│  │  ├─ activity/
│  │  └─ settings/
│  ├─ lib/                     # typed HTTP client, query client, WS client
│  ├─ styles/
│  └─ main.tsx
├─ server/
│  ├─ app.ts                   # Express composition; no listen side effect
│  ├─ index.ts                 # process boot and graceful shutdown
│  ├─ config/                  # validated environment and provider config
│  ├─ middleware/              # auth, CSRF, request ID, errors, limits
│  ├─ modules/                 # vertical backend slices
│  │  ├─ auth/
│  │  ├─ spaces/
│  │  ├─ chat/
│  │  ├─ connections/
│  │  ├─ documents/
│  │  ├─ knowledge/
│  │  ├─ research/
│  │  ├─ agents/
│  │  └─ activity/
│  ├─ integrations/            # arXiv, LLM, embeddings, file parsing
│  ├─ jobs/                    # persistent job runner and handlers
│  ├─ realtime/                # authenticated WS gateway and channels
│  └─ db/                      # schema, migrations, connection
├─ shared/
│  ├─ contracts/               # request/response/event schemas safe for both sides
│  └─ domain/                  # small cross-boundary enums/IDs only
├─ tests/
│  ├─ integration/
│  └─ e2e/
└─ docs/architecture/
```

Each backend module may contain `routes.ts`, `service.ts`, `repository.ts`, `schemas.ts`, and tests when required. Do not create a generic base repository, event bus, or dependency-injection framework. `server/app.ts` manually wires concrete dependencies so the flow remains visible.

Global `hooks/`, `services/`, `types/`, and `utils/` buckets should not become default dumping grounds. Keep feature-specific code in its feature. Add a shared item only after two real consumers need it.

## Frontend architecture

### Responsibilities

- URL routing, layouts, selected-space context, and authenticated route guards live in `src/app`.
- Feature folders own pages, components, queries, mutations, form schemas, and view models for that domain.
- `src/lib/http` sends same-origin requests, handles typed error envelopes, and never stores provider secrets.
- A query/cache library is recommended for server state, invalidation, cancellation, and loading/error behavior. Short-lived form/UI state remains local React state.
- `src/lib/realtime` owns one reconnecting WebSocket, channel subscriptions, event validation, and cache updates. Components do not create sockets directly.
- Shared UI primitives provide accessible buttons, dialogs, inputs, status badges, table/list patterns, skeletons, and error banners.

### State rules

- **Server state:** users, spaces, messages, documents, papers, tasks, and activity come from APIs and the server-state cache.
- **Realtime state:** presence and transient connection health come from WebSocket events; durable statuses are also queryable by REST after reconnect.
- **URL state:** resource IDs, filters worth sharing, and selected detail pages belong in the route/query string.
- **Local state:** dialog visibility, draft text, and unsaved form values.
- **localStorage:** theme and harmless UI preferences only. Never authentication truth, API keys, passwords, authorization, messages, or canonical domain data.

### Frontend error boundary

Use route-level error boundaries plus component-level query errors. The UI must distinguish authentication failure, authorization failure, validation error, external dependency failure, no retrieval result, and unexpected server error. Every displayed error includes a correlation/request ID where available, not stack traces.

## Backend architecture

### HTTP and composition

`server/app.ts` creates an Express application from injected configuration, database, repositories, and integrations. `server/index.ts` validates environment variables, starts HTTP/WebSocket/job worker, and handles graceful shutdown. Tests can import `app.ts` without binding a port.

Routes authenticate, validate, call one application service, and translate the result to HTTP. They do not query the database or call arXiv/LLM directly.

### Application services

Services enforce domain rules and authorization. Examples:

- `SpaceService.addMember(actor, spaceId, userId)` verifies owner/membership policy.
- `ChatService.sendMessage(actor, spaceId, input)` verifies membership, persists, records activity, then emits a domain notification.
- `DocumentService.createUpload(...)` validates metadata and creates a durable indexing job.
- `RetrievalService.retrieve(...)` selects authorized knowledge-base chunks and returns ranked evidence.
- `ResearchService.searchArxiv(...)` returns real results or a typed upstream error.
- `AgentService.runTask(...)` creates a bounded run whose tools call these same services.

### Repository and integration boundaries

Repositories own SQL and return domain records. Integrations wrap external protocols with timeouts, response-size limits, typed errors, and test doubles. The arXiv adapter parses Atom XML with an XML parser, not regex. LLM and embedding adapters read provider/base URL/key from validated server configuration only.

## Authentication and authorization boundary

1. Register validates username/email and password, then stores a bcrypt-compatible hash—never plaintext.
2. Login verifies the hash and creates an opaque server session.
3. The session ID is sent in a `Secure`, `HttpOnly`, `SameSite=Lax` cookie. The browser cannot read it.
4. State-changing REST requests use same-origin checks and a CSRF token strategy appropriate to the cookie session.
5. WebSocket upgrade authenticates from the session cookie and validates `Origin`. User identity is attached server-side and cannot be supplied in an event payload.
6. Every service receives the actor identity and checks ownership/membership. Initial roles are only `owner` and `member`; do not build enterprise RBAC.

Space resources inherit the space authorization boundary. Connection requests are limited to their sender/recipient. Agent tools receive a scoped execution context and cannot escape the task's space/knowledge-base permissions.

## Proposed data model

IDs should be UUID/ULID-style stable identifiers; timestamps are stored in UTC. The table list is a logical model; future entities are introduced only in the phase that implements their domain.

| Entity | Key fields and relationships | Purpose |
|---|---|---|
| `users` | id, email/username, password_hash, display_name, created_at | Account identity. |
| `sessions` | id_hash, user_id, expires_at, revoked_at | Opaque server-side sessions. |
| `connections` | id, requester_id, recipient_id, status, responded_at | Pending/accepted user connection; unique unordered pair policy. |
| `research_spaces` | id, owner_id, name, description, created_at | Primary collaboration boundary. |
| `space_members` | space_id, user_id, role, joined_at | Owner/member authorization and membership. |
| `chat_messages` | id, space_id, sender_id, body, created_at, edited_at | Durable ordered chat history. Attachments can be added later when real storage exists. |
| `knowledge_bases` | id, space_id, name, description, created_by | Retrieval scope owned by a space. |
| `documents` | id, space_id, uploader_id, filename, mime_type, byte_size, checksum, storage_key, status, error_code | Uploaded source and lifecycle. |
| `knowledge_base_documents` | knowledge_base_id, document_id, added_at | Many-to-many inclusion without duplicating documents. |
| `document_chunks` | id, document_id, ordinal, text, token_count, page/section/start/end metadata | Stable retrievable source units. |
| `chunk_embeddings` | chunk_id, embedding_model, dimensions, vector, content_hash | Versioned embedding linked one-to-one to chunk/model. |
| `index_jobs` | id, document_id, kind, status, attempt, stage, error_code, started/finished_at | Durable parse/index/reindex work. |
| `knowledge_queries` | id, knowledge_base_id, user_id, question, status, answer, model, created_at | Durable grounded query record. |
| `citations` | id, query_id or agent_run_id, chunk_id, rank, score, quoted_excerpt, locator | Traceable answer-to-source link. Excerpt is bounded and derived from source. |
| `papers` | id, arxiv_id, version, title, abstract, authors_json, published_at, updated_at, canonical_url, pdf_url | Cached real arXiv metadata with unique arXiv ID/version. |
| `saved_papers` | paper_id, space_id, saved_by, saved_at | Space reading list. |
| `paper_comparisons` | id, space_id, created_by, scope, result, created_at | Saved comparison with explicit evidence scope. |
| `agent_definitions` | id, space_id/null, name, purpose, enabled, limits_json | User-visible agent purpose and execution limits. |
| `agent_definition_tools` | agent_id, tool_name | Allowlisted tools; no executable user code. |
| `agent_tasks` | id, space_id, agent_id, created_by, prompt, status, final_result, error_code | Durable requested task. |
| `agent_runs` | id, task_id, attempt, status, model, started/finished_at, step_count | One execution attempt. |
| `agent_run_steps` | id, run_id, sequence, kind, tool_name, safe_input_json, observation_json, status, duration_ms | Operational trace: model/tool decisions, calls, observations, errors—not hidden chain-of-thought. |
| `activity_events` | id, space_id/null, actor_id/null, type, subject_type/id, safe_metadata_json, created_at | Unified product activity. |

### Data invariants

- A chunk cannot exist without a document; an embedding cannot exist without its chunk.
- A citation references the exact persisted chunk and locator used for the answer/run.
- A document becomes `ready` only after parsing, chunk persistence, and all required embeddings commit successfully.
- Deleting a document removes or invalidates its chunks, embeddings, knowledge-base links, and future retrieval eligibility in one controlled workflow. Historical citations retain safe source metadata or are marked source-deleted according to the chosen retention policy.
- Reindex creates a new job and atomically replaces the active chunk/embedding version after success. A failed reindex leaves the last good index available.
- External paper results are cached only from real successful responses and retain source/version metadata.

## Persistence strategy

- Use PostgreSQL as the system of record.
- Use the `pgvector` extension for chunk vectors so relational metadata, authorization filters, and vector search stay in one database. A separate vector service is unnecessary for this scale.
- Use local filesystem storage under a non-public application data directory for development document binaries, behind a minimal `FileStore` interface. A future object-store adapter should not affect document services.
- Keep presence, socket connections, and short-lived backpressure counters in memory. They are ephemeral by definition.
- Persist job, indexing, message, agent-run, and activity state. Process restart must not turn incomplete work into success; stale `running` jobs are recovered to retryable/failed according to policy.

## REST API organization

Use `/api/v1`. Schemas live in shared contracts where safe, and responses use resource data plus a consistent error envelope: `{ error: { code, message, requestId, details? } }`. Never return raw provider bodies or stack traces.

| Area | Representative endpoints | Responsibility |
|---|---|---|
| System | `GET /health`, `GET /ready` | Process liveness and dependency readiness without secret disclosure. |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Session lifecycle. |
| Connections | `GET /connections`, `POST /connection-requests`, `PATCH /connection-requests/:id`, `DELETE /connections/:id` | Authenticated relationship CRUD. |
| Spaces | `GET/POST /spaces`, `GET/PATCH/DELETE /spaces/:id` | Research Space lifecycle. |
| Members | `GET /spaces/:id/members`, `POST /spaces/:id/invitations`, `DELETE /spaces/:id/members/:userId` | Simple membership policy. |
| Chat | `GET /spaces/:id/messages?cursor=...` | Cursor-paginated durable history. Sending is via WS; an authenticated REST send may be added only as a shared-service fallback. |
| Documents | `POST /spaces/:id/documents`, `GET /documents/:id`, `DELETE /documents/:id`, `POST /documents/:id/reindex` | Upload metadata/lifecycle, safe delete/reindex. |
| Knowledge bases | `GET/POST /spaces/:id/knowledge-bases`, `PATCH/DELETE /knowledge-bases/:id`, `PUT/DELETE /knowledge-bases/:id/documents/:documentId` | Retrieval scopes. |
| Knowledge query | `POST /knowledge-bases/:id/queries`, `GET /knowledge-queries/:id` | Grounded answer and citations. |
| Research | `GET /research/arxiv/papers?q=...`, `GET /research/papers/:id`, `POST /spaces/:id/saved-papers`, `POST /research/comparisons` | Real metadata search, save, and explicit-scope compare. |
| Summary | `POST /research/papers/:id/abstract-summary` | Clearly labelled abstract-only generation. |
| Agents | `GET/POST /spaces/:id/agents`, `GET/PATCH /agents/:id`, `POST /agents/:id/tasks`, `GET /agent-tasks/:id`, `GET /agent-runs/:id/steps` | Definitions, tasks, status, and trace. |
| Activity | `GET /spaces/:id/activity?cursor=...`, `GET /activity?cursor=...` | Authorized, cursor-paginated events. |

File upload accepts only PDF, Markdown, and TXT in the initial release. Enforce extension, MIME sniffing, maximum size, checksum, and safe generated storage key. Filenames never determine storage paths.

## WebSocket organization

### Responsibilities

WebSocket handles low-latency collaboration events: space subscribe/unsubscribe, message send/delivery, presence snapshots/deltas, and durable job/task status notifications. REST remains the recovery/read path after reconnect.

Do not add SSE while WebSocket already covers bidirectional collaboration and REST provides durable recovery reads.

### Event envelope

```json
{
  "version": 1,
  "eventId": "stable-id",
  "type": "chat.message.send",
  "requestId": "client-id-for-ack",
  "spaceId": "stable-space-id",
  "occurredAt": "server timestamp",
  "payload": {}
}
```

Client commands: `space.subscribe`, `space.unsubscribe`, `chat.message.send`, `presence.ping`.

Server events: `space.snapshot`, `chat.message.created`, `presence.updated`, `document.status.changed`, `agent.task.status.changed`, `space.access.revoked`, `ack`, and `error`.

The server ignores client-supplied actor fields. Subscription and each mutation check membership. `ChatService.sendMessage` persists first, then publishes the committed message. On reconnect, the client resubscribes and fetches missed durable data by cursor; it does not trust an unbounded in-memory replay.

## RAG boundary and pipeline

```text
Upload
→ DocumentService validates and stores binary/metadata
→ IndexJob claims work
→ ParserAdapter extracts text + locators
→ Chunker creates deterministic chunks
→ Metadata enricher associates document/version/page/section
→ EmbeddingService embeds content in bounded batches
→ Vector repository commits active index
→ RetrievalService applies authorization + KB filters + top-k
→ ContextBuilder enforces token budget and deduplicates evidence
→ LLMService generates only from provided context
→ CitationBuilder links claims to exact chunks/locators
→ Answer and citations persist together
```

### Independent services

- `DocumentService`: upload lifecycle, delete, reindex, status.
- `ParserAdapter`: PDF text extraction or plain Markdown/TXT reading. No OCR/layout/table promises.
- `ChunkingService`: deterministic chunk boundaries and overlap policy.
- `EmbeddingService`: server-configured model, batching, model/version metadata.
- `RetrievalService`: vector query plus knowledge-base/document filters and scoring.
- `ContextBuilder`: top-k selection, token budget, deduplication, safe citation labels.
- `LlmService`: provider call; does not fetch arbitrary URLs or choose authorization.
- `CitationService`: validates that every citation belongs to supplied retrieved context.

### Failure behavior

- **Indexing failure:** persist stage and safe error code; document status becomes `failed`, with retry. Partial new chunks are not made active.
- **No retrieval result:** return a successful query record with `answerStatus: no_evidence`, no invented answer, and suggestions to change scope/query.
- **Provider failure:** mark query failed/retryable; do not return a canned “grounded” answer.
- **Document deletion:** remove retrieval eligibility immediately, cancel queued jobs, delete file/index data according to retention policy, and mark historical source state clearly.
- **Reindex:** write a new version, then atomically switch active version. Failure retains the last good version.

## Agent boundary and execution

```text
User task
→ AgentService validates actor, scope, agent and limits
→ TaskRouter asks model for one allowed structured tool call or final answer
→ ToolRegistry validates tool name and arguments
→ Tool adapter calls an existing application service
→ Safe observation is recorded as an AgentRunStep
→ Router chooses next tool/final within step/time/token limits
→ Final result and citations persist
```

Initial tool mapping:

| Tool | Delegated service | Required output |
|---|---|---|
| `search_arxiv` | `ResearchService.searchArxiv` | Real paper metadata or typed upstream failure. |
| `search_knowledge_base` | `RetrievalService.retrieve` | Ranked authorized chunks with locators. |
| `summarize_document` | `DocumentService` + `RetrievalService` + `LlmService` | Grounded summary only for a ready indexed document, with citations. |
| `compare_papers` | `PaperComparisonService` | Comparison with explicit abstract/full-document evidence scope. |

Tools do not query tables directly and do not duplicate arXiv/RAG/comparison logic. The registry uses fixed server-defined schemas. A run has hard maximum steps, wall-clock timeout, token budget, per-tool timeout, cancellation, and retry rules. Status is durable (`queued`, `running`, `completed`, `failed`, `cancelled`). No timer may mark work complete.

The Execution Trace stores operational evidence: selected tool, validated/redacted arguments, observation summary, citations, error, duration, and status. It must not expose hidden chain-of-thought or secrets.

## arXiv boundary and academic integrity

- The server constructs a fixed arXiv endpoint and encoded query; the client cannot provide a base URL.
- Use a real XML parser, normalize identifiers/versions, and preserve canonical links.
- Apply timeouts, limited retries with backoff, response-size bounds, and a descriptive `upstream_unavailable` error.
- Empty real results return an empty list, not fallback papers.
- Cache only successfully sourced metadata with retrieval timestamp.
- `abstract-summary` sends title/authors/abstract and is labelled **Abstract-based Summary**.
- Full-document grounded analysis requires a successfully imported/indexed PDF and citations.

## Error handling and observability

- Central middleware maps typed errors to stable codes and appropriate HTTP status.
- Unexpected exceptions are logged with request ID and safe context; clients receive a generic message.
- Structured logs redact cookies, authorization headers, passwords, tokens, LLM inputs where sensitive, and retrieved document text by default.
- Activity events are product history, not debug logs. Security audit events are separate from user-facing activity where necessary.
- Key metrics are derived from real events (request latency, job duration/error count, WS connection count). Do not display a metric until it is measured.

## Security boundary checklist

- validated server-only environment configuration and safe `.env.example`;
- `.env` ignored; no secrets in frontend bundles, localStorage, traces, activity, logs, or errors;
- bcrypt-compatible password hashes and opaque cookie sessions;
- CSRF, same-origin/Origin checks, secure headers, body/file limits, and rate limits;
- shared schema validation for REST, WS, jobs, provider responses, and tool arguments;
- server-fixed/allowlisted external endpoints to prevent SSRF;
- authorization in services, not just UI/routes;
- safe filenames/storage keys, MIME inspection, checksums, and no OCR/executable parsing;
- output/citation validation and evidence-scope labels;
- dependency audit and secret scanning in CI after implementation begins.

## Technology and dependency recommendations

Continue React, TypeScript, Vite, Express, and `ws`. They match the current codebase, the product's needs, and an architecture that can be explained clearly. The value comes from clean boundaries and real behavior, not unnecessary framework changes.

Recommended additions when their phase begins:

- URL router for nested space/paper/run routes;
- server-state query/cache library;
- Zod-style runtime schemas shared across HTTP/WS/tool contracts;
- PostgreSQL driver plus a lightweight migration/query layer with transparent pgvector support;
- `pgvector` in PostgreSQL;
- bcrypt-compatible hashing library and opaque session implementation;
- XML parser for arXiv Atom;
- PDF text parser supporting text PDFs only;
- structured logger with redaction;
- unit/integration test runner, React testing tools, API integration testing, and one browser E2E runner.

Do not add Redux unless client state proves complex; do not add Redis, a message broker, a separate vector database, an agent framework, Kubernetes, Kafka, microservices, or a generic event-sourcing system. A database-backed job table plus one in-process worker is enough for the portfolio scale and survives process restarts honestly.
