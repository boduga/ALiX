# ALiX Capability Platform — Phase 4 (Execution Trace)

Runtime tab now renders structured **Execution Trace**: lifecycle-grouped
rows over append-only EventLog — tool run collapses one row
(`▶ tool.search … ✔ completed (183ms)`), policy verdicts, capability
invocations, runtime phase transitions render one unit.

Client-side filtering (All / Tool / Capability / Policy / Runtime) view-local
state on Runtime tab. pipeline is `EventLog → RuntimeCollector →
ExecutionTraceBuilder (pure) → ExecutionTraceRetention → RuntimeSnapshot.trace →
RuntimeView`; view never touches EventLog directly. Running entries
never evicted; terminal entries bounded last 50.

operator timeline (chat) unchanged — stays curated narrative on
its own `timelineEvents[]` stream. platform (src/capability/) untouched.
