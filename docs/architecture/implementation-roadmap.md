# ResearchWeave Implementation Roadmap

## Sequencing principle

ResearchWeave progresses from a secure engineering foundation through collaboration, real academic discovery, durable document indexing, grounded knowledge, integrated workflows, and bounded agent orchestration. Every completed phase must represent verifiable behavior backed by durable state or a real external integration; fixtures and timers never stand in for product capability.

The product capability baseline is complete through **Phase 8B**. Phase 8C aligns the public repository and automated quality gates with that shipped state. **Phase 9 — Tool-Calling Agent & Execution Trace** is the next product phase and has not started.

## Architecture & Product Definition — Completed

**Goal:** Define the product boundary, information architecture, security model, modular-monolith structure, evidence rules, and implementation sequence before feature delivery.

**Delivered**

- product and technical architecture for Collaboration, Research, Knowledge, Agents, and Activity
- Research Space as the primary authorization and collaboration boundary
- REST for durable resources and recovery; WebSocket for authenticated realtime deltas
- PostgreSQL/pgvector as the relational and vector system of record
- explicit separation between external paper metadata, imported documents, indexed knowledge, and generated results
- UI/UX, route, screen, component, responsive, and accessibility specifications

## Phase 1 — Engineering Foundation — Completed

**Goal:** Establish a buildable, testable TypeScript foundation with safe configuration and durable persistence.

**Delivered**

- React/Vite client and Express composition/boot split
- shared runtime contracts and a standardized error envelope
- validated server-only configuration and safe `.env.example`
- PostgreSQL/pgvector development setup and versioned migrations
- request IDs, structured/redacted logs, security headers, body limits, rate limits, and exact Origin checks
- lint, typecheck, test, build, and production-start commands

**Acceptance criteria met**

- Fresh setup builds and starts the frontend, backend, and database from documented commands.
- Invalid or missing environment values fail fast without printing secrets.
- Provider keys and authentication secrets remain outside browser bundles and local storage.
- Error responses use stable codes and request IDs without exposing stacks or provider output.

## Phase 2 — UI/UX & Design Specification — Completed

**Goal:** Define a coherent, responsive, accessible ResearchWeave interface before broad screen implementation.

**Delivered**

- evidence-led product experience and application-shell specification
- semantic color, typography, spacing, motion, layering, and component tokens
- route hierarchy and URL-state rules
- screen states for loading, empty, error, permission, partial, and disconnected behavior
- responsive and WCAG-oriented keyboard, focus, target-size, contrast, and reduced-motion requirements

## Phase 3 — Authentication + Research Spaces — Completed

**Goal:** Deliver real identity and the Research Space authorization boundary used by later features.

**Delivered**

- registration, login, logout, and current-session restoration
- bcrypt password hashing and opaque server-side sessions in HttpOnly cookies
- protected routes, validated same-origin return paths, CSRF/Origin policy, and authenticated application shell
- Research Space create, list, detail, update, and delete
- transactional owner membership, membership-scoped reads, and owner-only lifecycle authorization

**Acceptance criteria met**

- Password hashes and session-token hashes are never returned to clients.
- Non-members cannot read or mutate another Research Space.
- Deep links and authentication redirects behave predictably.

## Phase 4 — Collaboration, Members & Realtime Chat — Completed

**Goal:** Deliver a complete multi-user Research Space workflow with durable chat and honest realtime presence.

**Delivered**

- connection request, accept, reject, cancel, list, and removal workflows
- connection-based member admission, member listing, member leave, and owner removal
- PostgreSQL-backed cursor-paginated chat history
- cookie-authenticated, exact-Origin-validated WebSocket gateway
- persist-before-broadcast chat, acknowledgements, typed errors, heartbeat, bounded reconnect, resubscribe, and REST recovery
- immediate access revocation for member removal and Space deletion

**Acceptance criteria met**

- A socket cannot subscribe or send outside current authenticated membership.
- Messages are committed before broadcast or acknowledgement and survive restart.
- Reconnect restores subscriptions and durable missed history without treating presence as membership truth.

## Phase 5 — Real Academic Discovery — Completed

**Goal:** Deliver trustworthy academic discovery using real arXiv metadata and an explicit abstract-only evidence boundary.

**Delivered**

- server-fixed arXiv client with XML parsing, timeout, bounded retry, response-size limits, and caching
- real paper search with distinct empty and upstream-failure states
- normalized paper metadata retaining canonical and versioned arXiv identifiers and source links
- Research Search, Paper Detail, and Space-scoped Saved Papers workflows
- optional OpenAI-compatible summary generation restricted to title, metadata, authors, and abstract

**Acceptance criteria met**

- arXiv failure produces a typed non-success response and no fabricated papers.
- Saved-paper reads and mutations are authorized through current Space membership.
- Generated output is labelled **Abstract-based Summary** and cannot imply full-text evidence.
- Missing or failed summary providers return actionable errors rather than canned academic claims.

## Phase 6 — Document Ingestion & Durable Indexing — Completed

**Goal:** Build a real, inspectable PDF, Markdown, and TXT ingestion pipeline before exposing grounded answers.

**Delivered**

- bounded multipart upload, source validation, checksums, and server-local durable file storage
- explicit queued, processing, ready, and failed document lifecycle
- PDF, Markdown, and TXT text extraction adapters
- deterministic chunking with stable source locators
- OpenAI-compatible embedding adapter and pgvector persistence
- persistent worker claiming, restart recovery, reindex, delete, and safe failure handling
- Space-scoped Knowledge UI with real progress and error states

**Acceptance criteria met**

- Filenames cannot control storage paths and duplicate source handling is deterministic.
- `ready` is reached only when the active chunks and compatible embeddings exist.
- Failed reindexing does not replace the last good active index.
- Deletion immediately removes future retrieval eligibility.
- Dedicated PostgreSQL 17/pgvector smoke coverage validates migrations, vector dimensions, worker claims, atomic replacement, reindex, and recovery.

## Phase 7 — Semantic Retrieval & Grounded Knowledge — Completed

**Goal:** Deliver evidence-first retrieval and grounded answers over authorized indexed documents.

**Delivered**

- Space-authorized pgvector retrieval over compatible active document indexes
- bounded query embedding, result limits, deterministic ranking, and exact source locators
- OpenAI-compatible grounded-answer adapter with bounded context construction
- Ask Knowledge UI with cited excerpts and explicit insufficient-context behavior
- typed provider, compatibility, no-index, and authorization errors

**Acceptance criteria met**

- Retrieval filters prevent cross-Space leakage and reject incompatible embedding spaces.
- Every answer citation references an authorized chunk supplied to the model.
- No-evidence requests return insufficient context without an invented answer.
- Provider failures remain truthful failures rather than fallback answers.
- Dedicated PostgreSQL 17/pgvector smoke coverage validates production migrations, ranking, filtering, limits, compatibility, and authorization.

## Phase 8A — Integrated Research Workspace — Completed

**Goal:** Connect shipped Research, Saved Papers, Spaces, and Knowledge capabilities into coherent product workflows.

**Delivered**

- stable primary navigation for Research, Spaces, and Connections
- Space-local navigation for Overview, Chat, Saved Papers, Knowledge, Members, and Settings
- explicit Research-to-Saved-Papers continuation with Space selection
- explicit Saved-Paper-to-Knowledge continuation without claiming automatic full-text import
- Space overview summaries and truthful next actions derived from real domain state
- preserved search, filter, and return-path state across workflow transitions

## Phase 8B — Product UX Refinement & Accessibility — Completed

**Goal:** Refine the integrated workspace across screen sizes and close the final presentation and accessibility validation findings.

**Delivered**

- improved navigation hierarchy and workspace presentation
- responsive desktop, tablet, and mobile layouts
- reusable loading, empty, error, status, and action presentation primitives
- keyboard and focus refinements for navigation and workflows
- accessible realtime announcements and clearer asynchronous status messaging
- regression coverage for navigation, workflow state, knowledge composition, and presentation behavior

**Acceptance criteria met**

- Phase 8B accessibility final validation passed.
- P8B-V-m04 and P8B-V-m05 were closed.
- lint, typecheck, automated tests, production build, and diff checks passed at release closure.

## Phase 8C — Release Alignment & Automated Gates — Completed with v0.8.1

**Goal:** Align the public repository, release metadata, and continuous-integration gates with the Phase 8B implementation baseline.

**Delivered**

- README and route documentation updated to distinguish shipped and future capabilities
- roadmap reconciled with the actual Phase 5–8 delivery history
- package and changelog version alignment
- Node 22 CI for lint, typecheck, automated tests, and production build
- isolated PostgreSQL 17/pgvector CI jobs for the Phase 6 and Phase 7A smoke suites

Phase 8C changes repository documentation and delivery automation only. It does not add Agent behavior or change runtime APIs, database schemas, authorization, or realtime architecture.

## Phase 9 — Tool-Calling Agent & Execution Trace — Next

**Goal:** Orchestrate existing Research and Knowledge services through real, bounded tools with a durable execution trace.

**Planned deliverables**

- Space-authorized Agent definitions, durable tasks, runs, ordered steps, cancellation, and truthful failure state
- a structured allowlisted tool registry whose tools delegate to existing application services
- an OpenAI-compatible structured tool-calling adapter with validated arguments and results
- bounded execution by steps, wall time, provider output, per-tool timeout, and cancellation checks
- Agent Tasks and Execution Trace UI backed only by durable execution state

The initial tools must wrap capabilities that already exist and are tested. `search_arxiv`, `search_knowledge_base`, and grounded knowledge answering are eligible. Document summarization and paper comparison remain excluded until dedicated services exist; Agent code must not duplicate those domains.

**Acceptance criteria**

- Every tool revalidates current Space authorization and delegates to an existing service.
- Invalid or non-allowlisted calls are rejected and recorded safely.
- A completed run contains a real final result and ordered, inspectable tool observations.
- Recovery never changes `running` to `completed` without performing the work.
- Traces exclude chain-of-thought, credentials, unrestricted document text, and raw provider payloads.
- Integration tests cover success, no evidence, provider failure, cancellation, recovery, and authorization failure.

## Phase 10 — Integration, Evaluation & Portfolio Polish — Planned

**Goal:** Prove the complete product, remove misleading states, and prepare a concise, explainable demonstration.

**Planned deliverables**

- Overview and unified Activity derived only from real queries and durable events
- evidence-scoped paper comparison backed by a dedicated service
- browser end-to-end tests for collaboration, discovery, ingestion, grounded knowledge, and Agent workflows
- automated and manual accessibility, responsive-layout, security, and error-state review
- authorization, CSRF, WebSocket Origin, upload, external-integration, retrieval, and tool-boundary audits
- performance budgets, retrieval/groundedness evaluation, accurate setup instructions, demo script, limitations, and screenshots

**Acceptance criteria**

- The demonstration can trace create Space → collaborate → discover a real paper → save/import → index → cited answer → real Agent trace.
- No fake fallback paper, random metric, timer-completed task, or uncited grounded answer exists.
- Documentation clearly distinguishes implemented, planned, and excluded capabilities.

## Implementation order at a glance

```text
Architecture & Product Definition ✓
→ Engineering Foundation ✓
→ UI/UX & Design Specification ✓
→ Authentication + Research Spaces ✓
→ Collaboration, Members & Realtime Chat ✓
→ Real Academic Discovery ✓
→ Document Ingestion & Durable Indexing ✓
→ Semantic Retrieval & Grounded Knowledge ✓
→ Integrated Research Workspace ✓
→ Product UX Refinement & Accessibility ✓
→ Release Alignment & Automated Gates ✓
→ Tool-Calling Agent & Execution Trace (next)
→ Integration, Evaluation & Portfolio Polish
```

Do not begin Agent implementation as part of Phase 8C. Do not add Activity or comparison presentation until their durable service boundaries exist.
