# Quick ALiX Capability Verification

Quickly verify these 5 key ALiX capabilities exist. For each, read the relevant source file and confirm it exists with expected content:

1. **Agent Loop**: Read src/task-classifier.ts - confirm it exports TaskType enum with: bugfix, feature, refactor, docs, research

2. **12 Providers**: Read src/providers/ directory listing - confirm these exist: anthropic-provider.ts, openai-provider.ts, gemini-provider.ts, mock-provider.ts, deepseek-provider.ts, groq-provider.ts, ollama-provider.ts, perplexity-provider.ts, minimax-provider.ts, zhipuai-provider.ts, groqai-provider.ts, openrouter-provider.ts

3. **Tool System**: Read src/tools/file-tools.ts - confirm it defines read/write/patch tools

4. **MCP**: Read src/mcp/manager.ts - confirm it exports an MCPManager class

5. **Patch Engine**: Read src/patch/rollback-manager.ts - confirm it exports rollback functionality

Return a simple table:
| Capability | Status | Files Found |
|------------|--------|-------------|