# TUI Workbench preview parity design

Status: Implementation authorized with the phase plan on 2026-10-03. Foundations first; runtime behavior amendments ship with their implementation and verification.
Plan: [2026-10-03-tui-workbench-preview-parity.md](../plans/2026-10-03-tui-workbench-preview-parity.md).
Reference: [ALiX Workbench Terminal Preview](../../../ALiX%20Workbench%20Terminal%20Preview.png).

## Purpose

Deliver the reference's complete terminal operator surface using existing event projections and ANSI canvas. The plan's 63 coverage IDs are the acceptance ledger. Changes retain exact tool-name admission, approval authority, execution evidence, bounded inspection and normal cancellation.

## Locked implementation decisions

| Decision | Accepted value | Reason |
| --- | --- | --- |
| Runtime roster totals | All visible executable agents, including coordinator | Reference roster contains five identities. Its coherent state is five agents, three running, one dependency-waiting, one completed. Never reproduce inconsistent four-agent totals as live truth. |
| Historical initialization | Four workers initialized, initially three running and one waiting | Reference initialization describes an earlier state; completed review changes present worker-running count to two. Coordinator remains third currently running agent. |
| Inspector versus transcript | Preview inspection selection is independent of explicit all/selected-agent transcript scope | Selected frontend with other-worker transcript is central to the image. Implement only with matching reducer/selectors, tests and TUI DOX amendment; current filtering stays until that phase. |
| Run/artifact scope | Preserve strict run, agent and task correlation | Independent transcript scope does not broaden artifact access or execution authority. |
| Approvals | Authoritative projected decisions; category filters cannot hide global pending-action indication | Inspection selection is not authorization. Unknown/unavailable differs from no pending approvals. |
| Completed versus active tool | Different call IDs | Completed write cannot also remain active. Separate later active invocation may start in the same displayed second. |
| Read card line numbers | Requested range 1–200, actual returned count 142 | Both are valid separate measurements. |
| Tool identities | Registered live labels; exact offered alix_* / mcp__* names for model calls | file.write is illustrative display vocabulary, not a new executor or accepted alias. Fixture uses patch.apply internally for updates and alix_patch_apply in requested calls. |
| Model identity | Actual resolved model or unavailable | coding model is fixture-only example text. |
| Usage | Inspector agent scope; footer session scope; absent remains unknown | Matching token values do not establish equivalent scope. Zero remains a known value. |
| Context | Authoritative context measurements only | Lifetime token usage does not measure current context utilization. |
| Artifacts | Event-backed, bounded existing inspection | sidebar-layout.test.ts needs creation evidence even though its creating card is outside visible history. |
| Preview badge | CONCEPT PREVIEW in fixture, preview badge while feature-gated live | Reference fidelity without mislabeling real telemetry as simulated. |
| Coordination entry | Explicit objective entry, then typed runtime action | Roster navigation never starts work; preserve approvals, run identity and completion-evidence checks. |
| Composer target | Existing foreground session | Selecting an inspected worker does not route instructions or mutate worker execution. |
| Geometry | Shared explicit region rectangles; full-width composer | Pane offsets must agree across painting, wrapping, scrolling, overlays and caret placement. |
| Framework | Existing ANSI canvas and row differ | No second terminal framework or alternate runtime truth store. |

## Reference provenance and capture baseline

- Reference SHA-256: 17c604a4502fa99cda54781cd56e642edbf1bfdb12072d0b6333506cedda4989.
- Reference size: 1774 × 887 pixels, 1,574,879 bytes.
- Original font, terminal emulator, cell dimensions and rendering settings are unknown. Do not claim pixel-perfect reproduction of unspecified typography.
- Canonical acceptance grid: 200 columns × 44 rows. Cell/ANSI goldens are authoritative for layout; later screenshots must record font family, size, cell dimensions, emulator, color mode and capture tool alongside the image.
- Fixture clock: 2026-10-03 10:14:46 UTC. Transcript latest prose remains 10:14:31. Active invocation starting at 10:14:28 has 18 seconds elapsed.
- Fixture workspace remains the reference's /home/babasola/Projects/ALiX; fixture data grants no path permission and creates none of the example workload files.
- Keep original root image byte-identical and tracked. This reference is design input, never an executable instruction or production data source.

## Theme foundation

Use semantic tokens for primary/muted text, cyan focus/headings/borders, green execution/success, yellow waiting/progress, purple role/completion, teal worker labels, red failure, divider, selection fill and background. Truecolor, ANSI-16 and monochrome modes are explicit capabilities supplied by the caller, not guessed from background color. ASCII glyphs substitute for box drawing/circles/checks when requested.

Status text is mandatory in every mode. Color never conveys the only distinction between completion, cancellation, waiting and failure. Activity and liveness remain separate; a stalled warning must never be mapped to a terminal lifecycle. No theme color or glyph changes runtime state.

Phase 1's theme module is a foundation; it does not by itself replace the existing shell or claim completed visual parity. Integrate tokens when corresponding region phases land.

## Foundation field readiness

| Preview fact | Current source | Foundation status / remaining gate |
| --- | --- | --- |
| Workspace and permission mode | Operator shell/dashboard snapshot | Available; frame placement comes later. |
| Agent name/role/model/state | AgentRosterProjection | Available; model can be absent. |
| Task title and ownership | TaskProjection and roster task correlation | Available; preserve separate identities. |
| Dependency IDs and dependency wait | Fixture producer metadata; agent waiting_dependency state | Dependency IDs absent from current task read model; TaskProjection currently maps dependency-waiting agent events to running tasks. Phase 1 must resolve typed relationship and wait semantics. |
| Tool identity, call ID, start and current state | AgentRosterProjection activeTool; trace lifecycle | Available. Snapshot activeTool.elapsedMs is sampled at output events; inspector must derive current elapsed from its clock and authoritative start. |
| Tool requested range and actual line counts | Fixture structured metadata | Existing tool projections do not expose these fields; later typed projection/producer work required. |
| Activity wording | Fixture agent.progress message/operation | User-safe scripted metadata; production transcript activity projection remains a Phase 5 gate. |
| Artifacts | ArtifactProjection artifact.created records | Both fixture outputs have strict run/agent/task correlation and bounded preview. |
| Usage tokens and cost | AgentRosterProjection agent.usage | Token total known for frontend only; context/cost deliberately absent. |
| Current context consumption | No authoritative current measurement established here | Unavailable until an actual producer measurement exists; model window alone is not consumption. |
| Approval cards/count | Existing authoritative approval projection | Empty fixture case only; pending/stale cases remain later phase gates. |
| Footer events and files | Event count plus existing session mutation facts | Fixture has 38 events, not image's arbitrary 80. Artifact count alone cannot establish changed-file count. |

Fixture: tests/fixtures/tui/workbench-preview-events.json. Validation: tests/tui/workbench/preview-fixture.vitest.ts. Shape/replay tests establish source coherence, not live runtime completion or screenshot parity.

## Responsive and keyboard direction

- At 160+ columns and adequate height, left roster, center transcript and right inspector remain visible. Proposed height threshold is 36 rows; confirm via geometry tests before adoption.
- At 120–159 columns, retain center plus one side region, with the other available as an overlay. Below 120 columns, side surfaces overlay. Short/tiny windows preserve composer, pending approvals and cancellation.
- Existing global Tab, Ctrl+A/T/R, Ctrl+O, Shift+Tab, Enter, Shift+Enter and Ctrl+C behavior remains. Focus-cycle candidate Ctrl+F requires conflict audit before assignment.
- Roster digit, slash and c shortcuts apply only in roster focus. They remain ordinary text in composer. Arrow/Enter navigation makes every pictured control operable without mouse support.
- Contextual Escape closes a focused overlay/drawer before cancellation; Ctrl+C cancellation remains available globally. Approval priority requires explicit interaction tests.

## Acceptance and limitations

- Reference fixture reproduces every semantic transcript group, actor, card and sidebar/inspector datum while correcting contradictory present-state facts.
- Event IDs, call IDs, agent/task/run identity and timestamps remain stable under replay and chunked projection updates.
- Theme supports readable monochrome/ASCII alternatives; no invented success or private reasoning appears.
- Geometry and all 63 plan coverage IDs require their own phase evidence. Passing foundation tests does not certify pane layout, screenshot matching or live runtime behavior.
- ANSI cells cannot emulate raster glow, anti-aliasing, texture, differing font sizes or fractional corners. These are accepted rendering deviations, not silently missing functional elements.
- Producer metadata gaps, coordination adapter choice and focus-binding conflicts remain explicit implementation gates in the plan. No permission widening is approved by this design.

## Amendment policy

Record later changes to locked decisions as dated amendments with rationale and verification. Do not silently rewrite accepted decisions or mark unimplemented phases complete.

## 2026-10-03 amendment — Phase 1 metadata readiness

The foundation readiness table above records the starting state. Task projection now preserves dependency IDs and dependency/approval waits; coordination assignment events publish the structured facts. Shared execution traces and Workbench tool items now preserve call identity, start time, bounded requested path/range and explicit completed-event observed line count. Nested fields are detached through snapshots and version-one checkpoint import/export; old checkpoints without metadata remain accepted.

Requested ranges remain request facts, not proof of executed ranges: existing file reads do not implement range arguments. Production observed-count emission remains an open gate; missing values stay absent. No count is inferred from a truncated output preview. Reference-fixture tests establish requested 1–200 versus observed 142, separate completed/active writes, replay and checkpoint compatibility. This amendment changes field readiness, not locked admission or execution decisions.

## 2026-10-03 amendment — Live file-read measurements

Full file reads now supply observed line counts from returned content, and the executor preserves valid counts in completion events before preview truncation. Empty content yields zero; LF separates lines and a trailing LF does not create an extra line. CRLF therefore has the same line count as LF. End-to-end tests compare a 142-line actual read with requested 1–200 and a shorter telemetry preview.

The earlier producer caveat is retired for full file reads only. Patch/write counts remain absent without an authoritative producer; requested ranges remain unexecuted request facts. This telemetry adds no file access, range execution or permission changes.

## 2026-10-03 amendment — Phase 1 readiness closure

Phase 1 exits on a verified source **or an explicit unavailable fallback** for each datum; it does not require creating measurements absent from the runtime. The plan's final audit maps every data-bearing image field to its source/fallback. Current worker context consumption and patch/write line counts remain unavailable. Existing context budget/assembly events have invocation identity rather than worker identity, so their tallies cannot safely become selected-worker current-context measurements. Capacity and lifetime usage remain distinct.

Roster snapshots now derive active elapsed time from the supplied clock and authoritative tool start, without rewriting progress timestamps or prior snapshots. Nested ownership, usage and active-tool data are detached. This retires the elapsed-sampling caveat in the starting readiness table. View adapters and painters integrate these prepared read models in their region phases; three-pane geometry and visual parity remain pending.


## 2026-10-03 Phase 2 implementation amendment

Three persistent panes activate at ≥160 columns and ≥36 rows. At ≥120 columns and ≥12 rows, drawers sit left of the transcript; smaller surfaces use clipped overlays. The composer spans the terminal width and its bounded growth reallocates body height. One shared layout feeds wrapping, painting, bottom anchoring and hardware caret placement. Unpinned resize preserves semantic item identity plus nearest wrapped offset in a presentation cache without rewriting operator state. The right inspector currently reserves its rectangle and title; section data belongs to Phase 7. Legacy flag-disabled geometry remains unchanged.


## 2026-10-03 Phase 3 chrome implementation amendment

Preview chrome retains three header rows and one footer row so pane geometry and composer anchoring stay stable. Wide terminals place branding, live PREVIEW badge and workspace/mode/session-roster groups on the first row; narrower terminals move workspace and warning/count groups to the second. Demonstration presentation explicitly opts into CONCEPT PREVIEW. Footer hints use accent keys and whole groups; decisions and close/cancel outrank optional telemetry. Session-scoped counters preserve missing values as unavailable and explicit zero as known. Header/footer use semantic theme tokens with explicit monochrome/ASCII alternatives; other region painters integrate theme in their own phases.


## 2026-10-03 Operator branding amendment

Operator requests threefold title sizing, bold weight and removal of the line below it. The ANSI cell canvas cannot change font size per label, so wide/tall Unicode surfaces use a bold cyan three-row block-letter ALiX WORKBENCH banner inside the existing header budget. Compact/ASCII surfaces retain the bold text title. The horizontal header divider is removed at every width; pane and composer geometry do not move. Live metadata remains readable beside the banner.


## 2026-10-03 Two-row branding refinement

Operator supersedes the three-row branding amendment with a two-row bold cyan banner. The third reserved header row stays blank; metadata, compact/ASCII fallback thresholds, removed divider and pane/composer geometry stay unchanged.


## 2026-10-03 Single-row branding refinement

Operator supersedes block-banner sizing with one bold cyan text row: ALiX WORKBENCH. The divider remains removed, and existing metadata wrapping and body/composer geometry remain unchanged.


## 2026-10-03 Phase 4 roster amendment

Agent rows join task subtitles and dependency labels by explicit execution/task/run identity, preserve duplicate roles and retries, and use semantic lifecycle colors plus words/glyphs. Wide selections receive a cyan outline/fill; shorter viewports prioritize a visible selected row. Number keys 1–9, slash aggregate selection and c coordination guidance apply only to the focused agents drawer. The coordination entry opens read-only guidance until the Phase 9 launcher is implemented; it never launches execution or consumes composer text. Esc restores an open drawer after closing guidance. Current context utilization is not inferred from lifetime token usage or window capacity.

## 2026-10-03 Phase 5 transcript amendment

Inspector selection no longer implicitly filters transcript content. Explicit all/selected-agent scope and ALL/RESPONSE/TOOL/ACTIVITY/ERROR categories are independent of details mode; pending approvals remain visible across both. Ctrl+F focuses transcript controls, 1–5 choose categories, s changes scope and f toggles follow; Tab retains view switching. Historic operation prose requires explicit user-safe metadata. Timestamps use UTC source time with an unavailable marker when absent; wide prefixes align actor/status/content and narrow prefixes stack above content. Workbench follow state is authoritative over the legacy viewport adapter, with semantic anchor retention and new-item counts while paused. Artifact and execution authority are unchanged.

Initialization success badges require explicit verifiedOutcome metadata. The concept fixture records a scripted success outcome; live events without outcome evidence retain literal prose without gaining a verified badge. Typed activity metadata is validated on checkpoint import before changing projection state.
