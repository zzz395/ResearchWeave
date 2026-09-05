# ResearchWeave Navigation and Route Specification

## Purpose and status

This document records both the **implemented Phase 9 route surface** and the planned expanded navigation model. The implemented tables are descriptive of the current router; the planned tables are specifications only and do not imply that a route or feature exists.

The route model follows the approved product boundary: Research Space is the collaboration scope; Paper Detail and Execution Trace are detail routes; Chat, Saved Papers, Knowledge, and Members operate in a selected Space; external Research metadata and imported Knowledge remain distinct.

## Navigation mental model

ResearchWeave has one stable primary navigation: the authenticated application sidebar. It answers “which product area am I in?” Contextual tabs answer “which view of this resource am I using?” Breadcrumbs answer “how did this resource inherit its context?” Detail routes are reached from content and never become permanent sidebar items.

### Implemented Phase 9 navigation

```text
ResearchWeave
├─ Discover
│  └─ Research
└─ Workspace
   ├─ Spaces
   ├─ Agents
   └─ Connections

Selected Research Space
├─ Overview
├─ Saved Papers
├─ Knowledge
├─ Chat
├─ Members
└─ Settings                     (owner only)
```

Research is global discovery. Saved Papers and Knowledge are Space-scoped so that authorization and collaboration context remain explicit. Paper Detail is reached from Research results; it is not a permanent sidebar destination.

### Planned expanded primary sidebar

```text
ResearchWeave
├─ Overview
├─ Collaborate
│  ├─ Research Spaces
│  └─ Connections
├─ Work
│  ├─ Knowledge
│  ├─ Research
│  └─ Agents
├─ Activity
└─ Settings                     (sidebar footer)
```

`Collaborate` and `Work` are visual group labels, not clickable destinations. This keeps the sidebar stable and avoids a redundant landing page for every noun.

The following are deliberately not primary navigation items:

- Space Chat, Members, and Space Settings: tabs inside a Research Space.
- Ask Knowledge and Knowledge Base Detail: contextual/detail routes.
- Paper Detail and Paper Comparison: result/detail workflows.
- Agent Task Detail and Execution Trace: detail workflows.
- Logout: an account action inside the user menu.
- Search, notifications, command menu, presence, and workspace switcher: absent until a real cross-product behavior exists.

### Planned secondary and contextual navigation

| Context | Navigation |
|---|---|
| Research Space | `Overview`, `Saved Papers`, `Knowledge`, `Chat`, `Members`, and owner-only `Settings` tabs. The space name and role remain above the tabs. |
| Knowledge | `Documents`, `Knowledge Bases` section tabs. `Ask` is an action/detail route tied to one knowledge base. |
| Research | `Search`, `Saved Papers`; comparison is launched from selection and opens a route. |
| Agents | `Agents`, `Tasks`; Agent Detail and Run Trace are reached from records. |
| Settings | `Profile`, `Preferences` only when both are real; no provider/API-key page. |

Tabs use URL routes when a view should survive refresh or be shareable. Local tabs are reserved for presentational subdivisions that do not change the data boundary.

## Implemented route map — Phase 9

### Entry and public routes

| Route | Access | Purpose |
|---|---|---|
| `/` | Public resolver | Authenticated users redirect to `/spaces`; unauthenticated users redirect to `/login`. |
| `/login` | Anonymous-only | Sign in and restore a validated internal return path. |
| `/register` | Anonymous-only | Create an account, then open `/spaces`. |

### Authenticated routes

| Route | Navigation role | Purpose |
|---|---|---|
| `/research` | Primary | Real arXiv paper search with URL-backed query, page, and sort state. |
| `/research/papers/:paperId` | Detail | Persisted paper metadata, abstract evidence, source links, summary, and explicit Save-to-Space workflow. |
| `/agents` | Primary | System-managed Agent definitions, purpose, approved tools, limits, and runtime availability. |
| `/agents/tasks` | Secondary | Explicitly Space-scoped durable Task ledger and New Task entry. |
| `/agents/tasks/:taskId` | Detail | Immutable Task prompt and ordered durable Run attempts. |
| `/agents/runs/:runId` | Detail | Durable Run state, safe ordered steps, final answer, and server-validated evidence. |
| `/spaces` | Primary | Authorized Research Space list. |
| `/spaces/new` | Workflow | Create a Research Space. |
| `/spaces/:spaceId` | Space default | Space overview and truthful continuation actions derived from current resources. |
| `/spaces/:spaceId/saved-papers` | Space tab | Membership-authorized Saved Papers for this Space. |
| `/spaces/:spaceId/knowledge` | Space tab | Document upload, indexing state, retrieval, and grounded questions for this Space. |
| `/spaces/:spaceId/chat` | Space tab | Durable chat with authenticated realtime deltas. |
| `/spaces/:spaceId/members` | Space tab | Current membership and admission/removal workflows. |
| `/spaces/:spaceId/settings` | Owner-only Space tab | Rename and lifecycle controls. |
| `/connections` | Primary | Connection requests and accepted connections. |

Any route not listed above is absent from the current router. In particular, Overview as a global destination, Activity, Knowledge Bases, standalone document detail, paper comparison, and user Settings remain planned. Agent state refreshes through durable REST polling; no Agent-specific WebSocket route or protocol exists.

## Planned canonical route map

### Entry and public routes

| Route | Access | Purpose |
|---|---|---|
| `/` | Public resolver | Authenticated users redirect to `/overview`; unauthenticated users redirect to `/login`. It is not a second dashboard. |
| `/login` | Anonymous-only | Sign in. Authenticated users redirect to their validated return path or `/overview`. |
| `/register` | Anonymous-only | Create an account. Authenticated users redirect to `/overview`. |

### Authenticated routes

| Route | Navigation role | Purpose |
|---|---|---|
| `/overview` | Primary | Real cross-domain recency/status summary; may remain minimal until sufficient data exists. |
| `/spaces` | Primary | Research Space list. |
| `/spaces/new` | Workflow | Create a Research Space. A route is preferred over a modal for deep-link/back behavior. |
| `/spaces/:spaceId` | Detail + default tab | Space overview and linked real resources. |
| `/spaces/:spaceId/chat` | Space tab | Durable chat in this space. |
| `/spaces/:spaceId/members` | Space tab | Membership and invitations. |
| `/spaces/:spaceId/settings` | Space tab | Rename and owner-only lifecycle controls. |
| `/connections` | Primary | Connection requests and accepted connections. |
| `/knowledge` | Section resolver | Redirect to `/knowledge/documents` while preserving valid scope query parameters. |
| `/knowledge/documents` | Secondary | Authorized document list across or within an explicit space filter. |
| `/knowledge/documents/:documentId` | Detail | Document metadata, lifecycle, source availability, retry/reindex/delete. |
| `/knowledge/bases` | Secondary | Knowledge Base list. |
| `/knowledge/bases/:knowledgeBaseId` | Detail | Knowledge Base documents and retrieval scope. |
| `/knowledge/bases/:knowledgeBaseId/ask` | Workflow/detail | Grounded question flow scoped to the selected base. |
| `/research` | Primary + default | Real paper search. |
| `/research/saved` | Secondary | Saved papers, explicitly scoped/filterable by Research Space. |
| `/research/papers/:paperId` | Detail | Real paper metadata, abstract, source links, save/import state. |
| `/research/compare` | Workflow | Compare selected paper/evidence records; selected IDs live in validated query parameters. |
| `/agents` | Primary + default | Agent definitions and purpose/allowlist summaries. |
| `/agents/:agentId` | Detail | One agent definition and real recent runs. |
| `/agents/tasks` | Secondary | Durable task list. |
| `/agents/tasks/:taskId` | Detail | Task request, status, result, and attempts. |
| `/agents/runs/:runId` | Detail | Observable execution trace. |
| `/activity` | Primary | Authorized real activity feed. |
| `/settings` | Primary utility | Profile and harmless preferences; redirect to the first implemented subsection only if subsections exist. |
| `/settings/profile` | Secondary, later | Profile details. |
| `/settings/preferences` | Secondary, later | Harmless UI preferences. Do not expose provider credentials/endpoints. |

### Why resource IDs are not always nested under spaces

Space-owned resources remain authorized by Research Space even when their detail URL is shorter. A stable document, knowledge base, paper cache record, task, or run ID can resolve its parent context server-side, then render `Space → Area → Resource` in the breadcrumb. This avoids deeply nested URLs while preserving the actual authorization boundary. Lists and create actions must still make the active space/filter explicit.

## Planned route hierarchy

```mermaid
flowchart TD
    Root["/"] --> Login["/login"]
    Root --> Register["/register"]
    Root --> App["Authenticated shell"]
    App --> Overview["/overview"]
    App --> Spaces["/spaces"]
    Spaces --> SpaceNew["/spaces/new"]
    Spaces --> Space["/spaces/:spaceId"]
    Space --> Chat["chat"]
    Space --> Members["members"]
    Space --> SpaceSettings["settings"]
    App --> Connections["/connections"]
    App --> Knowledge["/knowledge"]
    Knowledge --> Documents["documents"]
    Knowledge --> Bases["bases"]
    Documents --> DocumentDetail[":documentId"]
    Bases --> BaseDetail[":knowledgeBaseId"]
    BaseDetail --> Ask["ask"]
    App --> Research["/research"]
    Research --> Saved["saved"]
    Research --> Paper["papers/:paperId"]
    Research --> Compare["compare"]
    App --> Agents["/agents"]
    Agents --> Agent[":agentId"]
    Agents --> Tasks["tasks"]
    Tasks --> Task[":taskId"]
    Agents --> Run["runs/:runId"]
    App --> Activity["/activity"]
    App --> Settings["/settings"]
```

## Authentication and route guards

```mermaid
flowchart LR
    A[Open protected URL] --> B{Valid server session?}
    B -- Yes --> C{Authorized for resource?}
    C -- Yes --> D[Render route and restore URL state]
    C -- No --> E[Permission-denied view with safe return action]
    B -- No --> F[Store validated internal return path]
    F --> G[Login]
    G --> H{Login succeeds?}
    H -- Yes --> I[Replace navigation to return path]
    H -- No --> G
```

Guard rules:

- Authentication truth comes only from the server session, never localStorage.
- The return path must be same-origin, begin with `/`, exclude auth routes, and be length-bounded before storage or navigation.
- Use replace navigation after login/logout redirects so Back does not create a redirect loop.
- Authorization failure is distinct from not found only when revealing resource existence is safe. Otherwise use the server's safe not-found response.
- Session expiry during a mutation shows a session-expired state, preserves safe unsent local input, and resumes only after re-authentication.
- Route loaders/query boundaries display request IDs from the standard error envelope when available.

## URL state

Put shareable, reload-safe view state in query parameters:

| State | Suggested parameter | Rule |
|---|---|---|
| Search text | `q` | Trimmed and length-bounded; never include secrets or document contents. |
| Space filter | `space` | Stable ID; `all` may be represented by absence. |
| Status filter | `status` | Allowlisted enum; repeated values only when the UI supports multi-select. |
| Sort | `sort` | Allowlisted field/direction token, not raw SQL-like text. |
| Research comparison | repeated `paper` | Validate count and IDs; canonicalize order only if comparison semantics are order-independent. |
| Tab | route segment | Use segments for primary sibling views, not `?tab=`. |

Cursor tokens may appear in the URL only if the server defines them as safe, bounded, and opaque. Otherwise preserve pagination in query cache/history state. Do not put prompts, chat drafts, access tokens, API keys, citation excerpts, or provider payloads in URLs.

Back/forward navigation must restore filters, selected tab, and scroll position when practical. Changing filters should usually replace the current history entry while explicit navigation and item selection should push.

## Breadcrumb rules

- Do not show a breadcrumb on `/overview`, primary lists, Login, or Register.
- Use breadcrumbs at resource depth two or greater, for example `Research Spaces / Atlas Study / Members`.
- Use resolved resource names, not raw IDs, after data loads. Skeleton the label to avoid layout shift.
- Every ancestor except the current page is a link.
- On mobile, show Back plus current parent; collapse middle ancestry into an accessible menu if necessary.
- Breadcrumbs never duplicate tabs or the entire sidebar.

## Page-header rules

| Route type | Header content |
|---|---|
| Primary list | Page title, one-sentence purpose when useful, one create/import/run action if implemented. |
| Detail | Breadcrumb, resource title, truthful status/evidence scope, contextual actions. |
| Space | Space title, role/context, then Space tabs. |
| Workflow/form | Back/breadcrumb, task title, consequences or scope, submit/cancel actions. |
| Dense data | Title and actions in flow; filter toolbar may be sticky below it. |

Headers do not contain decorative metrics, universal search, fake online state, or disabled future actions.

## Responsive navigation

- Desktop `>= 1200px`: expanded `248px` sidebar.
- Compact desktop `1024–1199px`: persistent `72px` rail with labels available to keyboard, pointer, and assistive technology.
- Tablet `< 1024px`: sidebar becomes a drawer; a `56px` top app bar contains menu trigger, concise current-area label, and at most one essential page action.
- Mobile `< 768px`: same drawer, full labels, `44px` rows, safe-area padding. Do not introduce a bottom navigation that competes with the desktop model or truncates the eight destinations.
- Opening/closing the drawer restores focus to the trigger. Route selection closes the drawer and moves focus to page content.

## Context preservation

- Space-scoped links carry or derive the active space. Switching tabs never loses the space ID.
- Returning from a detail route should restore the list's filter, sort, query, and approximate scroll position.
- `Save to space`, `Import to knowledge`, and `Run in scope` actions require the user to choose a space when context is ambiguous. Never silently choose the last space for a consequential mutation.
- When access to the current space is revoked, leave the resource route, clear its cached protected data, explain the change, and navigate to `/spaces`.
- Realtime reconnect restores subscriptions from the canonical route/context and then refreshes durable REST data.

## Navigation states

| State | Behavior |
|---|---|
| Route loading | Shell remains stable; main region shows route skeleton and `aria-busy`. |
| Route error | Route-level error view preserves shell and offers retry/return. Unexpected errors include request ID. |
| Not found | Clear 404 with return to the closest safe primary list. No technical stack information. |
| Permission denied | Clear access message and safe return; no partial protected content remains visible. |
| Destination not implemented | Do not render or link the navigation item. Documentation is not a reason to show a disabled placeholder. |
| Destination temporarily unavailable | Keep it visible only if the capability exists and explain the recoverable outage in its content boundary. |

## Naming conventions

- Routes use lowercase plural resource nouns and hyphens only when necessary.
- UI labels use `Research Spaces`, `Knowledge Bases`, `Saved Papers`, `Agent Tasks`, and `Execution Trace`.
- Use ResearchWeave domain language; do not introduce unrelated server, game, or terminal terms such as server IP, room password, hotbar, player, Redstone, or command teleport.
- Use `Chat` only within a Research Space. Use `Activity` for durable events and `Execution Trace` for agent operational steps.
- Use `Settings` for profile and harmless preferences; provider configuration remains server-only.

## Implementation gate

A route may be added to the router and navigation only when:

1. its screen and applicable states are ready to implement;
2. its API/authorization boundary exists or the work item explicitly includes it;
3. it has a real destination rather than a placeholder;
4. deep-link refresh and back behavior are defined;
5. mobile drawer/breadcrumb behavior is defined;
6. it does not disclose inaccessible resource existence or sensitive URL state.
