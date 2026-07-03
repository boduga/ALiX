# Configuration

ALiX configuration lives in `.alix/config.json` (per-project) and `~/.alix/config.json` (global). Per-project overrides global.

## Config file format

```json
{
  "model": {
    "provider": "google",
    "name": "gemini-2.5-flash"
  },
  "ui": {
    "port": 4137
  },
  "permissions": {
    "protectedPaths": [".git/**", ".env"]
  },
  "mcpServers": [...],
  "subagents": {...},
  "skills": {...}
}
```

## CLI commands

```bash
# Show current config
alix config show

# Set model
alix config set-default-model <provider> <model>

# Set API key (writes to .alix/config.json)
alix config set-key <provider> <key>

# Doctor: diagnose config issues
alix config doctor
```

## Model tiers

ALiX uses 3 model tiers for subagents:

- **fast** (Ollama) — simple lookups, file reads
- **thinking** (configurable) — analysis, planning
- **coding** (configurable) — code generation, edits

Override in config:

```json
{
  "subagents": {
    "modelTiers": {
      "fast": { "provider": "ollama", "name": "llama3.2" },
      "thinking": { "provider": "anthropic", "name": "claude-opus-4-8" },
      "coding": { "provider": "anthropic", "name": "claude-opus-4-8" }
    }
  }
}
```

## Environment variables

- `GEMINI_API_KEY` — Google
- `ANTHROPIC_API_KEY` — Anthropic
- `OPENAI_API_KEY` — OpenAI
- `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, etc.

Env vars take precedence over config file values.

## Inspector security

By default the Inspector binds to `127.0.0.1` (loopback only) with authentication
disabled for local development. The security configuration is controlled via
`ui.security` in your config file.

```json
{
  "ui": {
    "host": "127.0.0.1",
    "port": 4137,
    "security": {
      "authentication": "disabled-loopback-development",
      "remoteAccess": false,
      "allowedHosts": ["127.0.0.1", "::1", "localhost"],
      "allowedOrigins": [],
      "trustedProxyCidrs": [],
      "requireTlsForRemote": true
    }
  }
}
```

See [Inspector Security](security/inspector-security.md) for full details.

## Supply chain

ALiX pins all direct dependencies. Verify with:

```bash
pnpm verify:deps
```

See [Supply-Chain Policy](../README.md#supply-chain-policy) for details.