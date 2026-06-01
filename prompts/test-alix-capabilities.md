# ALiX Capability Test Prompt

Test all 12 ALiX capabilities by verifying each system exists and functions correctly:

## Capability 1: Autonomous Agent Loop
- Verify task classifier categorizes: bugfix, feature, refactor, docs, research
- Confirm task state machine tracks transitions (planning → working → verifying → done)
- Confirm scope tracker prevents task scope expansion
- Confirm run limiter enforces max iterations (default 10) and max repairs (3)

## Capability 2: 12 Provider Support  
- List all providers in src/providers/ and confirm: anthropic, openai, gemini, deepseek, groq, ollama, perplexity, minimax, zhipuai, groqai, openrouter, mock
- Verify base provider handles errors with retry logic
- Verify tiktoken token counting exists in src/utils/tokens.ts

## Capability 3: Tool System
- Verify src/tools/file-tools.ts implements: read, write, patch, glob, grep
- Verify src/tools/shell-tool.ts has output truncation (80KB max)
- Verify src/tools/tool-router.ts handles execution and policy

## Capability 4: MCP Extensions
- Verify src/mcp/ has: manager.ts, client.ts, registry.ts, tool-discovery.ts, tool-deferral.ts, tool-selector.ts
- Verify transports exist in src/mcp/transports/

## Capability 5: Patch Engine
- Verify src/patch/preimage-validator.ts has preimage validation
- Verify src/checkpoints/ has checkpoint management
- Verify src/patch/rollback-manager.ts has rollback logic
- Verify supports structured_patch, search_replace, and full_file formats
- Verify src/patch/full-file-guard.ts prevents accidental rewrites

## Capability 6: Policy Engine
- Verify src/policy/policy-engine.ts exists with allow/ask/deny logic
- Verify src/policy/shell-whitelist.ts restricts commands
- Verify src/security/secret-scanner.ts scans for secrets

## Capability 7: Verification System
- Verify src/verifier/enhanced-verifier.ts exists
- Verify src/verifier/test-planner.ts maps tests to source files
- Verify src/verifier/dep-graph.ts understands file relationships
- Verify src/verifier/risk-report.ts assesses residual risk

## Capability 8: Multi-Agent Coordination
- Verify src/agents/subagent-manager.ts exists
- Verify src/agents/ownership-registry.ts tracks file ownership
- Verify src/agents/merge-coordinator.ts combines parallel results
- Verify src/agents/tool-policy.ts controls role access

## Capability 9: Skills & Extensions
- Verify src/skills/ has: loader.ts, catalog.ts, dispatcher.ts
- Verify src/extensions/hook-runner.ts supports lifecycle hooks
- Verify src/extensions/extension-registry.ts exists

## Capability 10: Context Intelligence
- Verify src/repomap/context-compiler.ts ranks files by relevance
- Verify src/repomap/context-ranker.ts implements scoring
- Verify src/repomap/git-activity.ts boosts recent changes
- Verify token budget enforcement in context pipeline

## Capability 11: Observability
- Verify src/events/ has JSONL event logging
- Verify src/inspector/ exists with SSE streaming
- Verify src/ui/ has HTML/JS/CSS assets for Inspector UI

## Capability 12: Safety Guards
- Verify src/autonomy/state-machine.ts tracks task state
- Verify src/autonomy/run-limiter.ts enforces hard limits
- Verify src/autonomy/scope-tracker.ts prevents expansion
- Verify src/memory/ has layered memory architecture

## Output Format
Return a summary table with columns: Capability | Status | Details
Mark each as ✅ Implemented or ❌ Missing with file path if missing.