# ResearchWeave UI/UX Specification

## Status and scope

This document is the product-level experience specification for ResearchWeave. It describes future UI behavior; it does not mean the screens or business capabilities are implemented. The approved architecture documents remain authoritative for domain, security, and evidence boundaries.

Read this document together with:

- [Design system](design-system.md)
- [Navigation and routes](navigation-and-routes.md)
- [Screen specifications](screen-specifications.md)

## Design direction: the evidence ledger

ResearchWeave should feel like a calm, precise research ledger: a durable place where people can move from a question to sources, collaboration, observable work, and a defensible result. It combines the order of a technical workspace with restrained editorial cues from academic publishing.

The memorable product signature is **visible provenance**. Source type, evidence scope, processing state, and operational status are placed close to the content they qualify. Thin rules, compact metadata, deliberate typography, and a restrained academic-blue accent reinforce this without imitating a paper document or terminal.

The interface should be:

- modern, professional, research-oriented, and engineering-literate;
- neutral-first and content-led rather than brand-effect-led;
- medium-to-high density with strong grouping and readable measures;
- AI-native because AI work is inspectable, not because the UI uses decorative AI motifs;
- credible during empty, partial, failed, and disconnected states.

It must not use Minecraft terminology or visuals, pixel art, HUDs, fake terminals, neon/cyberpunk effects, large decorative gradients, excessive glass effects, game achievements, or fabricated dashboards. Phase 1's editorial Foundation page is a useful provenance signal, but the authenticated application must be denser and more utilitarian than that introductory screen.

## Experience principles

### 1. Evidence before confidence

Every generated or compared result identifies its evidence scope. Use the exact labels `Abstract-based`, `Knowledge-base grounded`, or another architecture-approved scope. Never present abstract-only output as full-document analysis. Citations and source locators are part of the result, not decorative footnotes.

### 2. Context stays visible

When work belongs to a Research Space, the space name and the user's relationship to it remain visible in the page hierarchy. A deep link must restore the same resource and context after refresh, subject to authorization.

### 3. State is truthful

Empty collections remain empty. Durable work displays persisted stages and timestamps; it does not use timer-generated percentages. Failures identify the boundary that failed and provide a real recovery action. Partial success preserves completed evidence without claiming overall completion.

### 4. Density is structured

Prefer rows, compact panels, definition lists, and tables for comparable records. Use cards for bounded summaries, not as the default container for every element. Typography, rules, alignment, and spacing carry hierarchy before shadow or color.

### 5. One primary action

Each screen has one visually dominant action. Secondary actions use quieter buttons or menus. Destructive actions are separated spatially and require proportionate confirmation.

### 6. Progressive disclosure

Lists show the information needed to choose an item. Detail routes expose richer metadata. Advanced filters, provider diagnostics, traces, and destructive controls appear only where relevant.

## Application shell

### Authenticated desktop shell

The primary structure is one left sidebar plus one main application area. Tabs, breadcrumbs, and toolbars are contextual aids, not competing global navigation.

| Region | Specification |
|---|---|
| Expanded sidebar | `248px` wide at viewports `>= 1200px`; fixed to the viewport; subtle right border; no floating glass panel. |
| Collapsed sidebar | `72px` wide from `1024px` to `1199px`, or when the user explicitly collapses it; icons retain tooltips and accessible names. |
| Brand area | `56px` high, aligned with the sidebar grid. Use a restrained RW mark and wordmark; do not animate the logo. |
| Primary navigation | Stable destinations only. Active state uses accent, weight, and a left indicator—not color alone. |
| Sidebar footer | User menu and Settings. Logout is inside the user menu and visually separated from normal navigation. |
| Main area | Flexible width, minimum `0`, with one document scroll by default. No permanent top-level header in addition to the sidebar. |
| Page header | In content flow; breadcrumb when depth requires it, title, description/status, then actions. It may become sticky only on dense data/editor pages where the action context would otherwise be lost. |

```text
┌──────────────────────┬─────────────────────────────────────────────┐
│ Brand                │ Breadcrumb / context                        │
│                      │ Page title                   Primary action │
│ Primary navigation   ├─────────────────────────────────────────────┤
│                      │ Tabs or contextual toolbar (only if needed) │
│                      ├─────────────────────────────────────────────┤
│                      │                                             │
│                      │ Page content                                │
│                      │                                             │
│ User / Settings      │                                             │
└──────────────────────┴─────────────────────────────────────────────┘
```

### Content-width policy

| Page type | Width and gutter policy |
|---|---|
| Standard list/detail | Maximum content width `1200px`; desktop gutters `32px`; centered only when extra width exists. |
| Full-width data | Use all available main width with `24–32px` gutters; appropriate for tables, comparison, chat, and execution trace. |
| Reading/evidence | Text measure `680–760px`; citations or metadata may sit in an adjacent rail at wide breakpoints. |
| Forms | Primary form column `480–640px`; avoid stretching fields merely to fill the viewport. |
| Modal | Small `400px`, default `560px`, large `720px`; complex primary workflows should use routes instead. |

### Scrolling

- The main document owns vertical scrolling by default.
- The sidebar may scroll internally only when viewport height cannot contain navigation and the user region.
- Chat is the intentional exception: the message history scrolls inside a height-bounded workspace while composer and context header remain reachable.
- Execution Trace uses the document scroll on mobile and may use a bounded step list plus detail panel on wide screens.
- Avoid nested same-direction scrolling elsewhere. Sticky controls reserve space and must not cover focused content.

### Pre-authentication shell

Login and Register use a centered, quiet authentication frame rather than a marketing landing page. At desktop widths, a narrow brand/context column may sit beside a `400px` form column. The context column contains only the brand, one-sentence product description, and the principle of traceable research work—no pricing, testimonials, customer logos, feature carousel, or fake product screenshot. On mobile, the brand moves above the form and nonessential context is removed.

## Page anatomy

A page should use only the layers it needs, in this order:

1. optional breadcrumb for resource depth of two or more;
2. page header with title, concise context, status/evidence label, and actions;
3. optional tabs for sibling views of the same resource;
4. optional toolbar for search, filters, sort, and view controls;
5. primary content;
6. inline loading, empty, error, or permission state at the content boundary.

Do not render empty toolbars, placeholder search, disabled command bars, notification centers, online indicators, metrics, or filters before the corresponding behavior and data exist.

## State model

Every implemented page must explicitly design the applicable states below before it is accepted.

| State | Required behavior |
|---|---|
| Initial loading | Preserve the expected layout with a small skeleton when structure is known. Use a spinner only for compact, indeterminate actions. |
| Background refresh | Keep existing content; show subtle localized progress without replacing the page. |
| Empty | Explain what is absent and why it matters; offer one real next action if the user is allowed to perform it. Never inject samples. |
| Error | Name the failed boundary in user language, preserve safe existing content, offer retry/recovery, and show request ID when available. |
| Success | Confirm mutations near their origin; use a polite toast only when the result is no longer visible in context. |
| Disabled | Use semantic disabled behavior plus reduced emphasis and, when non-obvious, a reason. |
| Permission denied | Explain that access is unavailable without revealing the resource. Offer return navigation; do not silently render an empty collection. |
| Offline/disconnected | Only for network/realtime features. Preserve durable data, label stale/transient state, and recover through REST after reconnect. |
| Partial/durable work | Show backend-provided stage, last update, successful prior output, and safe failure. Do not infer completion from elapsed time. |

## Domain interaction rules

### Authentication

- Forms use visible labels, correct autocomplete attributes, password reveal controls, inline validation after blur or submit, and a stable form-level error region.
- While submitting, disable duplicate submission and keep the button label meaningful (`Signing in…`).
- An unauthenticated deep link records a safe internal return path, sends the user to Login, and returns after success.
- Session expiry preserves the intended route and unsent local text where safe, then explains why re-authentication is required.

### Research Spaces

- Use a compact list as the default because name, owner, role, member count, and last activity are comparable fields. A card grid is allowed only at very small collection sizes and must not show less information.
- Creating a space is a focused route, not a multi-step wizard. Required fields should be limited to the smallest backend contract.
- Space Detail keeps the space name and role visible while tabs switch among Overview, Chat, Members, and Settings.
- Show owner, member count, and last activity only after those values come from real APIs. Never synthesize them from client assumptions.
- Rename is a small form. Delete requires exact consequence text and an explicit confirmation; it must not be adjacent to routine actions.

### Knowledge and documents

- Document state vocabulary mirrors persisted stages such as uploaded, parsing, indexing, ready, and failed. Use indeterminate progress unless the backend exposes measurable progress.
- Failed indexing keeps the document record and offers retry/reindex where authorized.
- `Ask Knowledge` always shows the active knowledge-base scope. A no-evidence result is a valid result state and contains no generated answer.
- Citations are keyboard-reachable, include source name and locator, and open a stable source view where possible.

### Research

- Search results come only from real upstream responses and clearly distinguish empty from upstream failure.
- Paper Detail foregrounds title, authors, identifiers, dates, abstract, and canonical source links.
- `Abstract-based Summary` is the exact action/result label when only metadata and abstract were supplied.
- Full-document grounded analysis is unavailable until a corresponding imported document is indexed and must state that prerequisite.

### Agents

- Agent pages describe purpose, allowed tools, scope, limits, and real run status.
- Execution Trace shows observable operational steps: tool, safe input summary, status, observation, duration, error, evidence, and final result.
- Never display hidden chain-of-thought, simulated thought text, unrestricted prompts, secrets, or decorative “AI is thinking” streams.

### Activity

- Activity is a reverse-chronological feed of real product events with type, status, timestamp, actor when authorized, and an entity link.
- Filters appear only for event dimensions the API can query. No random throughput, security score, or decorative analytics.

## Responsive strategy

The layout adapts; it is not a scaled-down desktop canvas.

| Range | Behavior |
|---|---|
| `< 768px` mobile | Sidebar becomes a modal drawer opened from a `56px` top app bar. Content gutter is `16px`. Actions may move to an overflow menu or a safe bottom action region. |
| `768–1023px` tablet | Sidebar is a drawer by default; persistent collapsed rail is optional in landscape when space allows. Content gutter is `24px`. |
| `1024–1199px` compact desktop | Persistent `72px` rail with labels in accessible tooltips; `24px` content gutter. |
| `>= 1200px` desktop | Persistent `248px` sidebar and `32px` content gutter. |
| `>= 1440px` wide desktop | Preserve readable maximum widths; grant extra width only to data, comparison, chat, and trace layouts. |

Narrow-screen adaptations:

- **Tables:** keep identity and status columns visible; move secondary fields into an expandable row or record detail. Horizontal scrolling is a last resort for genuinely comparative numeric columns and must have a visible affordance.
- **Chat:** one column; conversation occupies the page, while members/context open in a drawer. The composer remains above safe-area insets.
- **Execution Trace:** step list becomes stacked disclosure items; step details follow the selected heading in DOM order.
- **Paper comparison:** each comparison dimension becomes a row with horizontally swipable paper cells only when necessary; also provide a single-paper stacked mode.
- **Dialogs:** destructive confirmations remain dialogs; large forms and detail workflows become full-screen routes or sheets.

## Accessibility requirements

- Meet WCAG 2.2 AA contrast: `4.5:1` for normal text and `3:1` for large text and meaningful UI graphics.
- All functionality is keyboard-operable. Focus order follows visual order, and route changes move focus to the main heading or main region.
- Provide a visible skip link, one `main` landmark, logical headings, real buttons/links, visible labels, and table semantics.
- Minimum pointer target is `44 × 44px`; dense desktop visuals may be smaller only when the interactive hit area remains at least `44px`.
- Focus uses the shared focus-ring token and is never removed without an equivalent.
- Status uses text and/or icon in addition to color. Icon-only controls have accessible names and tooltips where helpful.
- Dialog primitives must trap focus, close on Escape when safe, expose a labelled title/description, and restore focus to the trigger.
- Toasts use a polite live region, do not steal focus, and do not contain the only copy of critical information.
- Respect browser zoom, text scaling, `prefers-reduced-motion`, and forced-colors/high-contrast modes.

## Motion

Motion is functional and quiet. Use `150–200ms` transitions for hover, menus, dialogs, drawers, and sidebar state. Animate transform and opacity, not layout dimensions where avoidable. Exits may be slightly faster than entrances. Loading skeletons must not use continuous shimmer when reduced motion is requested; there are no cinematic page entrances, particles, pulses for stable status, rotating agents, or decorative loops.

## Content and language

- Prefer concrete verbs: `Create space`, `Retry indexing`, `View source`, `Run task`.
- Name the boundary: `arXiv could not be reached`, not `Something went wrong` when the boundary is known.
- Do not use “deep analysis,” “understands the paper,” or “grounded” unless the evidence contract supports it.
- Show timestamps in the user's locale while retaining precise UTC in machine contracts; relative time should expose an exact timestamp.
- IDs, models, durations, and trace metadata use monospace; prose and navigation do not.

## Design governance

Before implementing a future screen, read all four design documents and the relevant architecture section. A deviation is acceptable only when a real user flow or technical constraint proves the specification wrong. Record material cross-product changes in these documents; do not fork one-off visual systems inside feature folders.

Definition of UI-ready for a screen:

1. its route, authorization, and space context are defined;
2. required backend fields are real or the screen is explicitly gated;
3. loading, empty, error, permission, and responsive behavior are specified;
4. evidence and durable-status labels match server contracts;
5. keyboard, focus, target size, and contrast behavior are testable;
6. no fixture, timer, fake metric, or unsupported control is needed to make it look complete.
