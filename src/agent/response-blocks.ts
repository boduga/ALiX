// Re-export the v2 block parser. The original v1 implementation lived
// in this file; it was fully replaced by src/tui/blocks/parser.ts in
// Phase 1 of the rich-renderer rollout.
export { parseBlocks } from '../tui/blocks/parser.js';
