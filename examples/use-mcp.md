# Example: Use a GitHub MCP server

**Setup:**

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_..."
alix mcp add github
```

**Task:**
```bash
alix run "list open issues in this repo assigned to me, summarize the top 3"
```

**What ALiX does:**

1. Discovers the GitHub MCP server
2. Calls `list_issues` with filter `assignee=me, state=open`
3. Reads the top 3
4. Summarizes

**Expected output:**

```
Classified: research
Loaded MCP tools: github.list_issues, github.get_issue, ...

Found 7 open issues. Top 3:

1. #142: "Memory leak in src/cache.ts"
   - High priority, opened 3 days ago
   - Affects long-running sessions

2. #138: "Add tests for context compiler"
   - Medium priority, opened 1 week ago

3. #135: "TUI flickers on diff updates"
   - Low priority, opened 2 weeks ago
```

**Time:** ~10 seconds (after MCP server is loaded)