/**
 * TUI barrel — re-exports for the new canvas-based architecture.
 *
 * Prior to PR #291 this file also held a `Tui` class (legacy readline TUI)
 * and re-exported 10+ widget modules that the new architecture no longer uses.
 * Both were removed as part of the post-migration cleanup (see PR #291
 * architecture review Candidate #1 and #4).
 */
export type { TuiStore, TuiState } from "./store.js";
export type { DaemonTaskSummary, PanelApprovalRecord, PanelRuntimeEvent } from "./store.js";
