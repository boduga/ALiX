# ALiX Capability Platform — Phase 2 (TUI)

Ctrl+P opens the command palette: type to fuzzy-search capabilities, Enter
to invoke. The Capabilities tab (9th tab) browses the catalog — docs,
schemas, permissions, availability — and Enter invokes from there too.

Every invocation runs through `CapabilityService.invoke()` (src/tui/
capabilities/), which routes the lifecycle into the chat timeline (the
operator's execution history) and bridges events into the EventLog via
toAlixEvent. The platform itself is UI-unaware.
