# ALiX Capability Platform — Phase 3 (Unified Operator Timeline)

chat tab now renders single `timelineEvents[]` stream — user prompts,
agent responses, capability invocations interleaved by time. A capability
invoked mid-conversation appears in its chronological position (⚡ marker)
instead all turns.

One source truth: ChatView (full timeline), AgentView (user/agent only),
copy-scrollback all project `timelineEvents`, so can never diverge.
Every write goes through `appendTimelineEvent()` in src/tui/state.ts,
stamps id/timestamp/sequence/source; ordering by timestamp
monotonic sequence tiebreak same-millisecond events.

Tool calls remain on agent tab as execution telemetry — not
timeline events. platform itself (src/capability/) unchanged.
