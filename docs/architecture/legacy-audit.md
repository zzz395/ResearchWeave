# CommandBlock-Nexus Legacy Audit

## Scope and method

This audit is based on the implementation in the read-only sibling repository `../CommandBlock-Nexus-legacy`, not on its short README. The review covered the tracked tree, `README.md`, `package.json`, `server.ts`, `src/App.tsx`, `src/types.ts`, `src/index.css`, `.env.example`, `.gitignore`, build configuration, and every file under `src/components/`.

No legacy file was changed. Credential values are intentionally omitted. One hard-coded client credential was discovered; it must be treated as exposed and revoked or rotated before any further use.

## Architecture summary

CommandBlock-Nexus is a single-package TypeScript application:

```text
Browser (React, one large App component)
        | REST + WebSocket
        v
One Express/Vite process (server.ts)
        |-- JSON file: accounts and friend relationships
        |-- process memory: rooms, messages, spaces, logs
        |-- Google Gemini SDK
        |-- arbitrary OpenAI-compatible endpoint supplied by the client
        `-- arXiv Atom API parsed with regular expressions
```

The backend hosts Vite in development and static assets in production. `server.ts` combines bootstrapping, persistence, authentication, friend CRUD, space CRUD, chat, compliance checks, arXiv, LLM calls, SSE, WebSocket presence, and broadcasting in 1,761 lines. The frontend uses conditional rendering rather than URL routing, with most cross-feature state and side effects in the 1,137-line `App.tsx`.

The product model is Minecraft-specific: a nine-slot hotbar selects Workbench, Chat, Vault, Settings, Dashboard, Agents, Pipeline, Security, and Friends. “Server spaces” are logical in-process chat rooms identified by user-entered `ip:port` strings; they are not provisioned Minecraft servers or network proxies.

## Features that genuinely execute

The following paths contain real code and can work within their limitations:

| Capability | What actually works | Important limitation |
|---|---|---|
| App hosting | Express hosts Vite middleware in development and the built SPA in production. | Build and runtime concerns are coupled in one file. |
| Register/login requests | The browser calls real REST endpoints; accounts are written to `db_accounts.json`. | Passwords are plaintext, and successful login creates no authenticated server session. |
| Friend/connection CRUD | List, request, accept/reject, and delete mutate a JSON-backed relationship graph. | Every identity is client-supplied and can be impersonated. Polling is used instead of event-driven updates. |
| Space list/create/delete | REST and WebSocket handlers mutate the in-memory `activeServers` array and broadcast changes. | Data disappears on restart; passwords and authorization are unsafe. Duplicate route/handler variants exist. |
| Room chat and presence | WebSocket join/leave, initial history sync, room-scoped broadcasts, member counts, reconnect, and shutdown notification are implemented. | The connection has no authentication, validation, heartbeat, acknowledgement, or authorization. |
| Chat history APIs | History can be read and messages can be sent through REST. | REST and WebSocket reimplement the same logic differently; history is memory-only. |
| Gemini call | When a valid server environment key exists, chat and paper-summary routes call the Gemini SDK. | Provider/model values are hard-coded, errors can leak implementation details, and fallback output is misleading. |
| OpenAI-compatible call | A server proxy performs a real HTTP request with chat history. | The client chooses the endpoint and sends the API key, creating credential exposure and SSRF risk. |
| arXiv search | The server calls the public arXiv Atom API and extracts title, authors, abstract, ID, date, and links. | Regex XML parsing is fragile; failures and empty results are converted into fabricated success results. |
| Abstract-based summary | With Gemini configured, the LLM receives title, authors, abstract, and URL and returns a generated response. | No PDF is downloaded, parsed, chunked, indexed, or retrieved; this is not full-paper analysis. |
| Keyword compliance check | Selected chat paths run literal/regex checks and add an in-memory log. | It is not a general security or DLP layer and does not redact stored text. |
| SSE endpoint | An SSE registry and broadcaster exist. | The reviewed React client does not subscribe to it; WebSocket duplicates its intended role. |

“Works” here means the code path performs the stated local operation. It does not imply the implementation is secure, durable, academically reliable, or suitable for migration as-is.

## Simulated, fake, static, random, or misleading behavior

| Area | Classification | Evidence and impact |
|---|---|---|
| arXiv fallback papers | **Fake and academically misleading** | Network failure or zero parsed entries returns invented papers and links with `success: true`. Some publication dates and paper metadata are fabricated. |
| Offline paper “review” | **Fake and academically misleading** | When no LLM is configured, the server invents methods, percentage improvements, benchmarks, and limitations unrelated to the supplied abstract. |
| “Deep paper review” | **Mislabelled** | Even the real LLM path only receives metadata and abstract. It never reads the PDF, despite UI claims of deep/full analysis. |
| arXiv PDF download/cache | **Simulated** | Timed UI logs claim PDF download, local caching, and index creation; the code only waits, then requests metadata. File cards use fixed sizes and are not downloaded files. |
| Agent execution | **Simulated** | Assigning any task starts a browser timer that adds 20% every 1.2 seconds and marks it complete. No router, model decision, tool invocation, observation, retry, trace, or result exists. |
| Agent skills/tools | **Static UI state** | Toggling a named skill/tool only changes React state. Most listed tools have no implementation. |
| Agent deployment | **Static UI state** | “Deploy” appends an object with random rotation speed and fixed capability templates; no runtime is created. |
| Dashboard | **Static/random** | Latency, message count, topology, security claims, and uptime are fixed. The chart appends `Math.random()` values. |
| Pipeline | **Static/local simulation** | Nodes and throughput are seeded in the browser. Restart and synthesis buttons simply toggle fixed state and fixed throughput values. |
| Workbench analytics | **Static/local simulation** | Achievements and throughput bars are hard-coded. Tasks only cycle locally through states. |
| Document/files | **Static** | Example files and summaries are seeded in React. There is no upload, storage, parser, chunker, index, or download implementation. |
| Attachments and generated blueprint | **Decorative** | File cards are message metadata only. They do not reference stored binary content. |
| Space provisioning | **Misleading terminology** | A user-entered IP and port are used as a map key. No external host is provisioned, verified, or contacted. |
| Space connection progress | **Simulated** | Five timed status strings imply network/token/model checks; after the delay the client changes local state. |
| Space password protection | **Insecure simulation** | The plaintext password is returned to the browser and compared in React. The server/WS layer does not enforce it. |
| Friend “online” status | **Static** | Friends are rendered as online with a fixed port irrespective of WebSocket presence. |
| Compliance/security claims | **Materially overstated** | Three static “active defense” cards claim broad protection. The actual check is a few keywords and partial IP matching on selected chat paths. |
| Seed audit logs | **Static** | Initial violations are hard-coded demonstration records, including sample secret-like text. |
| Streaming setting | **Non-functional** | The UI stores a streaming flag, but the reviewed LLM calls are non-streaming. |
| Temperature/strictness/tick/debug settings | **Mostly non-functional** | Values are saved in localStorage but not used by the relevant server logic. |

## Security findings

### Critical

1. **A hard-coded API credential exists in browser source.** It appears in `src/App.tsx` in the LLM configuration defaults and again in `src/components/Settings.tsx` initialization/reset logic. A production bundle and browser localStorage expose it to users, extensions, logs, and source inspection. Revoke/rotate it immediately, remove it from source/history where permitted, and configure provider credentials only on the server.
2. **Passwords are stored and compared as plaintext.** `server.ts` calls the field `passwordHash`, but stores the submitted password unchanged and seeds plaintext sample passwords. Use a bcrypt-compatible password hash, unique salt, password policy, and safe migration/reset strategy.
3. **There is no server-side authentication session.** A successful login returns a username; the browser stores it in localStorage and considers that authenticated. Every REST and WebSocket caller can claim any username.
4. **There is no authorization.** Any caller can read or mutate friends, send as another user, clear compliance logs, create/delete spaces, select a room, or alter membership-like state. All protected operations need server-derived identity and resource checks.
5. **Client-controlled LLM endpoints create SSRF and credential-exfiltration risk.** The server accepts an arbitrary `baseUrl` and API key from the client, then performs a credential-bearing request. A malicious caller can target internal services or attacker-controlled hosts. Providers and allowlisted endpoints must be server configuration.

### High

- Space passwords are plaintext in memory, included in space-list/WebSocket payloads, and validated in the browser. They provide no security.
- REST and WebSocket inputs are not schema-validated; size, enum, ID, content, and URL constraints are missing.
- WebSocket upgrades accept every origin and connection, with no session validation, heartbeat, rate limiting, or message size policy.
- Authentication, arXiv, LLM, and chat endpoints have no rate limiting or abuse controls.
- Upstream provider response bodies and exception messages can be returned/logged, revealing sensitive operational details.
- “Compliance” logs store the first 100 characters of the original sensitive message rather than a redacted representation.
- The custom Markdown renderer accepts LLM-provided links without an explicit `http/https` scheme allowlist.
- State-changing operations lack CSRF protection. This becomes mandatory once cookie sessions are introduced.
- Synchronous JSON-file writes can corrupt or race under concurrent operations and expose account data through filesystem permissions/backups.

### Medium and correctness-related

- Duplicate `/api/servers` handlers and multiple create/delete/chat variants make policy enforcement inconsistent.
- IDs based on `Date.now()` can collide and provide no idempotency.
- The arXiv query has no timeout, retry/backoff policy, response-size cap, or robust XML parser.
- The health route reveals provider configuration state; retain only non-sensitive readiness information.
- No security headers, centralized error handler, request correlation ID, audit integrity, or structured logging are present.
- `.gitignore` correctly excludes `.env*` except `.env.example`, and the Gemini environment-key concept is directionally correct. The fatal flaw is the parallel browser-secret path.

## Frontend architecture findings

- `App.tsx` is a “god component”: feature data, fixtures, persistence, networking, WebSocket lifecycle, command parsing, navigation, authorization-like state, and mutations are coupled.
- Large feature components (`AgentManager`, `ChatView`, `Vault`, `FriendsList`, `Settings`) combine API access, domain behavior, and rendering, making them difficult to test.
- There is no URL router, deep linking, route-level loading/error boundary, or durable selected-space context.
- Server state is duplicated among backend memory, React state, and localStorage; each can overwrite or contradict the others.
- API calls and response parsing are repeated inline. There is no typed API client or server-state cache/invalidation strategy.
- Sensitive configuration and “logged in” identity are persisted in localStorage.
- Domain types use broad `any`, presentation fields such as CSS classes, and Minecraft concepts as core data.
- Fixture data is indistinguishable from live data, leading the UI to claim successful operations that never occurred.
- Many interactive `div` elements lack button semantics and keyboard/accessibility behavior.
- No frontend tests, contract tests, or explicit empty/loading/error state system are present.

## Backend architecture findings

- One file owns every boundary, causing duplicated chat/LLM/arXiv logic and preventing independent tests.
- Route handlers manipulate global arrays and files directly; there is no service or repository layer.
- Durable and ephemeral data are not distinguished. Messages, spaces, tasks, logs, and presence disappear on restart, while account writes block the event loop.
- REST, SSE, and WebSocket implement overlapping behaviors. The React client uses REST plus WebSocket but not SSE.
- Authentication and authorization are absent from both HTTP and WebSocket adapters.
- Domain events have no version, event ID, sequence, acknowledgement, or resynchronization strategy.
- External integrations lack timeouts, typed errors, retry policy, and test doubles.
- Academic search and “agent” behavior are embedded in chat routing rather than reusable application services.
- No database migrations, validation schemas, dependency injection/composition root, structured errors, or automated tests exist.

## WebSocket behavior worth preserving as a concept

Preserve and reimplement—not copy blindly—the following:

- one connection can join/leave a room (future `ResearchSpace` channel);
- initial state/history sync after joining;
- broadcasts scoped to a room rather than global fan-out;
- presence/member-count updates on join, leave, and close;
- a specific shutdown/access-revoked event that moves clients to a safe state;
- same-origin `ws/wss` URL construction and bounded reconnect with resubscription.

The new version must add authenticated server-derived identity, membership authorization, schema validation, stable space IDs, heartbeat, bounded exponential backoff, event IDs/sequence, acknowledgement/error messages, maximum payloads, rate limiting, and a shared `ChatService` so REST and WebSocket cannot diverge.

## REST ideas worth preserving as a concept

- a small health/readiness endpoint;
- separate authentication endpoints;
- relationship/connection list and mutation endpoints;
- resource-oriented space CRUD and message-history reads;
- separate arXiv search and summary operations;
- explicit success/failure status codes rather than hiding failures.

The existing handler bodies should not be reused because they lack validation, authentication, authorization, persistence boundaries, and reliable errors.

## Terminology and modules to remove completely

Remove from the new product language and domain model: CommandBlock-Nexus, Minecraft, block/voxel/chunk, Redstone, hotbar/inventory/large chest, player/op level, server IP/port as collaboration space identity, relay/physical cavity, TNT defense, beacon, fake terminal/SSH/SSL claims, pixel HUD, “AI brain/core,” crawler probe claims, and game-style teleport commands.

Discard the Hotbar, pixel-art theme, fake terminal navigation, Dashboard metrics implementation, Pipeline implementation, compliance marketing UI, simulated agent runtime, static file system, client LLM settings, and client-side password flow. ResearchWeave should use research-domain language and make system state verifiable.
