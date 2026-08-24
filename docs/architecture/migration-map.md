# CommandBlock-Nexus to ResearchWeave Migration Map

## Decision rule

- **REUSE:** implementation can move with only small, reviewed changes.
- **ADAPT:** a bounded implementation idea or code fragment is useful but must be reshaped for new contracts/security.
- **REIMPLEMENT:** the product concept remains useful, but the implementation should be written for the new architecture.
- **DISCARD:** it should not enter ResearchWeave.

No legacy application module qualifies for direct `REUSE`. This is intentional: useful behaviors are tightly coupled to insecure identity, in-memory state, Minecraft terminology, or simulated output. Small configuration patterns may be reused later only after normal license/provenance review.

## Module and implementation map

| Legacy module / implementation | Current role | Decision | ResearchWeave destination | Reason |
|---|---|---:|---|---|
| `src/App.tsx` | Global state, navigation, fixtures, REST/WS, LLM config, mutations | REIMPLEMENT | `src/app` plus feature modules and typed clients | God component, secret exposure, conflicting local/server state, no routes. Preserve no architecture. |
| `Hotbar.tsx` | Nine-slot game navigation | DISCARD | None | Minecraft-specific interaction and information architecture. |
| `CommandPalette.tsx` | Fake-terminal/game command navigation | DISCARD | Optional conventional search/command menu much later | Current commands and teleport metaphor are product-inappropriate; not a core MVP need. |
| `Workbench.tsx` | Local todo board, static achievements and chart | DISCARD | Overview and Agent Tasks use real data | Static analytics and local status cycling are misleading; a generic todo is not core. |
| `ChatView.tsx` UI | Chat, fake connection flow, members, friend actions | REIMPLEMENT | Collaboration / Space Detail / Chat | Useful product concept, but component mixes simulation, storage, API, membership, and presentation. |
| Client WebSocket reconnect/subscription idea | Same-origin socket, reconnect, join/leave, state updates | ADAPT | `src/lib/realtime` | Keep bounded reconnect/resubscribe behavior; add auth, validation, backoff, recovery cursors, and one shared connection. |
| Server `clientsMap`, room broadcasts, member snapshots | Room-scoped real-time sync | ADAPT | `server/realtime` + Spaces/Chat services | Room fan-out and presence are valuable. Replace address rooms with authorized space IDs and typed envelopes. |
| WebSocket shutdown event | Kicks clients to safe offline state | ADAPT | `space.access.revoked` / `space.deleted` | Preserve explicit state transition; derive permission on server and support resync. |
| REST chat fallback | Alternative send/history path | REIMPLEMENT | Chat route adapter + `ChatService` | Avoid two copies of chat/AI logic. Persist messages first; use REST for history/recovery. |
| Seeded chat messages and fake attachments | Demo-looking collaboration data | DISCARD | None in real user state | No backing files or provenance. Optional demo fixtures must be isolated and labelled. |
| `Vault.tsx` | 54-slot “server space” lobby | REIMPLEMENT | Collaboration / Research Spaces | A shared-space concept is useful, but IP/port, inventory grid, client password, and provisioning claims are wrong. |
| In-memory `activeServers` | Logical room registry | DISCARD | PostgreSQL `research_spaces` and `space_members` | Volatile, globally writable, stores plaintext passwords, and exposes internal fields. |
| Space create/delete API concepts | Room lifecycle | REIMPLEMENT | Resource-oriented Spaces/Members APIs | Needs durable IDs, membership authorization, validation, and transactional deletion. |
| Client-side space password | Access gate | DISCARD | Authenticated invitations/membership | Password is returned and compared in the browser; membership is the correct boundary. |
| `FriendsList.tsx` | Connection request UI | REIMPLEMENT | Collaboration / Connections | UX concept remains, but polling/API calls and identity trust need new feature architecture. |
| Friend request/accept/delete graph logic | Bidirectional connection lifecycle | ADAPT | `ConnectionService` and database constraints | State transitions are simple and useful; rewrite with actor identity, uniqueness, transactions, and authorization. |
| JSON account/friend store | Persistence | DISCARD | PostgreSQL repositories | Synchronous plaintext file persistence is unsafe and race-prone. |
| `LoginView.tsx` | Register/login form | REIMPLEMENT | Auth feature | Form flow is usable in concept; server session and security boundary must be new. |
| Legacy auth endpoints | Register/login against plaintext file | DISCARD | Auth service, bcrypt-compatible hashes, cookie sessions | Misnamed plaintext hash, seeded passwords, no session, no authorization. |
| `Settings.tsx` | UI preferences plus client LLM secrets/endpoints | DISCARD | Settings limited to profile and harmless preferences | Remove API key/base URL/provider UI. Safe preferences can be rebuilt simply. |
| Server Gemini environment client | Server-side provider construction | ADAPT | `integrations/llm` | Correct boundary direction. Add validated config, typed adapter, timeouts, redaction, and model policy. |
| Client-configured OpenAI-compatible proxy | Arbitrary endpoint/key forwarding | DISCARD | None | Exposes credentials and creates SSRF/exfiltration risk. Providers are server-controlled. |
| Repeated chat LLM blocks | AI chat generation | DISCARD | One `LlmService`, called only by defined workflows | Three duplicated implementations with divergent history/errors and game prompts. |
| `GET /api/arxiv/search` upstream call | Real arXiv metadata search | ADAPT | `ResearchService` + `ArxivClient` | Real public API and normalization idea are valuable. Replace regex parsing, add limits/timeouts, remove all fake fallbacks. |
| Regex Atom parsing | arXiv XML extraction | REIMPLEMENT | XML parser adapter | Fragile around namespaces/entities/format changes and loses metadata. |
| `getFallbackPapers` | Offline “academic cache” | DISCARD | None | Fabricated academic results and links violate integrity requirements. |
| `/api/arxiv/summarize` real provider path | Abstract-conditioned generation | ADAPT | `AbstractSummaryService` | Keep metadata/abstract input idea but label it accurately, validate source, persist provenance, and remove false “deep review” claims. |
| Offline fallback paper review | Generated-looking report without evidence | DISCARD | None | Invents methods and experimental improvements. Failure must remain failure. |
| Chat keyword arXiv interception | Research search hidden inside general chat | DISCARD | Explicit Paper Search and agent tool | Duplicates parsing, fakes file downloads, and obscures evidence boundary. |
| `AgentManager.tsx` | Agent cards, skills, tools, tasks, arXiv UI | REIMPLEMENT | Agents / Agents, Tasks, Run Trace | Useful information needs real runs, but current tool toggles and tasks are React state only. |
| Timer-based agent progress | Marks any task completed in fixed steps | DISCARD | Persistent bounded executor | No work occurs. Status must follow actual tool/run outcomes. |
| Agent tool names | Aspirational tool list | DISCARD | Fixed initial registry of four real tools | Most names imply non-existent PDF/DOM/sandbox capabilities. Start with agreed real service-backed tools. |
| Agent purpose/allowed-tool presentation | Describes agent and capabilities | ADAPT | Agent definition/detail UI | Keep transparent purpose and allowlist, backed by persisted definitions and executable registry. |
| Timed arXiv crawl logs | Claims connect/download/cache/index | DISCARD | Real job stages and trace events | UI waits before making request and reports operations that never happen. |
| `Dashboard.tsx` | Fixed metrics and random chart | DISCARD | Overview with query-derived status/activity | Every metric is static/random and includes false production/security claims. |
| `Pipeline.tsx` | Local node toggles and fixed throughput | DISCARD | Document indexing status in Knowledge | Not a pipeline implementation. Future UI reads real persisted job stages. |
| `Compliance.tsx` | Keyword-filter log viewer and static defense claims | DISCARD | Activity plus server security controls | Marketing claims exceed implementation. Security belongs in middleware/services, not a simulated product module. |
| `scanCompliance` | Literal sensitive/destructive keyword blocker | DISCARD | Input limits, validation, moderation policy if later justified | Produces false security confidence, misses real threats, and stores sensitive text. |
| SSE registry and `/api/events` | Server push channel | DISCARD | Authenticated WebSocket | No client subscriber; redundant with WS for this product. |
| `types.ts` domain types | Game pages, messages, agents, pipeline, logs, servers | DISCARD | Feature/domain contracts designed from new entities | Presentation classes and simulated fields are embedded in domain types. |
| `index.css` and background image | Pixel/Minecraft visual system | DISCARD | New restrained Research SaaS design system | Explicitly prohibited style and terminology. |
| React + TypeScript + Vite | Browser stack | ADAPT | Frontend foundation | Keep stack familiarity; update structure, routing, tests, contracts, and accessibility. |
| Express + `ws` | Server/realtime stack | ADAPT | Modular monolith HTTP/WS adapters | Suitable scale and interview clarity; split composition, modules, services, integrations, and tests. |
| `.env` / `.gitignore` server-secret concept | Server environment convention | ADAPT | Validated `server/config/env` and safe example | Ignore rules are directionally useful. Ensure no client-secret parallel path and never include real values. |

## Migration rules

1. Do not copy a component and rename its labels. Implement the ResearchWeave route and contracts first.
2. Do not import legacy fixture arrays, fallback papers, static logs, metrics, task progress, or passwords.
3. Any adapted code fragment requires provenance, license, tests, security review, and terminology removal.
4. Preserve external behavior only when it maps to a real ResearchWeave use case. Room broadcast is useful; “server IP” is not.
5. Migrate one vertical workflow at a time, with the database/service contract as the source of truth.

## Primary migration risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Treating a visual rename as Greenfield work | High / High | Enforce this map; accept only Research-domain models and contracts. |
| Carrying exposed credentials into history or docs | High / Critical | Revoke/rotate now; secret scan before implementation; server-only env config; never quote values. |
| Reusing unauthenticated WS identity | High / Critical | Authenticate upgrade, derive actor server-side, authorize every subscribe/send. |
| Recreating REST/WS duplication | Medium / High | Both adapters call the same application service; one event envelope and contract tests. |
| Calling abstract output full-paper analysis | High / High | Evidence-scope enum and UI labels; full-document path gated on indexed source. |
| Reintroducing fake fallbacks for demos | Medium / High | Typed failure/empty states and explicit isolated demo mode only. |
| Building RAG UI before ingestion correctness | Medium / High | Roadmap gates Ask Knowledge on deterministic parsing/chunk/index tests. |
| Agent framework overreach | Medium / Medium | Fixed four-tool registry, maximum steps/time, one agent loop, no swarm/MCP. |
| PostgreSQL/pgvector setup friction | Medium / Medium | One documented dev database and migrations; no second vector service. |
| In-process jobs lost on restart | Medium / High | Persist job/run state and recover stale leases; status never inferred from timers. |
| Deleting sources breaks citations | Medium / High | Defined deletion/retention policy and source-deleted provenance state. |
| Scope expansion crowds out core portfolio workflow | High / Medium | Use roadmap acceptance gates; postpone OCR, multimodal, billing, complex RBAC. |
