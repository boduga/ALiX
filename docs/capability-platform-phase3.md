# ALiX Capability Platform — Phase 3 (Unified Operator Timeline)

The chat tab now renders a single `timelineEvents[]` stream — user prompts,
agent responses, and capability invocations interleaved by time. A capability
invoked mid-conversation appears in its chronological position (⚡ marker)
instead of after all turns.

One source of truth: ChatView (full timeline), AgentView (user/agent only),
and copy-scrollback all project `timelineEvents`, so they can never diverge.
Every write goes through `appendTimelineEvent()` in src/tui/state.ts, which
stamps id/timestamp/sequence/source; ordering is by timestamp with a
monotonic sequence tiebreak for same-millisecond events.

Tool calls remain on the agent tab as execution telemetry — they are not
timeline events. The platform itself (src/capability/) is unchanged.
