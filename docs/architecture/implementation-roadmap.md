# ResearchWeave Implementation Roadmap

## Sequencing principle

Build a stable vertical foundation, then one real collaboration workflow, then academic discovery, then grounded knowledge, and only then agent orchestration. Each phase must produce verifiable behavior and may not be represented as complete by fixtures or timers.

This document plans future work only. No phase below is implemented in the current architecture turn.

## Phase 0 — Repository and security baseline

**Goal:** Establish a buildable, testable TypeScript foundation with safe configuration before product features.

**Main deliverables**

- React/Vite app shell and Express composition/boot split
- shared runtime contracts and standardized error envelope
- validated server-only environment configuration and safe `.env.example`
- PostgreSQL/pgvector development setup and first migrations
- request IDs, structured/redacted logs, security headers, body limits
- test, lint, format, build, and secret-scan commands

**Main modules:** `src/app`, `server/config`, `server/middleware`, `server/db`, `shared/contracts`, test harness.

**Dependencies:** none beyond architecture approval and immediate revocation/rotation of the exposed legacy credential.

**Risks:** spending time on generic abstractions; leaking old secrets into new examples; pgvector environment friction.

**Acceptance criteria**

- Fresh setup builds and starts frontend/backend/database from documented commands.
- Invalid/missing environment variables fail fast without printing secret values.
- A database migration and integration test run deterministically.
- No provider key or authentication secret appears in the browser bundle or localStorage.
- Error responses contain stable code and request ID, not stack/provider output.

## Phase 1 — Authentication, Spaces, and Activity foundation

**Goal:** Create real identity and the Research Space authorization boundary used by every later feature.

**Main deliverables**

- registration, login, logout, current-user session
- bcrypt-compatible password hashing and opaque HttpOnly cookie sessions
- CSRF/same-origin policy and authenticated WebSocket upgrade skeleton
- Research Space create/list/detail/update/delete
- owner/member membership model and invitations
- unified activity-event writer and basic authorized activity list
- frontend URL routing, app layout, auth guards, conventional sidebar

**Main modules:** Auth, Spaces, Activity, app router/layout.

**Dependencies:** Phase 0 database, contracts, middleware.

**Risks:** authorization only in routes; overbuilding RBAC; session/CSRF mistakes.

**Acceptance criteria**

- Stored password values are hashes and never returned.
- Refresh restores a valid cookie session without localStorage authentication state.
- A non-member receives a consistent forbidden response for another space.
- Only an owner can perform owner-only membership/space actions.
- Space mutations create accurate, non-sensitive activity events.
- Route deep links and unauthorized redirects behave predictably.

## Phase 2 — Connections and real-time collaboration

**Goal:** Deliver one complete multi-user Research Space workflow with durable chat and honest presence.

**Main deliverables**

- connection request/list/accept/reject/delete
- space invitation/member management
- durable cursor-paginated chat history
- authenticated WebSocket subscribe/unsubscribe and chat send
- room-scoped message broadcast, presence, reconnect/resubscribe, access-revoked handling
- shared `ChatService` used by realtime adapter and any REST fallback

**Main modules:** Connections, Chat, Spaces, Realtime.

**Dependencies:** Phase 1 identity, membership, activity.

**Risks:** impersonation via payload fields; duplicate messages on reconnect; lost messages; REST/WS divergence.

**Acceptance criteria**

- A socket cannot subscribe/send outside authenticated membership.
- Actor identity always comes from the session, never payload.
- A committed message has one stable ID and survives process restart.
- Two clients in one space receive the message; an outsider does not.
- Reconnect restores subscription and missed history without duplicates.
- Presence disappears after close/heartbeat timeout and is never presented as durable truth.
- Connection state transitions are transactional and unique per user pair.

## Phase 3 — Real academic discovery

**Goal:** Implement trustworthy arXiv search and the precise boundary between metadata, abstract summary, and imported full text.

**Main deliverables**

- server-fixed arXiv client with XML parser, timeout, bounded retry, response limit
- real search, empty, rate/upstream error states
- normalized/cached paper metadata and saved papers per space
- Paper Search, Paper Detail, Saved Papers routes
- optional **Abstract-based Summary** using server-configured LLM
- comparison of metadata/abstract evidence with explicit scope label

**Main modules:** Research, arXiv integration, LLM adapter (minimal), Activity.

**Dependencies:** Phase 1 spaces/auth; Phase 0 external-integration/error conventions.

**Risks:** fabricated fallback pressure during demos; Atom parsing/version errors; overstating abstract output; provider cost/failure.

**Acceptance criteria**

- arXiv failure produces a non-success typed error and no papers.
- Empty results remain a real empty list.
- Every displayed paper retains canonical arXiv ID/version and links.
- Summary request input is demonstrably metadata/abstract only and UI labels it accordingly.
- Provider absence/failure yields an actionable error, not canned academic claims.
- Saved paper authorization is scoped to the Research Space.

## Phase 4 — Document ingestion and indexing

**Goal:** Build a real, inspectable PDF/Markdown/TXT ingestion pipeline before any RAG answer UI.

**Main deliverables**

- safe multipart upload, file validation, checksum, dev file storage
- document records and explicit status lifecycle
- text-PDF, Markdown, and TXT parser adapters
- deterministic chunking and locators
- embedding batches and pgvector storage
- persistent index-job leasing, restart recovery, retry, delete, reindex
- Documents and Knowledge Bases management pages with real stage/error states

**Main modules:** Documents, Knowledge Bases, Jobs, parser/embedding/file integrations.

**Dependencies:** Phase 0 database/jobs foundation, Phase 1 spaces/auth, server-configured embedding provider.

**Risks:** complex PDFs; partial index corruption; large input/cost; reindex duplication; path traversal; process restart.

**Acceptance criteria**

- Only PDF, Markdown, and TXT within configured limits are accepted.
- File name cannot control storage path; checksum and metadata are persisted.
- A known fixture yields deterministic chunk order and locators.
- `ready` is reached only when active chunks and all embeddings exist.
- Failed indexing exposes safe stage/error and retry; it never becomes ready.
- A failed reindex leaves the last good active index available.
- Deletion removes future retrieval eligibility and follows documented provenance policy.
- OCR/scanned/complex-layout limitations are explicitly reported, not hidden.

## Phase 5 — Grounded Ask Knowledge and citations

**Goal:** Complete the real RAG pipeline with evidence-first answers.

**Main deliverables**

- authorized vector retrieval filtered by knowledge base/document
- top-k configuration, score handling, deduplication, context budget
- grounded LLM prompt and provider adapter
- persisted knowledge query, answer status, and exact chunk citations
- Ask Knowledge UI with cited excerpts/source locators
- retrieval and groundedness evaluation fixtures

**Main modules:** Retrieval, Context Builder, LLM, Citations, Knowledge Query.

**Dependencies:** successful Phase 4 indexes and Phase 3 minimal LLM adapter.

**Risks:** weak retrieval; unsupported claims; stale/deleted sources; prompt injection from documents; cost/latency.

**Acceptance criteria**

- Every answer citation references a chunk supplied to the model and authorized for the user.
- No-result retrieval returns `no_evidence` with no invented answer.
- Provider failure persists a failed/retryable query rather than a fake answer.
- Source links open the correct document and page/section locator where available.
- Retrieval tests verify filters prevent cross-space leakage.
- A small evaluation set reports retrieval hit rate and citation validity from real fixtures, not random metrics.

## Phase 6 — Real tool-calling agent and execution trace

**Goal:** Orchestrate existing services through four real tools with durable, bounded execution.

**Main deliverables**

- agent definitions with purpose, allowlisted tools, and limits
- durable tasks/runs/steps and cancellation/failure state
- structured tool registry and argument/result validation
- initial tools: `search_arxiv`, `search_knowledge_base`, `summarize_document`, `compare_papers`
- bounded model/tool loop with max steps/time/tokens and per-tool timeout
- Agents, Tasks, and Execution Trace UI
- final results/citations and task/activity integration

**Main modules:** Agents, Jobs, Research, Retrieval, Documents, Comparison, Activity.

**Dependencies:** Phases 3 and 5 real services; Phase 4 document readiness; persistent job runner.

**Risks:** endless loops; tool authorization escape; malformed model output; duplicated business logic; secret/raw-content leakage in traces.

**Acceptance criteria**

- Each tool delegates to its existing service; no duplicate arXiv/RAG/document implementation exists under Agents.
- Invalid or non-allowlisted tool calls are rejected and recorded safely.
- A completed run has a real final result and ordered tool/observation steps.
- A failed tool produces a failed/handled step and truthful run outcome.
- Restart recovery never changes `running` to `completed` without work.
- Trace shows operational evidence and timings but not hidden chain-of-thought, credentials, or unrestricted document text.
- Integration tests cover at least one successful multi-tool run, no-evidence run, provider failure, and authorization failure.

## Phase 7 — Integration, evaluation, and portfolio polish

**Goal:** Prove the end-to-end product, remove misleading states, and prepare an explainable portfolio demonstration.

**Main deliverables**

- Overview derived from real queries/activity only
- full end-to-end tests for collaboration, import/RAG, and agent workflow
- accessibility/responsive/error-state review
- rate-limit, authorization, CSRF, WebSocket-origin, file-upload, SSRF, and secret audit
- performance budgets and grounded/retrieval evaluation report
- architecture decision records only for material deviations
- accurate setup, demo script, limitations, provenance, and screenshots

**Main modules:** cross-cutting; no new core domain.

**Dependencies:** all prior acceptance gates.

**Risks:** replacing missing telemetry with decorative metrics; polishing before correctness; hiding known limitations.

**Acceptance criteria**

- The portfolio demo can trace: create space → collaborate → real arXiv result → import → index → cited answer → real agent trace.
- No fake fallback paper, random dashboard metric, timer-completed task, or uncited “grounded” answer exists.
- Security regression tests cover the legacy critical findings.
- Documentation distinguishes implemented, planned, and excluded capabilities.
- The architecture can be explained as one modular monolith with REST, WebSocket, PostgreSQL/pgvector, persistent jobs, service-backed RAG, and service-backed tools in 15–20 minutes.

## Recommended implementation order at a glance

```text
Security/build/database foundation
→ Identity + Research Space boundary
→ Connections + durable real-time Chat
→ Trustworthy arXiv discovery + abstract-only summaries
→ Document ingestion/indexing
→ Grounded Ask Knowledge + citations
→ Tool-calling Agent + execution trace
→ Integration, evaluation, and portfolio polish
```

Do not start Phase 1 until the architecture documents are reviewed. Do not start the Agent UI/runtime before its underlying Research and Knowledge tools are real and tested.
