# ResearchWeave Screen Specifications

## Purpose and use

This document defines future screen behavior at implementation-ready detail without implementing any screen. Routes follow [Navigation and routes](navigation-and-routes.md); layout, state, and accessibility rules follow the [UI/UX specification](ui-ux-spec.md); visual values and primitives follow the [Design system](design-system.md).

Authentication, Research Spaces, Connections, Members, and Chat use real Phase 4 data. Later screens described below may display a field only after its API contract supplies a real value. “Not available yet” is preferable to an invented count, timestamp, progress value, status, or result.

## Delivery priority

| Wave | Screens | Rationale |
|---|---|---|
| `MVP-1: identity and space boundary` | Login, Register, Research Spaces List, Create Research Space, Research Space Detail shell | First real product UI; establishes session, authorization context, and reusable shell. |
| `MVP-2: collaboration` | Connections, Space Chat/Members views within Space Detail, Activity | Completes the real multi-user space workflow after identity and persistence. |
| `Later-1: academic discovery` | Research Search, Paper Detail, Paper Comparison | Requires trustworthy arXiv and explicit evidence-scope services. |
| `Later-2: knowledge` | Knowledge Documents, Knowledge Base Detail, Ask Knowledge | Requires real upload, parsing, indexing, retrieval, and citations. |
| `Later-3: agents` | Agents, Agent Tasks, Agent Execution Trace | Requires real Research/Knowledge tools and durable bounded execution. |
| `Later polish` | Overview and expanded Settings | Overview waits for meaningful real cross-domain data; Settings stays minimal. |

Screens from later waves must not appear as empty navigation destinations during MVP-1. Add a route only when its implementation phase begins.

## Shared screen rules

- One primary action per screen; secondary and destructive actions are visually subordinate.
- Lists preserve filter, sort, and scroll state across detail navigation.
- Loading skeletons mirror actual content; empty states never contain examples that look like user data.
- Errors identify the failed boundary and include a retry/recovery path and request ID when available.
- Permission states do not leak protected content or confirm resource existence when unsafe.
- Status, evidence scope, and processing stage always include text, not color alone.
- On mobile, prioritize identity, status, and primary action; move secondary metadata into disclosure/detail rather than shrinking text.

## 1. Login

**Route / priority:** `/login` · `MVP-1`

| Requirement | Specification |
|---|---|
| Purpose | Establish a server-backed session and return the user to a safe intended route. |
| Primary action | `Sign in`. |
| Secondary actions | Link to Register; password visibility toggle. No social-login buttons unless implemented. |
| Information hierarchy | ResearchWeave brand and short traceable-research description → form title → email/username and password → inline/form error → submit → Register link. |
| Main components | Pre-auth shell, FormField, Input, password control, Button, inline Alert. |
| Empty state | Initial form is blank except safe browser autofill. No demo credentials or sample account. |
| Loading state | Submit button becomes `Signing in…`, remains width-stable, and blocks duplicate submission; fields remain readable. Session bootstrap uses a small centered status before redirecting. |
| Error state | Field errors sit below fields. Invalid credentials use one non-enumerating message. Network/server error offers retry and request ID. Session-expired entry explains that sign-in is required again. |
| Responsive behavior | Desktop uses a quiet brand column plus `400px` form. Mobile stacks brand above a full-width form with `16px` gutters and `44px+` controls. |

Additional behavior: use `autocomplete="username"` and `autocomplete="current-password"`; focus the first invalid field after submission; validate and preserve only a same-origin return path.

## 2. Register

**Route / priority:** `/register` · `MVP-1`

| Requirement | Specification |
|---|---|
| Purpose | Create an account under the real password and identity policy, then establish or proceed to a session as defined by Auth architecture. |
| Primary action | `Create account`. |
| Secondary actions | Link to Login; password visibility toggle. |
| Information hierarchy | Brand context → form title and concise policy → identity fields → password fields and persistent requirements → validation → submit → Login link. |
| Main components | Pre-auth shell, FormField, Input, password requirement text, Checkbox only if a real consent is legally/product-required, Button, Alert. |
| Empty state | Blank form with browser autofill enabled; no preselected consent or example identity. |
| Loading state | `Creating account…`; disable duplicate submit without clearing values. |
| Error state | Duplicate identity message must not expose more account data than policy permits. Password and validation errors explain correction. Unexpected error keeps safe field values but clears password if security policy requires. |
| Responsive behavior | Same frame as Login. Requirements wrap below the password field; no two-column fields on narrow screens. |

Registration should remain one focused form, not a wizard. Do not ask for profile fields that the initial user model does not require.

## 3. Research Spaces List

**Route / priority:** `/spaces` · `MVP-1`

| Requirement | Specification |
|---|---|
| Purpose | Let the user find, open, and create spaces they own or have joined. |
| Primary action | `Create research space`. |
| Secondary actions | Search/filter only after supported; open a space; limited row overflow actions based on role. |
| Information hierarchy | Page title and create action → optional real search/filter toolbar → compact list with name, description excerpt, role/owner, real member count, and real last activity → pagination. |
| Main components | Authenticated shell, PageHeader, SearchInput, Table/list, StatusBadge for role only if useful, EmptyState, Pagination. |
| Empty state | `No research spaces yet` with explanation and Create action if authorized. No sample spaces. |
| Loading state | Row skeleton preserving columns. Background refresh retains current rows. |
| Error state | Boundary error with Retry. Mutation failure remains next to the attempted action. Permission changes remove inaccessible rows after confirmation. |
| Responsive behavior | Desktop uses a list/table, not oversized cards. Mobile rows show name, role, and one real recency line; description and counts move into detail/disclosure. |

Display gates: name, description, owner/role, member count, and last activity may appear only when each is returned by the real API. Never derive last activity from local page visits or show a static online state.

## 4. Create Research Space

**Route / priority:** `/spaces/new` · `MVP-1`

| Requirement | Specification |
|---|---|
| Purpose | Create the smallest valid collaboration boundary. |
| Primary action | `Create space`. |
| Secondary actions | `Cancel` returns to the list without mutation. |
| Information hierarchy | Breadcrumb/back → title and consequence → name → optional description only if in contract → actions. |
| Main components | PageHeader, constrained form, FormField, Input, Textarea, Button, inline Alert. |
| Empty state | Blank form; no generated name, member list, template, or demo content. |
| Loading state | Submit becomes `Creating…`; preserve inputs and prevent duplicates. |
| Error state | Inline validation; server conflict/policy error near the field or form; unexpected error includes safe retry/request ID. |
| Responsive behavior | `480–640px` form column on desktop; full-width mobile form. Primary action may become full width, with Cancel still visible. |

On success, replace navigation to `/spaces/:spaceId`. Do not create members, chat messages, papers, or activity beyond the real owner membership and server-generated creation event.

## 5. Research Space Detail

**Route / priority:** `/spaces/:spaceId` and child tabs · shell in `MVP-1`, Chat/Members in `MVP-2`

| Requirement | Specification |
|---|---|
| Purpose | Keep one Research Space context visible while users inspect its real resources, collaborate, manage members, and edit lifecycle settings. |
| Primary action | Context-dependent: initially none on Overview; `Send` in Chat; `Invite member` in Members; `Save changes` in Settings. |
| Secondary actions | Open linked real resources; rename/edit; member management; delete for owner in Settings. |
| Information hierarchy | Spaces breadcrumb → space name, description, owner/role → tabs `Overview / Chat / Members / Settings` → tab content. |
| Main components | PageHeader, Tabs, compact resource sections, Chat composition, member Table/list, settings form, Dialog for destructive confirmation. |
| Empty state | Overview names absent resource types only when that section is implemented. Chat says `No messages yet`; Members always contains the real owner once backend exists. No seeded activity. |
| Loading state | Keep space header stable while tab content skeletons. Chat history and older-page loading are localized. |
| Error state | Space load failure gets route-level retry. Tab failure does not erase the space header. Access revoked clears protected cache and returns to Spaces with explanation. |
| Responsive behavior | Tabs may horizontally scroll with a visible edge affordance. Chat becomes one column; member/context panels become drawers. Settings forms stack. |

Tab specifics:

- **Overview:** only real linked knowledge bases, saved papers, tasks, and recent activity. Omit unavailable sections rather than showing zero-filled dashboards.
- **Chat:** durable message history with sender and exact timestamp; connection state is separate from message persistence. Composer does not imply attachments until storage exists.
- **Members:** real owner/member roles, joined date when available, pending invitations only if implemented. Presence is transient and explicitly labelled.
- **Settings:** name/description and a separated danger zone. Delete dialog states affected resources based on server policy; confirmation never relies on color alone.

## 6. Connections

**Route / priority:** `/connections` · `MVP-2`

| Requirement | Specification |
|---|---|
| Purpose | Manage real connection requests and accepted user relationships used for invitations. |
| Primary action | `Find user` or `Send request` only when a real lookup/request flow exists. |
| Secondary actions | Accept, reject, cancel outgoing request, remove connection. |
| Information hierarchy | Page title → request sections with pending counts only when real → accepted connections → actions and timestamps. |
| Main components | PageHeader, Tabs or clearly headed sections, SearchInput, compact people rows, Avatar, Buttons, confirmation Dialog. |
| Empty state | Separate truthful messages for no pending requests and no connections; offer the real lookup action where supported. |
| Loading state | Row skeletons by section; individual actions show localized pending state. |
| Error state | A failed row mutation remains on the row with retry. Conflict/stale request triggers refresh and explains the updated state. |
| Responsive behavior | Rows stack identity, relationship state, and actions. Multiple actions use an overflow menu while Accept remains prominent for inbound requests. |

Do not show everyone as online or attach a fixed port/status. Connection state and space membership remain separate concepts.

## 7. Overview

**Route / priority:** `/overview` · `Later polish`

| Requirement | Specification |
|---|---|
| Purpose | Provide a concise starting point assembled from real user-relevant records across implemented domains. |
| Primary action | None globally; contextual `Create space` is allowed when the user has no spaces. |
| Secondary actions | Open recent space, document/job, saved paper, task, or activity record. |
| Information hierarchy | Greeting/page title → actionable real statuses → recent spaces/work → recent activity. |
| Main components | PageHeader, compact lists, StatusBadge, EmptyState, ErrorState. Charts are not an initial requirement. |
| Empty state | Explain that activity appears as the user creates and uses spaces; provide Create Space. No sample metrics. |
| Loading state | Independent section skeletons to avoid blocking the whole page. |
| Error state | Each domain section fails independently and names its boundary; successful sections remain visible. |
| Responsive behavior | Desktop may use a 2-column asymmetric grid; mobile uses priority-ordered sections. No data-dense tile shrinks below readable width. |

Only measured/query-derived values may appear. No random latency, throughput, uptime, security score, achievement, or synthetic trend.

## 8. Knowledge Documents

**Route / priority:** `/knowledge/documents` · `Later-2`

| Requirement | Specification |
|---|---|
| Purpose | Upload and inspect authorized source documents and their real ingestion lifecycle. |
| Primary action | `Upload documents`. |
| Secondary actions | Filter by space/status/type; open document; retry/reindex/delete when allowed. |
| Information hierarchy | Page title and upload → explicit space scope → filters → rows with filename, type/size, space, persisted stage/status, updated time, actions. |
| Main components | PageHeader, upload Dialog/route, SearchInput, Select filters, DataTable, DocumentStatus, Progress only from real stage data, Dialog. |
| Empty state | Scope-specific `No documents uploaded` with supported types and Upload action. No sample files. |
| Loading state | Row skeletons. Upload shows actual transport progress only when measurable; parsing/indexing uses backend stages, not a fabricated percentage. |
| Error state | Upload validation is file-specific. Failed processing remains as a record with safe stage/error and Retry/Reindex. List failure offers retry. |
| Responsive behavior | Mobile list prioritizes filename, status, and space; size/type/time are disclosed in detail. File picker and actions meet touch targets. |

The first release labels PDF support as text-based PDF; scanned/OCR and complex layout limitations are explicit.

## 9. Knowledge Base Detail

**Route / priority:** `/knowledge/bases/:knowledgeBaseId` · `Later-2`

| Requirement | Specification |
|---|---|
| Purpose | Define and inspect the authorized document set used as one retrieval scope. |
| Primary action | `Ask this knowledge base` once at least one ready document exists. |
| Secondary actions | Add/remove document, rename/edit, reindex a failed document through its document workflow, delete base. |
| Information hierarchy | Breadcrumb with space → base name/description → readiness summary from real document states → included documents → actions. |
| Main components | PageHeader, Status summary, document Table/list, Dialog/Drawer to add existing documents, EmptyState, Alert. |
| Empty state | `No documents in this knowledge base` with Add Documents. Ask action is disabled with an explicit reason. |
| Loading state | Header skeleton followed by document rows. Add/remove mutations remain localized. |
| Error state | Retrieval of the base or documents is separate; stale membership/access moves to permission state. Failed documents retain their real status. |
| Responsive behavior | Header actions collapse into menu. Document rows adapt as in Documents; readiness summary wraps as definition items, not metric cards. |

Do not claim a base is searchable until it contains at least one active ready index under the server contract.

## 10. Ask Knowledge

**Route / priority:** `/knowledge/bases/:knowledgeBaseId/ask` · `Later-2`

| Requirement | Specification |
|---|---|
| Purpose | Ask a question within one explicit knowledge-base scope and inspect a grounded answer with source citations. |
| Primary action | `Ask question`. |
| Secondary actions | Open citation/source; retry a failed query; start a new question. |
| Information hierarchy | Breadcrumb and active base scope → question composer → persisted query status → answer-status/evidence label → answer → citations/source excerpts. |
| Main components | PageHeader, Textarea/FormField, Button, query status, evidence-scope badge, rich prose constrained to reading width, Citation list, ErrorState. |
| Empty state | Before a question, show concise scope guidance. If the base has no ready documents, block the form and link to document management. |
| Loading state | Show real queued/running status and elapsed time only as elapsed time—not progress. Keep the submitted question visible. |
| Error state | `No evidence` is a successful, explicit state with no invented answer. Provider/retrieval failure is failed/retryable and preserves the question. |
| Responsive behavior | Citation rail moves below answer; source disclosure opens inline or in a full-height sheet. Composer remains reachable without covering results. |

Every displayed citation must correspond to an authorized chunk actually supplied to the answer process.

## 11. Research Search

**Route / priority:** `/research` · `Later-1`

| Requirement | Specification |
|---|---|
| Purpose | Search real academic metadata and move selected papers into a durable ResearchWeave workflow. |
| Primary action | `Search papers`. |
| Secondary actions | Open paper, save to a chosen space, select for comparison. |
| Information hierarchy | Search title and field → query/status → result count only from response → result list with title, authors, date, abstract excerpt, arXiv identity/source → pagination. |
| Main components | PageHeader, SearchInput/Form, filter controls only if supported, result list, Checkbox for compare mode, EmptyState, Pagination, Alert. |
| Empty state | Before search, prompt for a research topic. A successful zero-result search states `No papers found` and suggests changing the query. |
| Loading state | Preserve submitted query and prior results during background refetch; initial search uses result-row skeletons. |
| Error state | arXiv/upstream failure is an error with Retry and no fallback papers. Rate limit/timeout messages are distinct when server provides safe codes. |
| Responsive behavior | Results become single-column reading rows. Compare selection uses a non-obscuring sticky action bar only after selection. |

Search never displays fabricated papers, cached records without verifiable source metadata, or automatic “AI summaries” before the user requests one.

## 12. Paper Detail

**Route / priority:** `/research/papers/:paperId` · `Later-1`

| Requirement | Specification |
|---|---|
| Purpose | Inspect real paper metadata/abstract, source attribution, saved/import state, and permitted evidence-scoped actions. |
| Primary action | Context-dependent `Save to space`; after saved, `Import PDF to knowledge` only when the real workflow exists. |
| Secondary actions | Open canonical arXiv/PDF link, request Abstract-based Summary, add to comparison. |
| Information hierarchy | Research breadcrumb → title → authors and canonical identifiers/dates → source attribution and links → action/status row → abstract → explicitly labelled summary if requested. |
| Main components | PageHeader, metadata definition list, Source links, EvidenceScopeBadge, reading typography, status Alerts, Dialog for space/base selection. |
| Empty state | Missing optional metadata is labelled unavailable. Summary area is absent until requested; it is not filled with placeholder prose. |
| Loading state | Title/metadata skeleton. Summary action shows real pending state separately from page loading. |
| Error state | Metadata source failure, summary-provider failure, and import/index failure remain distinct. Abstract-only data never unlocks grounded-analysis labels. |
| Responsive behavior | Metadata rail moves above abstract. Actions wrap by priority; external links remain identifiable and keyboard-accessible. |

Use the exact heading `Abstract-based Summary`. Full-document actions remain unavailable until a linked imported source is ready and cited.

## 13. Paper Comparison

**Route / priority:** `/research/compare` · `Later-1`, grounded comparison expands in `Later-2`

| Requirement | Specification |
|---|---|
| Purpose | Compare two to four selected papers using only the evidence actually available. |
| Primary action | `Compare selected papers` when generation is a real requested operation; otherwise the comparison view itself is the result. |
| Secondary actions | Add/remove paper, open detail/source, save comparison if persistence exists. |
| Information hierarchy | Comparison scope label → selected papers → aligned dimensions such as title/authors/date/problem/method claims available from evidence → citations/source boundary → result. |
| Main components | PageHeader, selection control, EvidenceScopeBadge, semantic comparison Table, source links, EmptyState, Alert. |
| Empty state | Fewer than two selected papers prompts selection and links back to Search/Saved. No default comparison set. |
| Loading state | Preserve selected paper headers; skeleton comparison rows or show durable run status for generated comparison. |
| Error state | Identify which paper/source failed. Partial metadata may remain visible; generated comparison must not claim completion when evidence failed. |
| Responsive behavior | Provide stacked single-paper sections by dimension, with an optional clearly signposted horizontal comparison region. Do not compress four columns into unreadable cards. |

`Abstract-based comparison` and `Full-document grounded comparison` are separate labels and contracts. Mixed evidence must describe each source boundary rather than choosing the stronger label globally.

## 14. Agents

**Route / priority:** `/agents` · `Later-3`

| Requirement | Specification |
|---|---|
| Purpose | Inspect real agent definitions, purpose, allowed tools, limits, and recent runs. |
| Primary action | `Create agent` only if custom definitions are in the accepted implementation scope; otherwise no global primary action. |
| Secondary actions | Open agent, enable/disable when permitted, start a bounded task. |
| Information hierarchy | Page title → agent list with name, purpose, scope, enabled state, allowed-tool summary, real recent run status → actions. |
| Main components | PageHeader, compact list/cards, Badge for tools, StatusBadge, EmptyState, DropdownMenu. |
| Empty state | Explain that no agents are configured; offer creation only when backend supports it. Never seed impressive-sounding agents. |
| Loading state | Definition-row skeletons; run status refreshes without replacing agent content. |
| Error state | Definition-list failure offers retry. Disabled/unavailable tools explain the unmet service prerequisite. |
| Responsive behavior | One-column rows/cards; tool allowlist wraps as text/badges without horizontal overflow. |

Agents are service orchestrators, not personas. Avoid avatars, rotating cores, “intelligence level,” fake skills, and simulated online state.

## 15. Agent Tasks

**Route / priority:** `/agents/tasks` and `/agents/tasks/:taskId` · `Later-3`

| Requirement | Specification |
|---|---|
| Purpose | Create, filter, and inspect durable bounded tasks and their real outcomes. |
| Primary action | `New task`. |
| Secondary actions | Filter by status/space/agent, open task/run, cancel when contract permits, retry as a new attempt. |
| Information hierarchy | Page title → filters → task rows with request summary, agent, space scope, durable status, created/updated time → result/run links. Task detail adds prompt, limits, attempts, final result/error. |
| Main components | PageHeader, form route/dialog, DataTable, StatusBadge, filter Selects, Pagination, Alert. |
| Empty state | `No agent tasks yet` with New Task only if at least one usable agent and scope exist. |
| Loading state | Task rows skeleton; running status comes from persisted job/REST plus validated realtime updates. No timer progress. |
| Error state | Failed tasks remain visible with safe error and trace link. Cancellation/retry failure stays contextual. |
| Responsive behavior | Mobile task rows show summary, status, agent, and time; filters open in a sheet; task detail stacks metadata before result. |

Task creation shows selected Research Space/Knowledge scope and agent limits before submission. It cannot offer tools unavailable to that agent or actor.

## 16. Agent Execution Trace

**Route / priority:** `/agents/runs/:runId` · `Later-3`

| Requirement | Specification |
|---|---|
| Purpose | Explain what observable work occurred in a run without exposing hidden chain-of-thought or secrets. |
| Primary action | None for a completed trace; `Cancel run` may be primary while a cancellable run is active. |
| Secondary actions | Retry as new run, open evidence/source, copy safe run ID, return to task. |
| Information hierarchy | Task/run breadcrumb → run status, agent, scope, start/end/duration → ordered steps → selected step detail → final result and citations/error. |
| Main components | PageHeader, StatusBadge, step list/timeline, TraceStep, definition lists, code/JSON viewer only for redacted safe input, Citation list, Alert. |
| Empty state | A queued run states that no steps have executed. A completed run with no steps is a data-integrity error, not a blank success view. |
| Loading state | Show persisted queued/running status and append validated steps without fabricated thinking text or decorative animation. |
| Error state | Failed step identifies tool, safe error, duration, and retained prior observations. Run failure remains truthful and actionable. |
| Responsive behavior | Wide screens use step list plus detail panel. Mobile uses ordered disclosure sections with detail immediately after its step heading. |

Allowed trace fields: tool, safe input summary, execution status, observation summary, duration, safe error, result evidence, citations, and final result. Prohibited: hidden reasoning, credentials, raw authorization, unrestricted document text, provider internals, or arbitrary model prompts.

## 17. Activity

**Route / priority:** `/activity` · basic screen in `MVP-2`, grows with real domains

| Requirement | Specification |
|---|---|
| Purpose | Show authorized, durable product events across implemented domains. |
| Primary action | None. Activity is inspection, not a dashboard action surface. |
| Secondary actions | Filter by real event type/status/space; open linked entity; load older events. |
| Information hierarchy | Page title → filters → reverse-chronological events with type, actor when allowed, subject, status, exact/relative timestamp, entity link. |
| Main components | PageHeader, filter controls, activity list, StatusBadge, Avatar when real, Pagination/load-more, EmptyState. |
| Empty state | Explain that important actions and system work will appear after they occur. No seeded security or system events. |
| Loading state | Event-row skeletons. Loading older events appends without moving focus unexpectedly. |
| Error state | Feed failure offers Retry. A linked resource that was deleted/inaccessible is labelled unavailable without leaking content. |
| Responsive behavior | Events become stacked rows; timestamp stays readable; filters use a sheet; entity link remains a real link. |

Product Activity is not debug logging or a security marketing surface. It must not expose raw payloads, secrets, document contents, or fake throughput.

## 18. Settings

**Route / priority:** `/settings` with later subsections · minimal in `MVP-1`, expand only as real preferences exist

| Requirement | Specification |
|---|---|
| Purpose | Manage profile and harmless user-interface preferences. |
| Primary action | `Save changes` within the active form. |
| Secondary actions | Cancel/reset changed form; account/session actions only when implemented and correctly secured. |
| Information hierarchy | Page title → optional `Profile / Preferences` secondary navigation → grouped forms → save feedback → separated account danger actions. |
| Main components | PageHeader, Tabs/side subnav only when multiple real groups exist, FormField, Input, Select, Button, Alert, Dialog. |
| Empty state | If no editable settings exist, do not expose Settings navigation. Never fill the page with nonfunctional toggles. |
| Loading state | Form skeleton before values load; save is localized and preserves fields. |
| Error state | Inline validation and form-level request error. Conflict/stale data prompts safe reload rather than silently overwriting. |
| Responsive behavior | One form column; subsection navigation becomes top tabs/select only when required; danger actions remain separated. |

Explicitly prohibited: client API keys, arbitrary provider base URLs, model secrets, authentication truth, fake streaming/temperature controls, nonfunctional theme choice, and security claims. Logout lives in the user menu rather than as the Settings primary action.

## Screen acceptance template

When a screen enters implementation, its pull request or task should answer:

1. Which route and delivery wave does it implement?
2. What real API fields and authorization rules power each visible value/action?
3. Which loading, empty, error, permission, success, disabled, partial, and offline states apply?
4. What is the evidence scope, if the screen displays generated or compared content?
5. How are URL state, back navigation, refresh, and cache invalidation handled?
6. How does it adapt at `320`, `768`, `1024`, and `1440px`, at 200% zoom, and with long content?
7. What is the keyboard path, focus behavior, accessible naming, and announcement strategy?
8. Which shared primitive is reused, and which domain composition remains feature-local?
9. What automated and manual tests prove the state is real rather than fixture- or timer-driven?
10. Has every visible future control been removed until its behavior exists?
