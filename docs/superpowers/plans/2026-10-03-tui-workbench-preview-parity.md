# TUI Workbench preview parity — phased implementation plan

Status: Implementation authorized 2026-10-03; Phases 0–1 readiness complete; Phases 2–3 geometry/chrome complete. Phases 4–10 pending their exit gates.
Design: [2026-10-03-tui-workbench-preview-parity-design.md](../specs/2026-10-03-tui-workbench-preview-parity-design.md).
Baseline: cd7fadeed127a6c0918c4bbb10414531b9ed7f70, PR #848 merged.
Reference: [ALiX Workbench Terminal Preview](../../../ALiX%20Workbench%20Terminal%20Preview.png), 1774 × 887 pixels. Preserve and track the byte-identical original with Phase 0.

Implementation progress:

- Plan baseline committed as 00b2677a on feat/tui-workbench-preview-parity.
- Phase 0 foundations: reference provenance/design decisions, event fixture and coverage ownership below. Fixture carries 38 actual events, five current agents/three running, 13 pictured transcript groups, two evidenced artifacts, and a distinct active write with 18 seconds elapsed.
- Phase 1 theme readiness complete: semantic theme and lifecycle labels implemented with truecolor, ANSI-16, monochrome and ASCII/Unicode capability choices. Existing region painters are not switched yet; visual parity remains pending.
- Phase 1 dependency readiness: task rows preserve structured dependency IDs and distinguish dependency/approval waits from running work; coordination assignment events supply these facts and the task drawer reports waiting totals.
- Phase 1 tool-card readiness: shared traces and Workbench tool items preserve bounded requested path/range, call identity, start time and explicit observed counts. Replay and version-one checkpoints preserve detached metadata; previews never supply inferred counts.
- Phase 1 live-read readiness: file reads measure actual LF-delimited returned lines and executor completion events carry those counts before preview truncation, including known zero for empty files. Patch/write counts remain unavailable without their own authoritative producer.
- Phase 1 source/fallback audit complete: every image datum has an existing projection source or explicit unavailable fallback, per the phase exit. Active-tool elapsed time is clock-sampled from its authoritative start; snapshot nesting is detached. Current worker-context consumption and patch/write line counts remain unavailable, not readiness blockers. Existing file reads do not execute requested line ranges; later painters must label them as requested. Live view integration belongs to the corresponding region phases.
- Phase 2 geometry complete: shared named regions, left roster/center transcript/right inspector reservation at ≥160×36, full-width bounded composer, pane clipping, semantic resize anchors and matching hardware caret. Inspector section data, preview controls and coordination launch remain pending.
- Phase 3 chrome complete: cyan brand/live PREVIEW badge, responsive workspace/mode/session-roster groups, accented keyboard hints, uppercase right-aligned counters, explicit unavailable telemetry and close/cancel/decision priority. Semantic theme alternatives and unchanged-row diff behavior verified.
- Operator branding amendment (refined to one row): bold cyan single-row text title replaces the block banner at every width. Header divider removed without moving panes or composer.
- Phases 4–10 pending.

## Objective

Implement every visible part of the image as a working operator experience: branded header; left agents/tasks navigation; center live transcript, filters and tool cards; right selected-agent inspector; full-width composer; keyboard hints and counters. Retain the custom ANSI canvas, event-derived truth, approvals, exact callable tool names, cancellation, Unicode editing, queued follow-ups, artifact containment and feature-gated legacy compatibility.

Each image element has a coverage ID below. Implementation PRs must report the IDs they complete, data provenance, interaction behavior, fallback states and test/visual evidence. A static image-shaped mock does not complete the plan.

## 1. Verified baseline and change boundaries

| Existing paths | Reuse | Gap |
| --- | --- | --- |
| src/tui/workbench/model/operator-shell.ts; views/operator-shell.ts | Workspace, mode and counter projection; shell painter | Quiet three-row chrome differs from cyan preview header/footer. |
| src/tui/workbench/layout/responsive-layout.ts | Shared geometry functions | Current drawer is on the right; no simultaneous left roster, center transcript and right inspector. |
| src/tui/views/agent-view.ts | Streaming, inline approvals and Workbench integration | Current gutter/composer assume surface starts at column zero; adapt to region rectangles. |
| src/tui/frame-painter.ts; src/tui/views/scroll-math.ts | Frame composition, cursor and anchoring | All must consume identical new geometry; preserve legacy paths. |
| src/tui/workbench/model/ui-state.ts; model/ui-action.ts; app/workbench-store.ts | Reducer, focus, selection and FIFO queue | Add category filter, inspector scrolling, tool expansion and explicit transcript scope; reconcile follow-tail adapters. |
| src/tui/workbench/projections/conversation-projection.ts; model/transcript-item.ts; views/workbench-scrollback.ts | Semantic ordering, source ranges and tool lifecycle | Current tools are summary rows; add actor/time columns, activity rows and typed card metadata. |
| src/tui/workbench/projections/agent-roster-projection.ts; task-projection.ts | Identity, task assignments, active tools, usage and liveness | Join projections for sidebar/inspector; verify producer support for dependency/card details. |
| src/tui/workbench/views/roster-drawer.ts | Run navigation, roster and artifact inspection | Replace wide presentation with left roster plus separate right inspector; preserve compact drawers. |
| src/tui/workbench/model/selection.ts; projections/artifact-projection.ts; views/approval-dialog.ts | Strict artifact scope and authoritative approvals | Inspector summaries must preserve containment and projection-confirmed decisions. |
| src/tui/workbench/input/input-router.ts; src/tui/app.ts | Typed intents, submit/queue/cancel | Contextual new controls, global Tab behavior and raw-key decoding. |
| src/tui/workbench/views/composer-view.ts; render/frame-differ.ts; src/tui/terminal-text.ts | Multiline/grapheme layout and row diffs | Full-width boxed composer, theme and caret regression coverage. |

Evidence: current source inspected at baseline. GitNexus concept query returned no results; named shell context and geometry/input impact queries succeeded. Index is three commits behind HEAD, so graph completeness is provisional and source is authoritative.

**HIGH geometry impact:** resolveWorkbenchSurfaceGeometry has graph-reported direct callers AgentView.render, FramePainter.paintFullFrame and computeBottomAnchor. Current source also invokes geometry for frame cursor placement. Phase 2 must account for all these paths. Affected upstream processes include raw input, dispatch, foreground session dispatch and Workbench input. routeWorkbenchInput impact is LOW; direct caller is handleWorkbenchAgentInput. Before implementation, recheck freshness and rerun impact for each actual source symbol; this plan is not a substitute for pre-edit analysis.

## 2. Complete image coverage ledger

Phase numbers identify primary delivery. Phase 10 verifies every ID together.

| ID | Visible element | Required capture | Phase |
| --- | --- | --- | --- |
| V01 | Near-black blue background | Opaque dark fill where supported; terminal-default fallback. Texture/glow limitations documented. | 1 |
| V02 | Cyan pane outlines | Thin single-cell borders, aligned pane tops/bottoms, narrow gutters, inset headings. | 1–2 |
| V03 | Typography and spacing | Monospace, bright primary text, muted blue-gray secondary text, bold cyan headings, aligned columns. | 1 |
| V04 | Accent palette | Cyan focus, green running/success, yellow waiting/progress, purple role/completion; readable text/glyph alternatives. | 1 |
| H01 | ALiX WORKBENCH | Prominent cyan brand; preserve mixed-case ALiX. | 3 |
| H02 | CONCEPT PREVIEW | Exact demo badge; honest preview badge in real feature-gated usage until rollout. | 3 |
| H03 | workspace: and absolute path | Muted label, cyan path, suffix-preserving ellipsis, no status collision. | 3 |
| H04 | Header pipes | Separate workspace, mode and count groups; omit punctuation for omitted groups. | 3 |
| H05 | bypass | Live auto/ask/bypass mode, never hardcoded. | 3 |
| H06 | 4 agents • 3 running | Green derived count group; resolve inconsistent image totals in Phase 0. | 3 |
| L01 | AGENTS & TASKS | Cyan left heading; agent and task remain distinct read models. | 4 |
| L02 | All agents, hollow circle, / | Aggregate selection and count subtitle; slash selects aggregate only with roster focus. | 4, 8 |
| L03 | Aggregate divider | Muted horizontal rule with consistent inset. | 4 |
| L04 | Orchestrator, purple ring, 1 | Coordinator identity; Coordinating execution subtitle. Role accent distinct from status. | 4 |
| L05 | backend-agent, green dot, RUNNING, 2 | Build API endpoints subtitle; structured state/task facts. | 4 |
| L06 | Selected frontend-agent, green dot, RUNNING, 3 | Cyan rectangular outline and teal fill covering both lines; Implement responsive sidebar subtitle. | 4 |
| L07 | test-agent, yellow dot, WAITING, 4 | Depends on frontend-agent subtitle from structured dependency facts. | 4 |
| L08 | Divider before completed reviewer | Preserve visual separation shown between waiting and completed rows. | 4 |
| L09 | review-agent, purple dot, COMPLETED, 5 | Review changes and summarize subtitle; terminal rows remain inspectable. | 4 |
| L10 | Divider and Coordination Run, hollow circle, c | Start a coordinated run subtitle; opens objective entry, never executes on mere selection. | 4, 9 |
| L11 | Sidebar padding/empty space | Two-line rows, breathing room, overflow scroll; bottom action remains reachable. | 2, 4 |
| T01 | LIVE TRANSCRIPT | Cyan title inside center border. | 5 |
| T02 | ALL active chip | Cyan fill/dark text, selected indicator, default eligible semantic rows. | 5 |
| T03 | RESPONSE / TOOL / ACTIVITY / ERROR | Muted outlined chips, keyboard activation; category independent of compact/detailed mode. | 5, 8 |
| T04 | Auto-follow: ON | Muted label, green ON; OFF/new-item indicator after manual scroll; explicit resume. | 5, 8 |
| T05 | [10:14:21] timestamps | Fixed column, defined timezone, continuation alignment without repeated timestamps. | 5 |
| T06 | Purple orchestrator actor | Identity/role accent independent of lifecycle status. | 5 |
| T07 | Teal worker and yellow waiting actor labels | Authoritative actor identity, consistent through message/card groups. | 5 |
| T08 | Inline RUNNING / WAITING | Event-derived labels, never parsed from prose. | 5 |
| T09 | Every prose row | Preserve all reference groups in §3, wrapping and meaningful ellipses. | 0, 5 |
| T10 | Green check on initialization | Verified outcome glyph, not decorative false success. | 5 |
| T11 | Vertical guides/elbow connectors | Parent actor/turn association and clipping at viewport boundaries. | 6 |
| T12 | First TOOL file.read card | Cyan badge/name; green ✓ success; path src/components/sidebar.tsx; lines 1–200; right count (142 lines). | 6 |
| T13 | Second TOOL file.write card | Same structure; path src/components/right-sidebar.ts; lines 1–287; count (287 lines). Display alias only. | 6 |
| T14 | Card dividers and metadata columns | Vertical separator under badge and before right counts, indented body, full rectangular outline. | 6 |
| T15 | Wrapped implementation message | variants for collapsed and expanded states. aligns with body, not actor/time. | 5 |
| T16 | Waiting dependency continuation | Dependency: src/components/right-sidebar.ts attached to test-agent; grants no path authority. | 5 |
| T17 | Center bottom empty space | Stable viewport/tail anchor; no painting into composer/footer. | 2, 5 |
| R01 | AGENT DETAILS | Cyan separate inspector heading; aggregate/missing-selection fallback. | 7 |
| R02 | Name / frontend-agent | Selected authoritative identity, two-column labels/values. | 7 |
| R03 | Model / coding model | Actual resolved model live; illustrative placeholder only in fixture. | 7 |
| R04 | State / green executing | Derived display state with waiting/failed/cancelled alternatives. | 7 |
| R05 | Task / implement responsive sidebar | Structured assignment; wrap safely within border. | 7 |
| R06 | Divider and LIVE ACTIVITY | Active tool section separate from completed cards. | 7 |
| R07 | Tool / file.write | Friendly display identity; canonical tool available in details; no callable alias. | 7 |
| R08 | Started / 10:14:28 | Authoritative active-call start time. | 7 |
| R09 | Elapsed / 00:18 | Clock-derived/clamped duration; tick without replaying events. | 7 |
| R10 | Status / yellow writing file... | User-safe progress; unknown fallback and correlated terminal reset. | 7 |
| R11 | Divider, APPROVALS, No pending approvals | Scoped authoritative cards/count; unavailable distinct from none; global pending alert survives filters. | 7 |
| R12 | Divider, ARTIFACTS, two filenames | right-sidebar.ts and sidebar-layout.test.ts; actual correlated outputs live, navigable bounded inspection. | 7–8 |
| R13 | Divider and USAGE | Own section with muted labels. | 7 |
| R14 | Tokens / 7,352 | Selected-agent known usage, separator; explicit zero stays zero. | 7 |
| R15 | Context / unavailable | No fabricated percentage or historical-token/window inference. | 7 |
| R16 | Cost / unavailable | Known, partial and unknown distinct; no invented zero cost. | 7 |
| C01 | Full-width cyan composer box | Below all panes, independent of drawer width, bounded multiline growth. | 2, 8 |
| C02 | Cyan > and placeholder | Add your next instruction... only while empty; caret after prompt. | 8 |
| C03 | Composer during active work | Submit/queue/FIFO, newline, grapheme editing, paste and cancellation remain usable. | 8 |
| F01 | Tab views | Cyan key/muted description; actual global view switching. | 3, 8 |
| F02 | Ctrl+O details | Keep existing compact/detailed toggle and tool detail behavior. | 3, 6, 8 |
| F03 | Ctrl+R artifacts | Existing scoped artifact/result surface. | 3, 8 |
| F04 | Esc cancel | Context-sensitive close/cancel; normal runtime cancellation semantics. | 3, 8 |
| F05 | Footer bullets/pipes | Accurate spacing/punctuation without overlap or clipped key names. | 3 |
| F06 | TOKENS 7,352 / FILES 2 / EVENTS 80 / AGENTS 4 | Right-aligned scoped totals; event count differs from visible rows. | 3 |

### Coverage ownership and evidence status

Each ID in a grouped range inherits the same responsible boundary, planned test and visual status. This assigns all 63 IDs without treating foundation tests as finished rendering evidence. Owners are repository modules, not transient agent names. New test names below are marked proposed.

| IDs | Owning boundary | Test evidence or planned extension | Visual status |
| --- | --- | --- | --- |
| V01–V04 | model/preview-theme.ts plus region painters | preview-theme.vitest.ts: fallback glyph width, lifecycle text and bounded color capabilities pass; region goldens pending | Pending integration |
| H01–H06, F01–F06 | model/operator-shell.ts; views/operator-shell.ts | operator-shell.vitest.ts; input-router.vitest.ts for key behavior | Pending |
| L01–L11 | views/roster-drawer.ts; agent/task projections | responsive-drawer.vitest.ts; agent-task-projections.vitest.ts; work-surface-integration.vitest.ts | Pending |
| T01–T10, T15–T17 | conversation projection; scrollback; proposed transcript toolbar | preview-fixture.vitest.ts covers all pictured groups; workbench-scrollback.vitest.ts and conversation-projection.vitest.ts rendering extensions pending | Pending |
| T11–T14 | proposed views/tool-card.ts; transcript model/projection | preview-fixture.vitest.ts covers lifecycle/ranges/counts; proposed tool-card.vitest.ts for geometry | Pending |
| R01–R16 | proposed agent-inspector model/projection/view | preview-fixture.vitest.ts covers source facts; proposed agent-inspector.vitest.ts for joins/rendering | Pending |
| C01–C03 | views/composer-view.ts; input/input-router.ts; app/workbench-store.ts | composer-view.vitest.ts; input-router.vitest.ts; work-surface-integration.vitest.ts; actual PTY additions pending | Pending |

Paths in this table are relative to src/tui/workbench or tests/tui/workbench. Phase 10 attaches captures and per-ID pass/fail evidence to these assignments.

## 3. Coherent reference fixture and intentional differences

Create scripted events, fixed clock, fixed workspace, stable IDs and a fixed timezone. Preserve these visible transcript groups in order:

1. 10:14:21 orchestrator — Planning phase complete. Dispatching tasks to agents...
2. 10:14:22 orchestrator — ✓ 4 agents initialized (3 running, 1 waiting)
3. 10:14:22 backend-agent RUNNING — Building API endpoints for sidebar data...
4. 10:14:24 frontend-agent RUNNING — Starting implementation of responsive sidebar...
5. 10:14:24 frontend-agent — Analyzing existing layout structure and components.
6. 10:14:25 frontend-agent — Reading current sidebar component for context.
7. 10:14:25 frontend-agent — successful read card: sidebar.tsx, requested 1–200, observed 142 lines.
8. 10:14:27 frontend-agent — Identified component structure. Implementing responsive / variants for collapsed and expanded states.
9. 10:14:28 frontend-agent — Writing updated sidebar component with responsive behavior...
10. 10:14:28 frontend-agent — successful write card: right-sidebar.ts, range/count 1–287/287.
11. 10:14:30 test-agent WAITING — Waiting for frontend-agent to complete. / Dependency: src/components/right-sidebar.ts
12. 10:14:30 backend-agent — Continuing with API implementation...
13. 10:14:31 frontend-agent — Rendering the selected agent details...

Slash in this list indicates a wrapped continuation, not literal transcript text. Fixture paths describe the image's example workload; they are not ALiX files to create.

Resolve these contradictions explicitly:

- Image lists coordinator plus four workers but says four agents/three running. Proposed live semantics: count all visible executable agents, producing five agents/three running if coordinator is actively running. Alternative: label workers explicitly and show four workers/two running. Choose in Phase 0; header/aggregate/footer agree. Literal inconsistent values may exist only in a clearly labeled reference mock, never live telemetry.
- Selected frontend coexists with all-worker transcript. Current DOX filters transcript by selected agent. Proposed amendment: inspector selection and transcript scope are independent; explicit all-agent scope is default, selected-agent scope is optional. Preserve strict selected-run/artifact correlation and unknown-correlation operator/approval visibility. Accept and amend TUI DOX before this behavior ships; retain current behavior until then.
- Successful write card and live writing status cannot represent one call simultaneously. Use distinct call IDs or show last completed activity honestly. Fixture elapsed 00:18 from 10:14:28 requires current clock at least 10:14:46 even though latest message is 10:14:31; older latest prose is valid.
- Read range 1–200 and actual 142 lines are different valid facts. Do not “correct” observed count to requested count.
- sidebar-layout.test.ts has no visible creating card. Supply an earlier authoritative artifact event in the fixture; filenames alone are not evidence.
- file.read/file.write are display vocabulary. file.write must not become a guessed executor or callable alias. Live names come from registered identity; exact offered alix_* or opaque mcp__* remain mandatory in model dispatch/audit.
- Model coding model is illustrative. Actual provider/resolved model or unavailable belongs in live inspector.
- Inspector usage is agent-scoped; footer usage is session-scoped and deduplicated. Matching 7,352 values are fixture coincidence.
- ANSI terminals cannot reproduce font-size variation, anti-aliasing, texture, glow or fractional rounded corners. Match cell layout, hierarchy, palette, borders, spacing and density; document rendering deviations and provide ASCII/low-color alternatives.

## 4. Geometry, focus and data contract

One geometry result returns rectangles for header, left roster, transcript toolbar/body, inspector, composer, footer and overlays, including origin, border, inner bounds and clipping. All paint/wrap/scroll/cursor paths consume it. Composer spans full content width. Cursor origin translates once. Preserve global legacy constants for legacy views; do not force them onto new Workbench geometry.

| Proposed terminal size | Layout | Required behavior |
| --- | --- | --- |
| ≥160 columns, ≥36 rows | Three persistent panes | Approximate image body ratios 21%/53%/24% after border/gap budgets; verify readable center. |
| 120–159 columns | Center plus one side region; other overlays | Preserve existing side-drawer availability and explicit inspector access. |
| 80–119 columns | Center primary, side surfaces overlay | Toolbar may use compact chooser; composer/cancel remain accessible. |
| <80 columns or short height | Single surface, compact metadata | Scroll/collapse side sections; no negative geometry or hidden approval actions. |

Golden matrix: 200×44 canonical; 180×40, 160×36, 159×36, 140×32, 120×30, 119×30, 100×28, 80×24, 79×24, 60×20 and tiny-window fallback. Thresholds are proposed, not existing shipped behavior. Fixed-font screenshot comparison uses recorded cell dimensions; image pixels do not prescribe terminal columns.

Keyboard contract proposed for design approval:

- Preserve Tab app views; Ctrl+A/T/R drawers; Ctrl+O details; Shift+Tab permission mode; Enter submit/queue; Shift+Enter newline; first Ctrl+C cancellation.
- Add explicit documented focus-cycle binding, proposed Ctrl+F after conflict audit: roster → transcript controls → inspector → composer. Digits, / and c act as roster shortcuts only there; ordinary composer text always inserts normally. More than nine agents remain reachable through scrolling, not ambiguous multi-digit autoexecution.
- Transcript controls use arrows/Enter for chips and follow toggle. Transcript body scroll unpins; End resumes tail. Inspector scrolls sections; Enter on artifact opens existing bounded read-only inspection.
- Escape closes top overlay/drawer first, otherwise cancels foreground work. Ctrl+C cancellation remains reachable from every focus; footer describes current action.
- Preserve approval input priority and test a/d against composer text; do not widen authorization shortcuts accidentally. Mouse support is optional follow-up, not required to make pictured controls accessible.

Data requirements:

- Map every field to producer event/schema, correlation keys, timestamp, replay behavior and unknown fallback. Existing roster/task/artifact/approval projections supply many fields; richer card metadata and dependencies need producer audit.
- Tool cards need call/agent IDs, exact identity, lifecycle, start/end, safe operation/path preview, requested range, actual line count, bounded output and source range. Never infer success/state/permissions/ownership from prose.
- Missing producer metadata receives a minimal typed extension with impact/DOX/tests, or explicit unavailable. Painters never reinterpret raw events or read files.
- Semantic categories: RESPONSE user/assistant/plan prose; TOOL cards/lifecycles; ACTIVITY user-safe progress/lifecycle/dependency rows; ERROR failures/error diagnostics. ALL is their union; tool failures belong to TOOL and ERROR. Pending approval actions survive category filtering.
- Preserve event order, audit ranges, canonical actor identity, retry/resume distinction and deduplication. Streaming/landed prose must not duplicate.
- Never expose private reasoning. Image analysis phrases must originate as explicitly user-safe activity/prose.
- Active tool terminal updates match call ID; orphan events never clear another tool. Elapsed ticks introduce no agent deadlines or termination.
- Artifacts use event-provided previews and strict scope; model filenames grant no read authority. Context uses authoritative measurements, not historical usage divided by window. Unknown, zero and partial facts remain distinct.
- FILES counts authoritative changed paths, not artifact/result count; EVENTS counts source events, not filtered rows. Counters state session/run/agent scope explicitly where ambiguous.

Proposed new boundaries under src/tui/workbench, not existing files: model/preview-theme.ts; model/transcript-filter.ts; model/agent-inspector.ts; projections/agent-inspector-projection.ts; views/agent-inspector.ts; views/transcript-toolbar.ts; views/tool-card.ts. Prefer extending existing read models; never introduce a parallel event truth store.

## 5. Delivery phases

Each phase is a small PR or commit series. Impact precedes symbol edits; complete graph change analysis precedes commits. Review order: image/spec compliance, then code quality/regressions. Exit gates block dependent phases.

### Phase 0 — Reference and decisions

Dependencies: none. Coverage: all IDs inventoried; T09 fixture.

1. Preserve approved reference asset; record hash/dimensions, canonical terminal size, font and capture settings.
2. Create dated design spec in docs/superpowers/specs; link plan to it. Approve count, scope, label, clock, live/completed activity, badge and terminal deviation decisions.
3. Create test-only scripted fixture with every §3 row, selected frontend, roster states, two cards, two evidenced artifacts, tokens and unknown context/cost.
4. Record coverage ID → owner → tests → visual state; distinguish literal reference mock from coherent event-backed acceptance fixture.

Exit: no missing image element, approved decisions, coherent live counts and clock, reference available from clean checkout. Commit: docs(tui): define preview parity contract.

### Phase 1 — Theme and metadata readiness

Dependencies: 0. Coverage: V01–V04; provenance for all data-bearing IDs.

1. Define palette, borders, row fill, labels, role/status accents, ASCII and low-color variants.
2. Audit producer→projection fields for time, dependencies, model, tool metadata, artifacts and usage. Record every unsupported image field and resolution.
3. Add only necessary typed producer fields/read models; read local DOX and impact before edits outside TUI.
4. Test malformed/missing fields, replay idempotence, known zeros, call/actor correlation and canonical names.

Exit: every datum has verified source or unavailable fallback; no new callable aliases. Commit: feat(tui): prepare preview read models.

Phase 1 final source/fallback audit:

| Image datum | Source / readiness | Missing-data resolution |
| --- | --- | --- |
| Workspace, permission mode | Dashboard/operator shell snapshot and explicit live mode | No invented workspace or policy authority; region phase tests must distinguish unavailable snapshots. |
| Agent identity, role, model, state, task | Canonical roster events, usage resolved-model metadata, separate task projection | Missing model/task remains unavailable; display labels never become callable aliases. |
| Dependencies and waiting | Coordination assignment dependency IDs and typed waiting states | Missing relationship remains unknown; no dependency inferred from prose. |
| Time and live activity | Event timestamps, active call identity/start, snapshot clock | Current elapsed advances without tool output and never changes progress time; absent active call means no measured live tool. |
| Tool path, requested range, observed lines | Bounded requested-event metadata; full-read result count → completion event → shared trace | Requested range is labeled requested. Missing path/range stays absent; patch/write counts show unavailable. No preview recount. |
| User-safe activity prose | Structured progress operation; fixture transcript groups | Never synthesize private reasoning; live transcript grouping integrates in Phase 5. |
| Approvals | Authoritative approval projection and preserved pending-card snapshot | Unknown/stale snapshot differs from authoritative empty; Phase 7 paints the availability state. |
| Artifacts | Strictly scoped artifact projection and existing bounded preview | Missing evidence is no artifact; no file read from painters. |
| Agent tokens and cost | Agent-scoped usage, known totals/coverage, explicit zero | Partial coverage stays explicit; absent cost/token value remains unavailable. |
| Current context consumption | No worker-correlated current-consumption measurement; context budget/assembly events carry invocation identity only | Unavailable. Capacity and lifetime usage are not consumption. Future measurement needs its own producer/correlation contract. |
| Footer tokens/files/events | Existing session metrics, mutation facts, EventLog total count | Never use artifact count as file-change count or agent tokens as session total. Missing session metrics require unavailable presentation in Phase 3. |
| Theme/glyph/label capabilities | Tested semantic palette, ANSI-16/monochrome and ASCII/Unicode choices | Status labels remain readable without color; painter integration remains region work. |

Verification: preview fixture, theme, task/agent, metadata/replay/checkpoint, live-read producer and bootstrap tests. These establish readiness, not geometry or visual parity.

### Phase 2 — Responsive geometry

Status: Complete 2026-10-03. Dependencies: 1. Coverage: V02, L11, T17, C01 (geometry only; final theme/content remain in their owning phases).

Evidence: 233 affected Vitest cases passed across the broader run plus corrected 12-case integration rerun; build, unused-code, dead-module and DOX checks passed. Real PTY verified resize/caret at 200×44 → 160×36 → 140×24 → 79×20 → 200×8 → 4×3 → 1×1 → 200×44. Spec/code-quality review identified short open-drawer overflow; bounded writes and agents/tasks/artifacts regression cases resolve it. Inspector currently paints its reserved frame/title only.

1. Add named regions and shared clipping, pane widths and full-width composer.
2. Update AgentView, FramePainter painting/cursor paths and computeBottomAnchor together; preserve feature-disabled legacy geometry.
3. Composer growth reallocates body height without covering pane content/actions/footer.
4. Test all dimension boundaries, overlays, short windows and resize; retain anchor by semantic item ID plus wrapped offset.

Exit: no overlap/negative geometry; painted caret matches terminal cursor; resize retains selection/anchor. HIGH impact gate: PTY resize/cursor verification. Commit: feat(tui): add three-pane geometry.

### Phase 3 — Header and footer

Status: Complete 2026-10-03. Dependencies: 2. Coverage: H01–H06, F01–F06.

Evidence: affected Workbench/bootstrap/status coverage totals 249 cases; broad run passed 248 and the corrected legacy-footer assertion passed in its focused file rerun. Build, unused-code, dead-module, DOX and eight-size real PTY checks passed. Spec-compliance and code-quality review passed. Chrome-update tests verify stable frames emit no patches, event totals repaint only footer, and lifecycle totals repaint header only. Live telemetry remains session-scoped; inspector data remains Phase 7.

1. Implement brand/badge/workspace/mode/counts and right-aligned counters.
2. Implement exact hint labels, accent keys, bullet/pipe separators and width-pressure priority: approval/cancel/mode before secondary counters.
3. Ensure lifecycle transitions update summaries and clock ticks repaint only changed rows.

Exit: canonical chrome matches image hierarchy; no narrow collisions; totals follow chosen scope. Commit: feat(tui): render preview chrome.

### Phase 4 — Left agents/tasks roster

Dependencies: 2–3. Coverage: L01–L11.

1. Add aggregate/coordinator/worker rows, dots, words, number shortcuts, two-line tasks, dividers and selected outline/fill.
2. Join task labels/dependencies with agents using identity; preserve duplicate roles/retries.
3. Add alternatives for queued/starting/verifying/approval-wait/dependency-wait/partial/failed/cancelling/cancelled/stalled states.
4. Keep run cycling, aggregate state, scroll overflow and reconciliation; coordination entry remains accessible.

Exit: every reference row visible wide; low-color focus identifiable; selection never executes work. Commit: feat(tui): add preview roster.

### Phase 5 — Transcript and controls

Dependencies: 1–4. Coverage: T01–T10, T15–T17.

1. Add toolbar, category chips and auto-follow control/indicator.
2. Project actor/time/activity metadata with stable IDs/source ordering.
3. Render aligned time/actor/status/body; stacked narrow prefixes and content-aligned continuations.
4. Implement category and all/selected-agent scope independently of details mode, only after approved DOX amendment.
5. Reconcile one authoritative follow state with legacy viewport adapter; retain anchors during append/filter/resize; show new-item count when unpinned.

Exit: every §3 prose group appears once; category membership positive/negative tests; no hidden approvals or duplicate streaming. Commit: feat(tui): add live transcript controls.

### Phase 6 — Tool cards and connectors

Dependencies: 5. Coverage: T11–T14, F02 behavior.

1. Render TOOL badges, tool labels, lifecycle outcomes, metadata, right counts and connector guides.
2. Distinguish requested ranges from observed counts; never count truncated preview as full output.
3. Stable call/card identity through request/start/progress/completion/failure/cancel; Ctrl+O expands detail without duplicating entries.
4. Bound output/card height, wrap long paths, escape terminal controls, handle missing metadata and viewport clipping.

Exit: both reference cards match structure; orphan events cannot mutate other cards; large output preserves responsive input; resolver untouched. Commit: feat(tui): render tool cards.

### Phase 7 — Selected-agent inspector

Dependencies: 4–6. Coverage: R01–R16.

1. Pure joined read model for selected agent/task, active tool, approvals, artifacts and usage.
2. Render sections/dividers in exact order: AGENT DETAILS → LIVE ACTIVITY → APPROVALS → ARTIFACTS → USAGE.
3. Aggregate, missing-selection and stale-snapshot states; preserve selection across visibility changes.
4. Clock-only elapsed updates, correlated terminal tool clearing, scroll/collapse on short height.
5. Known/unknown/zero/partial usage and approval-unavailable behavior; strict artifact scope and bounded previews.

Exit: every label/value verified; completed call never remains active; unknown cost/context never become zero. Commit: feat(tui): add agent inspector.

### Phase 8 — Composer and keyboard integration

Dependencies: 3–7. Coverage: C01–C03, F01–F04 and all controls/shortcuts.

1. Full-width box, cyan prompt and exact empty placeholder; multiline grapheme-aware cursor.
2. Wire focus-cycle, roster shortcuts, filters, following and inspector actions after key-conflict audit; selection/focus remain distinct.
3. Preserve submit/queue/FIFO/newline/slash completion/paste/Tab/mode/drawer behavior. Failed submission retains text; visible acceptance/queue feedback.
4. Test approval/overlay precedence, contextual Escape and global Ctrl+C cancellation; restore raw mode/cursor/paste modes on exit.
5. Artifacts open through existing bounded inspection; help/footer document every actual binding. Composer continues targeting foreground session unless an explicit target control is designed separately.

Exit: c, /, digits and a/d never fire unintended actions outside their focus; PTY paste/cursor/focus/resize/cancel pass. Commit: feat(tui): wire preview controls.

### Phase 9 — Coordination entry and real runtime parity

Dependencies: 8. Coverage: L10 and live cross-pane state.

1. Coordination entry opens objective input, validation and busy feedback; no launch from navigation; suppress duplicate submit.
2. Inspect current TUI/runtime integration, then use typed controller/port boundary backed by existing coordination runtime. No new scheduler, guessed direct launch API or permission widening.
3. Observe actual run ID, worker identities/outcomes, dependency/retry events, scoped tools/artifacts and approval mode.
4. Test cancellation through scheduler/leases, resumed runs and aggregate verification. Distinguish execution terminal from verified aggregate completion.

Exit: scripted four-worker runtime drives the same UI models; cancellation reaches runtime; success prose or successful call alone never yields verified completion. Commit: feat(tui): connect coordination entry.

### Phase 10 — Complete parity acceptance and rollout

Dependencies: 0–9. Coverage: every ID.

1. Capture deterministic cell/ANSI goldens and fixed-font screenshots for reference and responsive matrix; review borders, fill, columns, whitespace and every ID.
2. Scenarios: empty/aggregate/many agents/two runs; long names/paths; waiting/failed/partial/cancelled/stalled; approvals/stale approval snapshots/deny; retries/resume; unavailable and explicit zero usage/cost; deleted/unavailable artifacts.
3. Unicode/CJK/emoji/combining input and output; ASCII/16-color/monochrome; terminal restoration and non-TTY behavior.
4. Measure large-history rendering/input against existing baseline, then set budgets. Avoid whole-history reformatting on elapsed ticks; bound output and preserve row diffs.
5. Run required CI/build/typechecks/unused/dead checks, focused and runtime tests, DOX and graph analysis. Verify feature-disabled legacy views and non-agent tabs.
6. Update owning DOX/help and accepted spec amendments; retain feature gate until parity evidence. Mark plan as-built with PRs; retain limitations until evidence retires them.

Exit: all IDs have evidence; no required check outstanding; operator can navigate/filter/follow/inspect/approve/queue/cancel/coordinately execute actual work. Commit: test(tui): gate preview parity rollout.

## 6. Dependency and review sequence

0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.

After geometry stabilizes, shell/roster work may parallelize with disjoint file ownership. Transcript/cards share models and stay sequenced; inspector waits on their contracts. Spec/coverage review precedes code-quality review. Canonical screenshot alone cannot override failed responsive/input gates.

## 7. Verification ownership and commands

Existing tests verified present; extend rather than duplicate:

- Projection: tests/tui/workbench/agent-task-projections.vitest.ts; conversation-projection.vitest.ts; artifact-projection.vitest.ts.
- Shell/layout: tests/tui/workbench/operator-shell.vitest.ts; responsive-drawer.vitest.ts; renderer.vitest.ts.
- Transcript/approval: tests/tui/workbench/workbench-scrollback.vitest.ts; approval-dialog.vitest.ts.
- Interaction: tests/tui/workbench/workbench-store.vitest.ts; input-router.vitest.ts; composer-view.vitest.ts; work-surface-integration.vitest.ts; builtin-command.vitest.ts.
- Runtime/bootstrap: tests/tui/workbench/four-worker-e2e.vitest.ts; tests/cli/commands/tui-thin-bootstrap.vitest.ts.
- Actual terminal: tests/manual/run-pty.py; tests/manual/suite-p-tui-smoke.test.ts. Automated preview PTY/golden suites are proposed additions, not currently verified suites.

Repository scripts verified in package.json:

    pnpm test:vitest tests/tui/workbench tests/cli/commands/tui-thin-bootstrap.vitest.ts
    pnpm typecheck
    pnpm typecheck:unused
    pnpm check:dead
    pnpm build
    pnpm test:node
    pnpm check:dox
    node .gitnexus/run.cjs detect-changes --scope all --repo ALiX

Select affected tests per phase; full required suites at integration gates. pnpm test:manual:tui is an explicitly invoked manual smoke workflow after build, not an automatic ordinary test. New PTY tests must exercise an actual terminal subprocess; mocked input tests are separate evidence. Tests should protect correlation, wrapping, clipping and interaction, not restate implementation.

## 8. Risks, open decisions and deferred work

- Shared geometry/caret/anchor drift is primary risk. One computation feeds every consumer; no independent offset patches.
- Short inspector can hide actionable approvals/usage. Scrolling/collapse and global pending alert retain access; reserve composer/cancel space.
- Producer gaps may block exact metadata. Resolve in Phase 1; unavailable is honest, guessed success is not.
- Inspection/scope separation requires explicit change to current TUI contract. Phase 0 accepts design, implementation updates owning DOX before shipping.
- Coordination launch adapter remains unverified in planning; Phase 9 must inspect exact runtime boundary before choosing implementation.
- Reference image currently local/untracked and graph stale; Phase 0 preserves asset, implementation refreshes/verifies graph.
- Deferred: second UI framework, web replica, scheduler redesign, provider changes, tool-name admission changes, raw artifact reads, unrelated tab redesign and font/glow emulation.

## 9. Definition of done and planning closeout

- Every V/H/L/T/R/C/F ID implemented and reviewed; nothing silently omitted.
- Canonical capture matches composition/hierarchy; corrected contradictions and terminal deviations listed.
- Every control works with event-backed state; all narrow/short layouts preserve essential actions, selections, anchors and cursor.
- No fabricated usage, lifecycle, dependencies, success, artifact writes or coordination completion.
- Required CI, graph/DOX checks, spec compliance and code-quality review pass before rollout gate changes.

This document adds one dated plan within existing docs/superpowers ownership. Root and TUI DOX intentionally unchanged: behavior is proposed, not shipped; explicit amendments belong to Phase 0/implementation. Production source/tests/configuration/reference image/runtime state unchanged during planning.
