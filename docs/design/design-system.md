# ResearchWeave Design System Specification

## Purpose

This specification defines the visual and interaction primitives for future ResearchWeave UI. It is documentation only: no dependency or component library is installed in this phase. Product behavior and screen composition are defined in the accompanying [UI/UX specification](ui-ux-spec.md) and [screen specifications](screen-specifications.md).

## System principles

1. **Semantic before literal:** components consume semantic tokens, not palette names or raw hex values.
2. **Hierarchy before decoration:** spacing, type, alignment, and borders establish structure; shadows and accent color are scarce.
3. **Own the product surface:** external primitives may supply accessible behavior, but ResearchWeave owns component code, tokens, copy, and composition.
4. **Compact without becoming small:** information density comes from layout and grouping, not illegible text or tiny targets.
5. **Truthful state vocabulary:** visual states map to real domain or request states and always have a text equivalent.

## Token architecture

Use three layers:

```text
Primitive values (private palette / scale)
→ Semantic tokens (background, text, status, focus)
→ Component tokens (button background, input border, table row hover)
```

Feature code should use semantic or component tokens. Primitive color names such as `blue-600` must not appear directly in page components. Store semantic values as CSS custom properties so future theme work does not require component rewrites.

Recommended naming:

```css
--rw-color-background
--rw-color-surface
--rw-color-text-primary
--rw-space-4
--rw-radius-md
--rw-shadow-overlay
--rw-duration-fast
--rw-z-dialog
```

## Color system

### Direction

The first implementation should use a light, neutral-first palette with a restrained academic blue. Blue denotes selection, focus, and primary interaction—not generic decoration. Status colors are reserved for status. Surfaces remain opaque and distinct; blur is used only behind modal overlays if needed.

### Light-theme semantic tokens

| Token | Value | Intended use |
|---|---:|---|
| `color.background` | `#F7F8FA` | Application canvas |
| `color.surface` | `#FFFFFF` | Primary panels, dialogs, inputs |
| `color.surfaceMuted` | `#F0F3F7` | Secondary regions, selected neutral rows |
| `color.surfaceSubtle` | `#FAFBFC` | Quiet metadata and grouped headers |
| `color.overlay` | `rgba(17, 24, 39, 0.52)` | Dialog/drawer scrim |
| `color.border` | `#D8DEE8` | Standard separators and controls |
| `color.borderStrong` | `#AAB4C3` | Emphasized boundaries and active neutral controls |
| `color.textPrimary` | `#172033` | Titles and primary content |
| `color.textSecondary` | `#465268` | Supporting content |
| `color.textMuted` | `#667085` | Metadata; verify contrast for its exact surface and size |
| `color.textInverse` | `#FFFFFF` | Text on strong accent/status surfaces |
| `color.accent` | `#315FD5` | Primary actions, links, active indicator |
| `color.accentHover` | `#2448A8` | Accent hover/pressed |
| `color.accentSubtle` | `#E8EEFC` | Selected row/tab background |
| `color.accentText` | `#2448A8` | Text on accent-subtle surfaces |
| `color.success` | `#16734B` | Successful/ready state text and icon |
| `color.successSubtle` | `#E6F4ED` | Success state background |
| `color.warning` | `#8A4B08` | Warning/partial state text and icon |
| `color.warningSubtle` | `#FFF2D6` | Warning state background |
| `color.danger` | `#B42318` | Destructive action and error text/icon |
| `color.dangerHover` | `#8F1B13` | Destructive hover/pressed |
| `color.dangerSubtle` | `#FDECEA` | Error state background |
| `color.info` | `#175CD3` | Informational state distinct from selection by context/label |
| `color.infoSubtle` | `#EAF2FF` | Informational background |
| `color.focusRing` | `#2563EB` | Two-pixel keyboard focus ring |

These are implementation targets, not an assertion that every arbitrary pairing is accessible. Component acceptance must test the actual foreground, background, font size, weight, and state against WCAG AA. Muted text must not be used below `12px` or for essential instructions.

### Evidence-scope treatment

Evidence scope is semantic, not a success scale:

- `Abstract-based`: neutral outlined badge with a document/abstract icon.
- `Knowledge-base grounded`: accent-subtle badge with a citation/source icon.
- `No evidence`: warning-subtle badge with explicit text.
- Never use green merely to imply that generated prose is correct.

### Dark mode decision

Defer dark mode from the first application UI implementation. The product has many evidence, status, table, citation, and long-form reading combinations; shipping an untested token inversion would reduce credibility and accessibility. The semantic token architecture must support a later dark mapping, but dark mode should be implemented only after MVP screens pass light-theme contrast and interaction testing. Do not expose a non-functional theme control in Settings.

## Typography

### Families

| Role | Recommendation | Usage |
|---|---|---|
| Application | `IBM Plex Sans`, followed by `Segoe UI`, sans-serif | Navigation, forms, tables, controls, general prose |
| Research reading | `Source Serif 4`, followed by `Georgia`, serif | Paper titles, abstracts, quoted evidence, long-form generated results; not controls |
| Technical metadata | `IBM Plex Mono`, followed by `Cascadia Code`, monospace | IDs, models, tool names, durations, code, trace metadata |

Self-host only the required WOFF2 weights when fonts are introduced; use `font-display: swap` and reserve compatible metrics. Typography must remain usable with fallbacks and at 200% browser zoom.

### Type scale

| Token | Size / line height | Weight | Usage |
|---|---:|---:|---|
| `display-sm` | `36 / 44px` | 600 | Rare pre-auth or empty-state brand statement; never routine app pages |
| `heading-xl` | `30 / 38px` | 600 | Page title on spacious desktop layouts |
| `heading-lg` | `24 / 32px` | 600 | Default page title, dialog title |
| `heading-md` | `20 / 28px` | 600 | Section title |
| `heading-sm` | `16 / 24px` | 600 | Panel/card title |
| `body-lg` | `16 / 26px` | 400 | Reading and prominent explanation |
| `body-md` | `14 / 22px` | 400 | Default dense application body |
| `body-sm` | `13 / 20px` | 400 | Secondary row content and helper text |
| `label-md` | `14 / 20px` | 500 | Buttons, inputs, tabs |
| `label-sm` | `12 / 16px` | 500 | Badges and metadata labels |
| `caption` | `12 / 18px` | 400 | Nonessential metadata; never critical instructions |
| `code-sm` | `12 / 18px` | 400 | IDs and trace metadata |

Mobile form controls use at least `16px` input text to avoid browser auto-zoom. Long reading text should stay between 60 and 75 characters per line on desktop and 35 to 60 on mobile. Use tabular figures for durations, counts, dates in columns, and progress-stage metadata.

## Spacing and density

Use a 4px base with an 8px dominant rhythm.

| Token | Value | Typical use |
|---|---:|---|
| `space-0` | `0` | Reset |
| `space-1` | `4px` | Icon/text micro-gap |
| `space-2` | `8px` | Related controls, badge inset |
| `space-3` | `12px` | Compact row gap |
| `space-4` | `16px` | Standard control/panel gap |
| `space-5` | `20px` | Compact panel padding |
| `space-6` | `24px` | Default panel padding, tablet page gutter |
| `space-8` | `32px` | Desktop page gutter, section separation |
| `space-10` | `40px` | Major section separation |
| `space-12` | `48px` | Sparse pre-auth separation |
| `space-16` | `64px` | Rare page-level separation |

Density targets:

- desktop page header to content: `24px`;
- major sections: `32–40px`;
- card/panel padding: `20–24px`; compact metadata panels: `16px`;
- form fields: `16px` vertical gap, `24px` between logical groups;
- default data row: `48px` minimum; comfortable row: `56px`;
- touch layout controls and rows: `44px` minimum interactive height;
- table cell horizontal padding: `12–16px`.

Do not create a density toggle until real users and multiple dense views justify one.

## Shape, border, and elevation

### Radius

| Token | Value | Usage |
|---|---:|---|
| `radius-sm` | `4px` | Badges, compact code chips |
| `radius-md` | `6px` | Inputs, buttons, tabs |
| `radius-lg` | `8px` | Cards, menus, alerts |
| `radius-xl` | `12px` | Dialogs and large sheets |
| `radius-full` | `9999px` | Avatar and true status dot only; avoid pill-shaped containers everywhere |

### Border

- `border.default`: `1px solid color.border`
- `border.strong`: `1px solid color.borderStrong`
- `border.focus`: `2px solid color.focusRing` with `2px` offset where space permits
- Use separators to organize dense records. Avoid double borders between a container and all of its children.

### Shadow

| Token | Value | Usage |
|---|---|---|
| `shadow.none` | `none` | Default panels and tables |
| `shadow.raised` | `0 1px 2px rgba(23,32,51,.08), 0 4px 12px rgba(23,32,51,.06)` | Dropdowns, sticky overlays |
| `shadow.overlay` | `0 16px 40px rgba(23,32,51,.18)` | Dialogs and drawers |

Cards should normally use border plus surface contrast, not shadow. Glassmorphism is not part of the product system.

## Motion tokens

| Token | Value | Usage |
|---|---:|---|
| `duration.instant` | `100ms` | Press/color feedback |
| `duration.fast` | `150ms` | Hover, tooltip, compact menu |
| `duration.normal` | `180ms` | Tabs, dropdown, focus-adjacent state |
| `duration.slow` | `200ms` | Dialog, drawer, sidebar |
| `ease.enter` | `cubic-bezier(.16, 1, .3, 1)` | Entering overlays |
| `ease.exit` | `cubic-bezier(.7, 0, .84, 0)` | Faster exits |
| `ease.standard` | `cubic-bezier(.2, 0, 0, 1)` | State transitions |

Motion must express state or spatial relationship, remain interruptible, and use transform/opacity where possible. Under `prefers-reduced-motion: reduce`, remove nonessential transitions and animated skeleton shimmer.

## Layering

| Token | Value | Layer |
|---|---:|---|
| `z.base` | `0` | Normal content |
| `z.sticky` | `10` | Sticky page header/table header |
| `z.dropdown` | `30` | Menus, popovers |
| `z.drawer` | `50` | Mobile navigation and sheets |
| `z.dialog` | `70` | Modal dialog |
| `z.toast` | `90` | Toast region |
| `z.tooltip` | `100` | Tooltip |

No feature may invent a higher z-index to win a layering conflict. Fix the layer ownership instead.

## Breakpoints

| Token | Width | Intended transition |
|---|---:|---|
| `bp.sm` | `640px` | Small layout refinements; not the primary mobile/desktop boundary |
| `bp.md` | `768px` | Mobile to tablet; wider form/panel composition |
| `bp.lg` | `1024px` | Persistent collapsed navigation rail becomes viable |
| `bp.xl` | `1200px` | Expanded sidebar and standard desktop gutters |
| `bp.2xl` | `1440px` | Wider data/comparison/trace layouts only |

Components should respond to available space rather than assume a device. Support `320px` minimum viewport width, landscape mobile, browser zoom, and content expansion.

## Iconography

Recommend Lucide React when the implementation phase begins. Use one outline style, normally `1.75px` stroke, with token sizes `16`, `20`, and `24px`. Navigation combines icon and text; collapsed mode retains accessible name and tooltip. Icon-only buttons require an accessible label and `44 × 44px` hit target. Do not use emoji, pixel icons, Minecraft imagery, mixed icon libraries, or decorative AI sparkles as a default AI signifier.

## Core component system

Build only components needed by an accepted screen. The initial shared set should cover:

| Component | Required variants/behavior |
|---|---|
| `Button` | Primary, secondary, quiet, danger; small/default sizes; loading without width shift; disabled semantics. |
| `IconButton` | Quiet/default/danger; accessible name, tooltip when unfamiliar, `44px` target. |
| `Input`, `Textarea` | Default, invalid, disabled, readonly; visible focus; text never clipped at 200% zoom. |
| `Select`, `Checkbox` | Native semantics or accessible primitive; labels and validation remain outside the trigger. |
| `FormField` | Label, required indicator, description, field, inline error; connects IDs and error announcement. |
| `Card` / `Panel` | Default and interactive; an interactive panel is one link/button, not nested conflicting targets. |
| `Badge` | Neutral categorical metadata. Do not use for every noun. |
| `StatusBadge` | Status icon + text + semantic color; domain vocabulary supplied by feature. |
| `Tabs` | Same-resource sibling views; keyboard arrow navigation; URL-backed when view is shareable. |
| `DropdownMenu` | Secondary actions; keyboard navigation, typeahead where useful, focus restoration. |
| `Dialog` | Confirmation/small task; title, description, focus trap, Escape policy, return focus. |
| `Drawer` | Mobile navigation or secondary context; not primary desktop page navigation. |
| `Tooltip` | Supplemental label only; never sole home of required instructions. |
| `Toast` | Brief nonblocking confirmation; polite live region; critical errors also remain inline. |
| `Alert` | Info/success/warning/error; title optional; recovery action when applicable. |
| `Table` / `DataTable` | Semantic headers, sorting with `aria-sort`, row actions, loading/empty/error slots, responsive fallback. |
| `Breadcrumb` | Resource ancestry only; current page is text, not a link. Collapse middle items on narrow screens. |
| `PageHeader` | Title, description/context, status/evidence scope, primary/secondary action slots. |
| `EmptyState` | Specific title, explanation, one permitted action; restrained icon optional, no illustration required. |
| `Skeleton` | Mirrors real layout and preserves dimensions; no fake content. |
| `Spinner` | Compact action or unknown-shape wait; includes accessible status text. |
| `ErrorState` | Boundary-specific copy, retry/recovery, optional request ID. |
| `Pagination` | Cursor-aware previous/next or load-more; preserve filters and focus. |
| `SearchInput` | Real search only; visible or programmatic label, clear action, debounce when server-backed. |
| `Avatar` | Initials or real image; deterministic fallback; never used as online truth. |
| `Separator` | Semantic or decorative as appropriate; does not replace heading hierarchy. |

Domain-specific compositions—Citation, EvidenceScopeBadge, DocumentStatus, TraceStep, SpaceRow—belong in feature modules until at least two genuine consumers justify sharing.

## Component state contract

Every interactive component must specify and test:

- default, hover, active/pressed, keyboard focus, disabled, and loading where relevant;
- touch target and pointer cursor;
- keyboard interaction and Escape behavior;
- accessible name, role, state, and error association;
- high-contrast/forced-colors behavior;
- wrapping and localization expansion;
- reduced-motion behavior;
- no layout shift between default and pending state.

## Technology recommendation

Adopt the following only when the first formal application UI implementation begins:

1. **Tailwind CSS** for token-backed utilities and fast, consistent layout work.
2. **shadcn/ui-style source ownership** as a starting pattern, not a runtime dependency or final visual identity.
3. **Radix primitives selectively** for behavior-heavy controls such as Dialog, DropdownMenu, Tooltip, Select, and Tabs when native HTML is insufficient.
4. **Lucide React** as the single icon family.

This combination fits a Codex-developed React application because behavior remains inspectable, components stay inside the repository, accessibility primitives reduce repeated risk, and tokens can produce a recognizable ResearchWeave surface. It must not retain the default shadcn appearance: replace default palette, radii, spacing, typography, elevation, page composition, and copy with this specification.

Do not add a broad component suite, CSS-in-JS runtime, multiple icon sets, animation framework, or chart library preemptively. Add dependencies only in an implementation phase with a screen that requires them.

Suggested future ownership boundary:

```text
src/components/ui/       # reviewed low-level primitives
src/components/layout/   # shell, page header, responsive navigation
src/features/*/components/ # domain compositions
src/styles/tokens.css    # semantic custom properties
```

## Acceptance checklist

- No raw color literals in feature components.
- All text/surface and state combinations pass WCAG AA.
- One application font, one research-reading font, and one technical monospace role.
- Spacing follows the 4/8 scale; no arbitrary near-duplicate values.
- Default controls retain a `44px` target, visible focus, and stable pending state.
- Status and evidence scope never rely on color alone.
- Tables, dialogs, drawers, menus, and tabs meet keyboard semantics.
- Light mode is complete before a Dark Mode setting is exposed.
- Component primitives do not encode business vocabulary.
- No default-library aesthetic, fake data, decorative AI gradient, or game visual enters the product.
