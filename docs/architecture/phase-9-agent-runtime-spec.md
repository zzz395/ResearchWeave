# Phase 9 Agent Runtime Architecture Specification

## Status

- Review stage: **Architecture Freeze complete**
- Baseline reviewed: `v0.8.1` / `4e4fb6d`
- Freeze accepted: **2026-09-03**
- Phase 9 implementation status: **COMPLETE**
- Phase 9C-7 implementation status: **COMPLETE**
- Source / Architecture Review: **COMPLETE**
- Findings closure: **COMPLETE**
- Final checkpoint: **PASS**
- Release closure: **COMPLETE**
- Package version: **0.9.0**
- `v0.9.0` tag: **CREATED**
- Architecture freeze: **PASS**

This document is the frozen Phase 9 design. It records the decisions that govern the Agent migration, API, worker, tool registry, provider adapter, and UI implementation.

Where this document conflicts with the early Agent sketch in `technical-architecture.md`, this Phase 9 specification is the governing implementation record. In particular, `summarize_document` and `compare_papers` are not Phase 9 tools because no dedicated application services currently implement those capabilities.

## 1. Review scope and evidence

The review covered the current implementation boundaries rather than relying only on roadmap descriptions:

- `ResearchService`, arXiv client, cache, scheduler, and abstract-summary provider;
- `SemanticRetrievalService` and its PostgreSQL/pgvector repository;
- `GroundedAnswerService` and its OpenAI-compatible provider adapter;
- document upload, repository, indexing worker, recovery, and atomic index activation;
- Research Space membership checks and realtime revocation behavior;
- Drizzle schema and migration conventions;
- shared Zod contracts, REST composition, error envelopes, and existing Agent route specifications.

The repository was clean at review time. `main`, `origin/main`, and `v0.8.1` all resolved to the Phase 8C merge commit `4e4fb6d`.

## 2. Findings from the current architecture

### 2.1 Reusable application capabilities

| Capability | Current application boundary | Phase 9 use |
|---|---|---|
| Real arXiv search | `ResearchService.searchPapers` | Wrap as `search_arxiv`. |
| Authorized semantic retrieval | `SemanticRetrievalService.retrieve` | Wrap as `search_knowledge_base`. |
| Authorized grounded answer | `GroundedAnswerService.answerWithSources` | Wrap as `ask_knowledge`. |

The Agent runtime must call these interfaces. It must not call their repositories, provider adapters, pgvector, or arXiv directly.

### 2.2 Authorization behavior to preserve

- Space membership is the authorization boundary.
- Protected services receive a server-derived actor ID.
- Unauthorized Space access is generally hidden as `404 space_not_found`.
- Retrieval checks membership before embedding and again inside the repository transaction after embedding.
- Grounded answering rechecks membership before releasing a generated result.
- Member removal and Space deletion immediately revoke realtime access.

Agent execution is longer-lived than an HTTP request, so authorization at task creation is insufficient. Current membership must be revalidated during execution and before any generated observation or final result is committed.

### 2.3 Worker behavior that can and cannot be reused

The document worker provides useful local conventions:

- PostgreSQL is the queue and source of truth;
- a row is claimed with `FOR UPDATE SKIP LOCKED`;
- an attempt number fences stale writes;
- state is persisted at stage boundaries;
- final activation is conditional and transactional;
- restart recovery never invents success.

Its recovery mechanism is not sufficient for Agent runs. It requeues every `processing` document at process startup and has no lease, heartbeat, cancellation flag, or wall-clock deadline. Agent execution therefore needs an Agent-specific lease protocol. This is not a new generic distributed-job framework and does not change document indexing.

### 2.4 Provider conventions to preserve

Existing provider adapters already establish the required pattern:

- server-only base URL, key, and model configuration;
- fixed provider endpoint construction;
- `AbortController` timeouts;
- at most two attempts for explicitly transient failures;
- bounded response reading;
- strict runtime validation of provider envelopes and generated JSON;
- stable safe error codes with provider bodies discarded;
- no credentials, raw provider payloads, or sensitive context in logs.

The Agent provider adapter must follow the same pattern and add strict validation of structured tool calls.

## 3. Architectural boundary

```text
Authenticated REST request
  -> AgentService (task/run commands and authorized reads)
  -> AgentRepository (durable task/run/step state)

AgentWorker
  -> AgentRunExecutor (bounded loop)
  -> AgentDecisionProvider (one structured action per turn)
  -> AgentToolRegistry (fixed allowlist and Zod validation)
  -> Tool adapter
  -> Existing application service
  -> bounded observation/evidence persisted before the next decision
```

The Agent module owns orchestration only:

- task, run, lease, cancellation, step, evidence, and final-result state;
- the bounded decision loop;
- tool registration and argument/result normalization;
- execution policy and trace safety.

It does not own academic search, retrieval, embeddings, document processing, grounded answering, membership, or realtime transport.

The runtime is an application module in the existing TypeScript modular monolith. It is composed in `server/index.ts`, served through Express, and backed by PostgreSQL. No LangChain, LangGraph, Redis, Kafka, microservice, user-supplied code, or standalone Agent framework is introduced.

## 4. Agent definition scope

Phase 9 v1 provides one neutral, system-managed Research Agent definition. It is a real executable configuration, not a persona:

- name and purpose;
- enabled state;
- fixed allowed-tool set;
- fixed execution-limit profile;
- system prompt version;
- monotonically increasing revision.

The definition is durable and may be globally reusable (`space_id = null`), while every task and run is bound to exactly one Research Space. A run snapshots the definition revision, available tools, limits, prompt version, and provider model so later definition changes cannot rewrite historical meaning.

Custom Agent creation, arbitrary system prompts, avatars, personas, and user-defined tools are non-goals for v1. Consequently, no create/edit Agent endpoint or UI action is included in the initial implementation.

## 5. Task, run, step, and evidence model

### 5.1 Task

An Agent Task is immutable user intent:

- selected Research Space and Agent definition;
- creator;
- bounded prompt;
- creation idempotency key and request fingerprint;
- creation timestamp.

A task does not duplicate mutable execution status. Its API `status` is the status of its latest run. This avoids task/run status divergence.

### 5.2 Run

An Agent Run is one user-visible execution attempt for a task. Retrying a task always creates a new run; it never resets or overwrites an earlier run.

Run states:

```text
queued -> running -> completed
   |         |  \-> failed
   |         \----> cancelled
   \--------------> cancelled
```

Rules:

- `queued -> running` occurs only through an atomic worker claim.
- `completed` requires a validated final action and a durably stored final result.
- `failed` requires a stable safe error code.
- `cancelled` requires a cancellation request or queued cancellation command.
- terminal states are immutable.
- an expired lease does not make a run terminal and never makes it complete.
- `cancel_requested_at` is orthogonal to status. A running run remains `running` with `cancelRequested: true` until the worker reaches a cancellation boundary and commits `cancelled`.

The first claim sets `started_at` and an immutable `deadline_at`. Recovery does not extend the deadline.

### 5.3 Step

A step is one observable loop action, not hidden reasoning. Step kinds are:

- `tool_call`: a validated call to an allowlisted tool;
- `final_answer`: the validated terminal action;
- `decision_error`: a provider decision that could not be parsed or validated.

Step states are `running`, `completed`, `failed`, and `cancelled`. Sequence numbers are unique and strictly increasing within a run. A completed run must have exactly one completed final-answer step and no later steps.

The runtime persists a tool step and its validated arguments before calling the tool. It persists the bounded observation before asking the model for another decision. A recovered incomplete step may be re-executed only because every v1 tool is read-only from the Agent's perspective. Its execution count is incremented and the same logical step is retained.

Future mutating tools are prohibited until they define a durable idempotency key, side-effect reconciliation, and a specific authorization policy.

### 5.4 Evidence

Evidence is normalized separately from free-form observations and receives run-local identifiers (`E1`, `E2`, ...). Evidence kinds are:

- `arxiv_abstract`: paper identity, source version, canonical URL, and a bounded abstract excerpt;
- `knowledge_chunk`: document identity snapshot, content hash, locator, and a bounded excerpt.

`ask_knowledge` converts its existing grounded citations into run evidence. Final answers may cite only evidence IDs already produced by completed tool steps. Deleted sources retain safe citation snapshots but are marked unavailable when resolved.

## 6. Claiming, leasing, cancellation, retry, and recovery

### 6.1 Claim protocol

An Agent worker uses one short transaction to:

1. select the oldest eligible queued run, or an expired running run, using `FOR UPDATE SKIP LOCKED`;
2. verify that the run actor still has current Space membership;
3. set/retain `running`, increment `lease_generation`, and assign a random worker ID;
4. set `lease_expires_at` and initialize `started_at`/`deadline_at` when absent;
5. return the run snapshot and fencing generation.

Recommended v1 timings:

- idle poll: 2 seconds;
- lease duration: 60 seconds;
- heartbeat: every 15 seconds and at every persisted boundary.

Every worker write is conditional on `run_id`, `status = running`, `lease_owner_id`, and `lease_generation`. An old worker that outlives its lease can finish local work but cannot publish a step observation or terminal result.

### 6.2 Cancellation

- Cancelling a queued run atomically sets `cancelled`.
- Cancelling a running run sets `cancel_requested_at` and `cancel_requested_by_user_id` idempotently.
- The worker checks cancellation before every provider call, before and after every tool call, at every heartbeat, and before final persistence.
- The executor supplies an `AbortSignal` to the Agent provider and tool deadline wrapper.
- Existing service calls that cannot yet consume a signal may finish in the background, but their result is discarded after cancellation or fencing loss. V1 tools do not perform Agent-visible mutations.
- Cancellation is successful only after durable `cancelled` state; an HTTP response never claims that active work has already stopped when it has only been requested.

### 6.3 Retry policy

- Transient provider HTTP failures may receive one adapter-level retry within the same step and wall-clock budget.
- Existing service/provider retry behavior remains authoritative inside each tool.
- Invalid structured output, unknown tools, invalid arguments, authorization loss, and exhausted limits are not automatically retried as new runs.
- A user retry is a new run with the next task attempt number and a fresh actor/configuration snapshot.
- Creating a task or retry run is idempotent through a client-generated UUID plus a server-computed request fingerprint. Reuse with different content returns a conflict.

### 6.4 Recovery

On lease expiry, another worker reclaims the same run with a higher fencing generation:

- completed steps remain immutable;
- no in-progress provider decision is assumed to have succeeded;
- an incomplete persisted tool step is safely re-executed and its execution count is incremented;
- the next provider context is rebuilt from the task prompt plus completed, bounded step observations;
- the original wall-clock deadline remains in force;
- a run past its deadline becomes `failed` with `agent_wall_time_exceeded` unless cancellation was already requested, in which case it becomes `cancelled`.

Startup performs no unconditional bulk rewrite of running rows. Eligibility is based on lease expiry, so multiple application instances cannot steal healthy work.

## 7. Tool contract and registry

```ts
interface AgentTool<TArguments, TObservation> {
  readonly name: string;
  readonly description: string;
  readonly argumentsSchema: ZodType<TArguments>;
  execute(context: AgentToolContext, arguments: TArguments): Promise<TObservation>;
}
```

This is an illustrative boundary, not implementation code. The registry is constructed by the server and is immutable after startup. The provider receives only the intersection of:

- tools allowed by the snapshotted Agent definition;
- tools registered by the server;
- tools whose server configuration is available for this run.

Before each tool call, the adapter revalidates current Space membership through `SpaceService.getSpace`. Protected application services then perform their existing checks as defense in depth. After the call, membership and lease ownership are revalidated before an observation is stored.

| Tool | Arguments | Delegated service | Bounded observation |
|---|---|---|---|
| `search_arxiv` | normalized query, page `1..20`, page size `1..5`, allowlisted sort | `ResearchService.searchPapers` | Up to 5 real paper records with identifiers, title, bounded authors, dates, URLs, and bounded abstract evidence. |
| `search_knowledge_base` | query `2..2000`, limit `1..8` | `SemanticRetrievalService.retrieve` | Up to 8 ranked authorized chunks with bounded excerpts and exact locators. |
| `ask_knowledge` | query `2..2000` | `GroundedAnswerService.answerWithSources` | Existing answered/insufficient-context result and normalized underlying citations. |

Tool rules:

- Tool names and arguments are strictly validated with shared Zod schemas.
- Unknown or non-allowlisted tools fail the run with `agent_tool_not_allowed` and a safe decision-error step.
- Tool outputs are runtime-validated before persistence or provider reuse.
- Application `AppError` values are mapped to stable safe tool outcomes; raw provider errors and bodies are never included.
- Authorization loss terminates the run and cannot be offered back to the model as recoverable information.
- `knowledge_not_indexed`, `knowledge_embedding_incompatible`, and `insufficient_context` remain truthful explicit outcomes.
- The Agent layer does not relabel arXiv abstract evidence as full-text evidence.

## 8. Structured decision provider

Add a narrow `AgentDecisionProvider` integration using the configured OpenAI-compatible Chat Completions endpoint. It requests exactly one structured action per turn with parallel tool calls disabled.

The offered actions are the current tool schemas plus an internal control action:

```text
submit_final_answer({ status, answer, evidenceIds })
```

`submit_final_answer` is not a registry tool and performs no external work. The runtime validates:

- `status` is `answered` or `insufficient_context`;
- answer text is non-empty and at most 8,000 characters;
- answered output contains evidence markers whose unique order exactly matches `evidenceIds`;
- every referenced evidence ID exists in this run and belongs to a completed step;
- insufficient-context output contains no evidence IDs or markers.

The adapter accepts exactly one tool call. Plain assistant text, multiple/parallel calls, malformed JSON arguments, unoffered tools, and oversized output are invalid provider responses. There is no permissive text parser or fabricated fallback.

Provider context consists only of:

- a server-owned, versioned orchestration prompt;
- the bounded user task prompt;
- tool schemas;
- completed structured calls and their bounded observations.

Tool results and document excerpts are explicitly labelled untrusted reference data. They can support an answer but cannot change system policy, tools, limits, or authorization.

## 9. Execution limits

The following values are the recommended v1 defaults and hard limits. They are snapshotted on each run and are not client-selectable.

| Limit | Value | Enforcement |
|---|---:|---|
| Task prompt | 4,000 characters | Shared request schema before persistence. |
| Maximum loop steps | 8 | Checked before reserving the next step. |
| Maximum tool calls | 6 | Checked before accepting a tool action. |
| Run wall time | 180 seconds | Immutable deadline from first claim. |
| Provider decision timeout | 30 seconds | Abort signal and adapter timer. |
| Per-tool timeout | 45 seconds | Deadline wrapper bounded by remaining run time. |
| Provider attempts | 2 maximum | Only explicitly transient failures. |
| Provider response body | 64 KiB | Bounded streaming reader. |
| One persisted tool observation | 32 KiB JSON | Normalize, measure UTF-8 bytes, reject overflow. |
| Reconstructed provider context | 128 KiB JSON | Checked before every provider call. |
| Final answer | 8,000 characters | Shared result schema. |
| Evidence records | 32 per run | Checked during observation normalization. |

Token usage may be recorded when a compatible provider returns validated usage fields, but it is not a reliable enforcement primitive across all OpenAI-compatible providers. Phase 9 enforces deterministic byte, step, call, and time limits. A token budget must not be advertised until the provider compatibility contract makes it enforceable.

## 10. Execution Trace safety and retention

### 10.1 Persisted and API-visible

- run ID, status, timestamps, duration, Agent revision, model identifier, and limit snapshot;
- ordered step kind, tool name, status, execution count, duration, and safe error code;
- validated and length-bounded tool arguments;
- normalized observation summary;
- bounded evidence excerpts and stable source locators;
- cancellation request metadata;
- final answer and validated evidence references.

### 10.2 Never persisted in Agent trace or logs

- hidden chain-of-thought, scratchpads, or model reasoning summaries;
- API keys, cookies, session hashes, authorization headers, or environment values;
- raw provider request/response bodies or provider error bodies;
- unrestricted document text or complete uploaded files;
- arbitrary model prompts beyond the bounded task prompt;
- embedding vectors;
- stack traces or internal exception messages;
- cross-Space data, even if returned because of an upstream defect.

### 10.3 Bounded evidence policy

- arXiv abstract excerpt: at most 2,000 characters per paper;
- knowledge chunk excerpt: at most 1,000 characters per result;
- at most 32 evidence records and 32 KiB per observation;
- trace APIs return only the stored bounded representation, never rehydrate full document content;
- opening a source uses its normal authorized document/paper route and current membership checks.

### 10.4 Retention

V1 retains task, run, step, and bounded evidence records for the lifetime of the Research Space. Space deletion cascades all Agent data. There is no hidden time-based deletion claim without an implemented cleanup mechanism. A shorter configurable retention window and task deletion UI are deferred until they can be implemented with explicit product behavior and recovery-safe cleanup.

## 11. Proposed durable schema

All additions are new tables/enums; no Phase 0-8 table is repurposed.

### `agent_definitions`

- `id`, nullable `space_id`, `stable_key`, `name`, `purpose`;
- `enabled`, `system_managed`, `revision`;
- `limits_json`, `prompt_version`, timestamps;
- unique stable key and positive revision checks.

### `agent_definition_tools`

- `agent_id`, `tool_name`, primary key on both;
- names remain text so adding a server tool does not require a PostgreSQL enum migration.

### `agent_tasks`

- `id`, `space_id`, `agent_id`, nullable `created_by_user_id`;
- bounded `prompt`, `client_request_id`, `request_fingerprint`, `created_at`;
- unique `(space_id, created_by_user_id, client_request_id)` for creation idempotency.

### `agent_runs`

- `id`, `task_id`, denormalized `space_id`, nullable `actor_user_id`, `attempt_number`;
- status enum: `queued`, `running`, `completed`, `failed`, `cancelled`;
- definition/configuration snapshot, model, prompt version, limit values;
- `step_count`, `tool_call_count`, `context_bytes`;
- `lease_owner_id`, `lease_generation`, `lease_expires_at`;
- `cancel_requested_at`, nullable `cancel_requested_by_user_id`;
- `started_at`, `deadline_at`, `finished_at`, `error_code`, `final_answer`;
- retry idempotency key/fingerprint and timestamps;
- unique `(task_id, attempt_number)` plus claim and Space-list indexes.

### `agent_run_steps`

- `id`, `run_id`, `sequence`, kind/status enums;
- nullable `tool_name`, bounded `safe_arguments_json`, bounded `observation_json`;
- `execution_count`, `error_code`, start/end timestamps, duration;
- unique `(run_id, sequence)` and conditional field-consistency checks.

### `agent_run_evidence`

- `id`, `run_id`, `step_id`, `evidence_key`, evidence kind;
- nullable live `paper_id`/`document_id` references using `ON DELETE SET NULL`;
- snapshotted source identity, version, URL/filename, hash, locator, and bounded excerpt;
- nullable `final_ordinal` to record final-result use;
- unique `(run_id, evidence_key)` and `(run_id, final_ordinal)`.

Important invariants:

- task, run, and denormalized Space IDs must agree;
- a run actor is server-derived and cannot be supplied as another user;
- counters never decrease;
- terminal runs have no lease;
- completed runs have a final answer, completed final step, finish time, and no error code;
- failed runs have a safe error code and finish time;
- evidence and final references cannot cross runs;
- all child records cascade on task/Space deletion; live source references use `SET NULL` so historical citation snapshots remain truthful.

## 12. REST API proposal

All routes are authenticated, use `/api/v1`, shared strict Zod contracts, current-membership authorization, the standard error envelope, and server-derived actor identity.

| Method and route | Behavior |
|---|---|
| `GET /agents` | List real system-managed definitions and configuration availability. |
| `GET /agents/:agentId` | Read one definition; no secrets or provider endpoint. |
| `POST /spaces/:spaceId/agent-tasks` | Atomically create immutable task plus queued run; return `202`. |
| `GET /spaces/:spaceId/agent-tasks` | Cursor-paginated list filtered by allowlisted status/agent values. |
| `GET /agent-tasks/:taskId` | Resolve parent Space, authorize, return task and ordered run summaries. |
| `POST /agent-tasks/:taskId/runs` | Create an idempotent retry run only when the latest run is terminal; return `202`. |
| `GET /agent-runs/:runId` | Return authorized run summary, final result/error, and cancellation state. |
| `GET /agent-runs/:runId/steps` | Return the at-most-eight ordered safe trace steps and evidence. |
| `POST /agent-runs/:runId/cancel` | Idempotently cancel queued work or request running cancellation; return persisted state. |

Task creation body:

```json
{
  "agentId": "uuid",
  "prompt": "bounded user request",
  "clientRequestId": "uuid"
}
```

The create response contains both `task` and initial `run`. A repeated identical idempotency request returns the existing resources; reuse with a different fingerprint returns `409 agent_idempotency_conflict`.

Run/step reads never disclose whether an inaccessible resource exists; they return the established safe `404` behavior. Cursor encoding follows the canonical bounded document-list convention.

## 13. Implemented UI routes

Phase 9 activates only the already planned Agent routes:

- `/agents`: definition and availability view;
- `/agents/tasks`: task list and New Task entry;
- `/agents/tasks/:taskId`: prompt, Space, attempts, latest durable status, final result/error;
- `/agents/runs/:runId`: ordered Execution Trace and citations.

`/agents/:agentId` may be activated when its definition/detail content is implemented; it is not required for the first vertical slice.

UI behavior:

- task creation always requires an explicit Research Space;
- only Spaces currently accessible to the user are selectable;
- available tools and fixed limits are shown before submission;
- queued/running data comes from REST polling of durable state, not timers;
- cancellation distinguishes `Cancel requested` from `Cancelled`;
- retry creates and navigates to a new run without replacing old trace history;
- completed traces show final evidence links; failed traces retain prior safe steps;
- membership revocation clears protected query cache and returns to `/spaces`;
- Agent navigation is not exposed until API, all states, deep links, responsive layout, and accessibility behavior are implemented together.

V1 does not add Agent WebSocket events. Polling keeps REST as the recovery source and avoids broadening the chat/presence protocol. A later optimization may broadcast persisted run/step deltas only after commit; clients must still recover from REST.

## 14. Failure model

| Condition | Durable outcome |
|---|---|
| Agent provider unconfigured at submission | Reject with `503 agent_runtime_unavailable`; do not create a permanently queued task. |
| Membership missing at claim or lost during run | `failed / agent_space_access_revoked`; no new observation/final content is persisted. |
| Agent disabled before submission | Reject with `409 agent_disabled`. |
| Agent disabled after run creation | Snapshotted queued/running run may proceed; explicit emergency shutdown is a separate operational control. |
| No active knowledge index | Failed tool step with safe `knowledge_not_indexed` observation; model may choose another allowed action within limits. |
| Insufficient grounded context | Successful truthful tool outcome; final result may be `insufficient_context`. |
| Tool timeout | Failed tool step `agent_tool_timeout`; executor may continue only if time/step budget remains. |
| Provider timeout/upstream failure | Adapter retry if transient, then failed run with safe provider code. |
| Invalid/multiple/non-allowlisted call | Decision-error step and failed run; no permissive repair parser. |
| Step or context limit reached before final | Failed run with the precise exhausted-limit code. |
| Cancellation during non-abortable service work | Discard result; persist `cancelled` after control returns or a fenced recovery worker observes the request. |
| Worker crash | Lease expires; same run is reclaimed and reconstructed from durable completed steps. |
| Old worker returns after reclaim | Fenced conditional write fails; result is discarded. |
| Source deleted after citation | Snapshot remains, live link is unavailable, and trace does not imply current source access. |
| Space deleted | Cascades Agent data; workers lose fencing target and discard local output. |

## 15. Acceptance and validation plan

### Unit coverage

- state-transition guards and terminal immutability;
- strict Agent contracts and malformed cursor/idempotency rejection;
- tool allowlist, argument validation, and output normalization;
- evidence-ID allocation and final citation validation;
- byte/step/tool/time limit enforcement;
- provider response bounds, timeouts, retries, and structured-call validation;
- redaction and safe error mapping;
- provider context reconstruction from completed steps only.

### Service/API coverage

- authentication and current membership for every command/read;
- task-plus-run atomic creation and idempotent replay;
- retry creates a new run and preserves old trace;
- queued and running cancellation semantics;
- member removal before claim, during provider work, during each tool, and before final commit;
- valid success through each initial tool;
- no index, incompatible index, no evidence, provider failure, and invalid tool call;
- inaccessible task/run IDs return safe not-found responses;
- trace never returns raw provider payloads or unrestricted text.

### PostgreSQL smoke coverage

- additive migration from the Phase 8C schema;
- concurrent `SKIP LOCKED` claim uniqueness;
- heartbeat extension and lease expiry reclaim;
- fencing rejects an old worker's step and terminal writes;
- cancellation races with claim and final completion;
- unique task/retry idempotency constraints;
- ordered steps and evidence cannot cross runs;
- source deletion preserves snapshots and Space deletion cascades Agent state.

### Executor integration scenarios

- arXiv-only successful answer with abstract evidence;
- knowledge retrieval followed by cited final answer;
- `ask_knowledge` insufficient context without invented claims;
- recover after crash before a provider decision, during a tool step, and after observation persistence;
- wall-time exhaustion across recovery;
- graceful shutdown stops claiming, requests no new decisions, and lets leases protect unfinished work;
- two worker instances cannot both publish the same logical step.

Validation gates remain lint, typecheck, complete Vitest suite, production build, and dedicated PostgreSQL Agent smoke coverage. Phase 6 and Phase 7A smoke suites must continue to pass unchanged.

## 16. Migration and compatibility

- Generate one forward Drizzle migration containing only additive Agent enums, tables, constraints, indexes, and the neutral system definition.
- Do not alter existing API contracts, document states, vector dimensions, or Phase 0-8 tables.
- The `v0.8.1` application can run against the additive schema because it does not reference the new tables.
- Deploy migration before Phase 9 application code; do not enqueue tasks until every instance understands Agent state.
- Rollback of application code leaves dormant Agent tables intact. Destructive table removal is a separate, explicit maintenance decision after data export/retention review, never an automatic down migration.
- Adding a future tool is a registry/definition revision, not a database enum change. Existing run snapshots and traces retain their original tool set.

## 17. Explicit non-goals

- document summarization and paper comparison;
- document upload, save-paper mutation, member mutation, or any other mutating tool;
- custom system prompts, user code, arbitrary URLs, shell/browser tools, or dynamic plugin tools;
- autonomous recurring Agents or schedules;
- parallel tool calls, multi-agent delegation, human approval workflows, or inter-run messaging;
- Redis, Kafka, microservices, a generic distributed job framework, or a separate Agent service;
- hidden reasoning capture or chain-of-thought display;
- token-budget claims that the configured provider cannot enforce;
- Agent WebSocket protocol changes in v1;
- Activity feed integration, paper comparison, or Phase 10 evaluation work.

## 18. Architecture freeze checklist

The following decisions were explicitly accepted on 2026-09-03 before implementation began:

- [x] orchestration-only Agent boundary and existing-service delegation;
- [x] system-managed v1 definition and no custom Agent builder;
- [x] immutable task, new run per retry, and ordered observable steps;
- [x] run-local normalized evidence and citation validation;
- [x] Agent-specific lease, heartbeat, fencing, and fixed deadline;
- [x] cooperative cancellation semantics and read-only initial tools;
- [x] exact initial tool set: `search_arxiv`, `search_knowledge_base`, `ask_knowledge`;
- [x] strict one-action provider protocol and compatibility requirements;
- [x] fixed execution/byte limits;
- [x] trace fields, bounded excerpts, prohibitions, and Space-lifetime retention;
- [x] REST routes, idempotency behavior, and REST polling UI;
- [x] additive migration and rollback compatibility;
- [x] failure codes and acceptance-test matrix;
- [x] all listed non-goals.

Phase 9 implementation followed the frozen staged order. Final checkpoint validation passed, release closure is complete, and the completed baseline is recorded by `v0.9.0`. Future changes to these decisions require a new architecture review.
