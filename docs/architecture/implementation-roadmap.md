# ResearchWeave Implementation Roadmap

## Sequencing principle

ResearchWeave progresses from a secure engineering foundation through collaboration, real academic discovery, document indexing, grounded knowledge, and bounded agent orchestration. Every completed phase must represent verifiable behavior backed by durable state or a real external integration; fixtures and timers never stand in for product capability.

This roadmap records both shipped work and the acceptance gates for future phases. The current product has completed Phase 4. Phase 5 is next and has not started.

## Architecture & Product Definition — Completed

**Goal:** Define the product boundary, information architecture, security model, modular-monolith structure, evidence rules, and implementation sequence before feature delivery.

**Delivered**

- product and technical architecture for Collaboration, Research, Knowledge, Agents, and Activity
- Research Space as the primary authorization and collaboration boundary
- REST for durable resources and recovery; WebSocket for authenticated realtime deltas
- PostgreSQL/pgvector as the planned relational and vector system of record
- explicit separation between external paper metadata, imported documents, indexed knowledge, and generated results
- UI/UX, route, screen, component, responsive, and accessibility specifications

**Acceptance criteria met**

- Current and planned capabilities have explicit domain and authorization boundaries.
- Generated and compared results must disclose their evidence scope.
- The architecture remains one explainable modular monolith without premature distributed infrastructure.
- Future implementation phases have dependencies, risks, and testable completion gates.

## Phase 1 — Engineering Foundation — Completed

**Goal:** Establish a buildable, testable TypeScript foundation with safe configuration and durable persistence.

**Delivered**

- React/Vite client and Express composition/boot split
- shared runtime contracts and standardized error envelope
- validated server-only environment configuration and safe `.env.example`
- PostgreSQL/pgvector development setup and versioned migrations
- request IDs, structured/redacted logs, security headers, body limits, rate limits, and exact Origin checks
- lint, typecheck, test, build, and production-start commands

**Acceptance criteria met**

- Fresh setup builds and starts the frontend, backend, and database from documented commands.
- Invalid or missing environment values fail fast without printing secrets.
- Database migrations and integration tests run deterministically.
- Provider keys and authentication secrets remain outside browser bundles and local storage.
- Error responses use stable codes and request IDs without exposing stacks or provider output.

## Phase 2 — UI/UX & Design Specification — Completed

**Goal:** Define a coherent, responsive, accessible ResearchWeave interface before broad screen implementation.

**Delivered**

- evidence-led product experience and application-shell specification
- semantic color, typography, spacing, motion, layering, and component tokens
- canonical route hierarchy and URL-state rules
- implementation-ready screen states for loading, empty, error, permission, partial, and disconnected behavior
- responsive behavior from narrow mobile layouts through wide desktop views
- WCAG-oriented keyboard, focus, target-size, contrast, and reduced-motion requirements

**Acceptance criteria met**

- Research Space context remains visible across its detail routes.
- Future destinations stay out of runtime navigation until their behavior and APIs exist.
- UI states correspond to real domain or request state and never require fabricated data.
- Components and screens have explicit accessibility and responsive acceptance rules.

## Phase 3 — Authentication + Research Spaces — Completed

**Goal:** Deliver real identity and the Research Space authorization boundary used by later features.

**Delivered**

- registration, login, logout, and current-session restoration
- bcrypt password hashing and opaque server-side sessions in HttpOnly cookies
- protected routes, validated same-origin return paths, CSRF/Origin policy, and authenticated application shell
- Research Space create, list, detail, update, and delete
- transactional owner membership and membership-scoped reads
- owner-only update/delete authorization and safe not-found behavior for inaccessible spaces

**Acceptance criteria met**

- Password hashes and session-token hashes are never returned to clients.
- Refresh restores a valid cookie session without client-side authentication truth.
- Non-members cannot read or mutate another Research Space.
- Only owners can rename or delete a space.
- Deep links and unauthorized redirects behave predictably.

## Phase 4 — Collaboration, Members & Realtime Chat — Completed

**Goal:** Deliver a complete multi-user Research Space workflow with durable chat and honest realtime presence.

**Delivered**

- connection request, accept, reject, cancel, list, and removal workflows
- connection-based member admission, member listing, member leave, and owner removal
- PostgreSQL-backed cursor-paginated chat history
- cookie-authenticated, exact-Origin-validated WebSocket gateway
- authorized subscribe/unsubscribe, persist-before-broadcast chat, acknowledgements, and typed errors
- multi-tab-deduplicated presence, heartbeat, rate/payload/backpressure controls, bounded reconnect, resubscribe, and REST recovery
- immediate access revocation for member removal and Space deletion, including stale-authorization race protection

**Acceptance criteria met**

- A socket cannot subscribe or send outside authenticated membership.
- Actor identity comes from the authenticated session, never the payload.
- Messages are committed before broadcast or acknowledgement and survive process restart.
- Members receive space broadcasts while outsiders and removed members do not.
- Reconnect restores subscriptions and durable missed history without treating presence as membership truth.
- Connection transitions and membership authorization are enforced by server-side durable state.

## Phase 5 — Real Academic Discovery — Next

**Goal:** Implement trustworthy academic discovery using real arXiv metadata and a clear abstract-only evidence boundary.

**Scope**

- arXiv integration
- Paper Search
- Paper Detail
- Saved Papers scoped to a Research Space
- optional **Abstract-based Summary**

PDF ingestion, embeddings, RAG, agents, and Activity are not part of Phase 5.

**Main deliverables**

- server-fixed arXiv client with an XML parser, timeout, bounded retry, and response-size limit
- real search results with distinct empty, rate-limit, timeout, and upstream-error states
- normalized and cached paper metadata retaining canonical arXiv identifiers and versions
- Paper Search, Paper Detail, and Saved Papers routes
- authorized save/remove workflows scoped to Research Spaces
- optional server-configured summary generation using only title, authors, metadata, and abstract

**Main modules:** Research, arXiv integration, Saved Papers, and an optional minimal summary-provider adapter.

**Dependencies:** Phase 1 integration/error conventions; Phase 3 authentication and Research Space authorization; existing Phase 4 membership behavior for shared saved-paper access.

**Risks:** fabricated fallback pressure during demonstrations; Atom parsing/version errors; upstream limits and availability; overstating abstract-only output; provider cost or failure.

**Acceptance criteria**

- arXiv failure produces a typed non-success response and no fabricated papers.
- A successful zero-result query remains a real empty list.
- Every displayed paper retains its canonical arXiv identifier/version and source links.
- Saved-paper reads and mutations are authorized through Research Space membership.
- Summary input is demonstrably metadata/abstract only and the UI labels its output **Abstract-based Summary**.
- Missing or failed summary providers produce an actionable error rather than canned academic claims.

## Phase 6 — Document Ingestion & Indexing — Planned

**Goal:** Build a real, inspectable PDF/Markdown/TXT ingestion pipeline before any grounded-answer UI.

**Main deliverables**

- safe multipart upload, file validation, checksum, and development file storage
- document records with an explicit persisted status lifecycle
- text-PDF, Markdown, and TXT parser adapters
- deterministic chunking with stable locators
- bounded embedding batches and pgvector storage
- persistent index-job leasing, restart recovery, retry, delete, and reindex
- Documents and Knowledge Bases management pages with real stage and error states

**Main modules:** Documents, Knowledge Bases, Jobs, parser, embedding, and file integrations.

**Dependencies:** Phase 1 database and configuration foundation; Phase 3 spaces/auth; a server-configured embedding provider. Phase 5 is required only for importing a saved paper into the document workflow, not for direct file upload and indexing.

**Risks:** complex PDFs; partial index corruption; large input and provider cost; reindex duplication; path traversal; process restart during work.

**Acceptance criteria**

- Only PDF, Markdown, and TXT files within configured limits are accepted.
- A filename cannot control its storage path; checksum and metadata are persisted.
- A known fixture yields deterministic chunk order and locators.
- `ready` is reached only when active chunks and all required embeddings exist.
- Failed indexing exposes a safe stage/error and retry path; it never becomes ready.
- A failed reindex leaves the last good active index available.
- Deletion immediately removes future retrieval eligibility under a documented source-retention policy.
- OCR, scanned-document, and complex-layout limitations are explicitly reported.

## Phase 7 — Grounded Ask Knowledge & Citations — Planned

**Goal:** Complete evidence-first retrieval and grounded answers over authorized indexed documents.

**Main deliverables**

- authorized vector retrieval filtered by Research Space, knowledge base, and document
- top-k configuration, score handling, deduplication, and bounded context construction
- grounded provider prompt and server-side LLM adapter
- persisted query status, answer, and exact chunk citations
- Ask Knowledge UI with cited excerpts and source locators
- retrieval and groundedness evaluation fixtures

**Main modules:** Retrieval, Context Builder, LLM, Citations, and Knowledge Query.

**Dependencies:** successful Phase 6 indexes and the Phase 3/4 authorization boundary. It does not depend on Academic Discovery unless the queried documents originated from saved papers.

**Risks:** weak retrieval; unsupported claims; stale or deleted sources; prompt injection from documents; provider cost and latency.

**Acceptance criteria**

- Every answer citation references an authorized chunk supplied to the model.
- Retrieval filters prevent cross-space and cross-knowledge-base leakage.
- No-result retrieval returns `no_evidence` without an invented answer.
- Provider failure persists a failed/retryable query instead of a fake grounded response.
- Source links open the correct document and page/section locator where available.
- A small real-fixture evaluation reports retrieval hit rate and citation validity.

## Phase 8 — Tool-Calling Agent & Execution Trace — Planned

**Goal:** Orchestrate existing Research and Knowledge services through real, bounded tools with a durable execution trace.

**Main deliverables**

- agent definitions with purpose, allowlisted tools, and execution limits
- durable tasks, runs, steps, cancellation, and failure state
- structured tool registry with argument and result validation
- initial tools: `search_arxiv`, `search_knowledge_base`, `summarize_document`, and `compare_papers`
- bounded model/tool loop with maximum steps, wall time, tokens, and per-tool timeout
- Agents, Tasks, and Execution Trace UI
- final results and citations linked to observable tool execution

**Main modules:** Agents, Jobs, Research, Retrieval, Documents, and Comparison.

**Dependencies:** Phase 5 academic search, Phase 6 document readiness, Phase 7 grounded retrieval/citations, and a persistent job runner.

**Risks:** endless loops; tool authorization escape; malformed model output; duplicated business logic; sensitive data leakage in traces.

**Acceptance criteria**

- Every tool delegates to an existing application service rather than duplicating Research, retrieval, or document logic.
- Invalid or non-allowlisted tool calls are rejected and recorded safely.
- A completed run has a real final result and ordered tool/observation steps.
- Failed tools produce truthful failed or handled steps and run outcomes.
- Restart recovery never changes `running` to `completed` without executing work.
- Traces show operational evidence and timings without hidden chain-of-thought, credentials, or unrestricted document text.
- Integration tests cover successful multi-tool, no-evidence, provider-failure, and authorization-failure paths.

## Phase 9 — Integration, Evaluation & Portfolio Polish — Planned

**Goal:** Prove the complete product, remove misleading states, and prepare a concise, explainable demonstration.

**Main deliverables**

- Overview and unified Activity derived only from real queries and durable events
- evidence-scoped paper comparison using available abstract or indexed-document sources
- end-to-end tests for collaboration, discovery, ingestion, grounded knowledge, and agent workflows
- accessibility, responsive-layout, and error-state review
- authorization, CSRF, WebSocket Origin, rate-limit, upload, SSRF, and secret audits
- performance budgets and retrieval/groundedness evaluation report
- accurate setup, demo script, limitations, source behavior, and screenshots

**Main modules:** Cross-cutting integration and presentation; no new core infrastructure.

**Dependencies:** All prior phase acceptance gates.

**Risks:** decorative metrics replacing missing telemetry; polishing before correctness; obscuring known limitations; end-to-end flows that bypass real service boundaries.

**Acceptance criteria**

- The demonstration can trace: create space → collaborate → discover a real paper → save/import → index → cited answer → real agent trace.
- No fake fallback paper, random dashboard metric, timer-completed task, or uncited grounded answer exists.
- Security regression tests cover authentication, authorization, realtime, upload, external-integration, retrieval, and tool boundaries.
- Documentation clearly distinguishes implemented, planned, and excluded capabilities.
- The architecture can be explained as one modular monolith with REST, WebSocket, PostgreSQL/pgvector, persistent jobs, service-backed retrieval, and service-backed tools.

## Implementation order at a glance

```text
Architecture & Product Definition ✓
→ Engineering Foundation ✓
→ UI/UX & Design Specification ✓
→ Authentication + Research Spaces ✓
→ Collaboration, Members & Realtime Chat ✓
→ Real Academic Discovery (next)
→ Document Ingestion & Indexing
→ Grounded Ask Knowledge & Citations
→ Tool-Calling Agent & Execution Trace
→ Integration, Evaluation & Portfolio Polish
```

Do not begin PDF ingestion, embeddings, RAG, agents, or Activity as part of Phase 5. Do not begin the agent runtime before its Research and Knowledge tools are real and tested.
