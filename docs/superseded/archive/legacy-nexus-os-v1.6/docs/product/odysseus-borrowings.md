# ALiX Product Borrowings from Odysseus

## Purpose

This document records what ALiX should learn from PewDiePie/pewdiepie-archdaemon's Odysseus without turning ALiX into an Odysseus clone. Odysseus is a self-hosted, local-first AI workspace focused on the user-facing ChatGPT/Claude-style experience. ALiX remains a local-first agent control plane and multi-agent OS.

## Positioning

| Odysseus | ALiX |
|---|---|
| Self-hosted AI workspace | Local-first agent OS / control plane |
| User-facing app surface | Runtime, governance, replay, and workflow substrate |
| Chat, agents, research, email, documents, mobile/PWA | TaskGraph, policy, memory, tools, SOPs, Inspector, evals |
| Optimized for immediate usability | Optimized for safe, inspectable, repeatable workflows |

**Product line:** Odysseus gives users a self-hosted AI workspace. ALiX gives builders the governed agent OS to run trustworthy workflows inside one.

## Borrowing 1 - Visible Workspace Mode

Odysseus makes the product understandable through a familiar workspace: chat, agents, research, model serving, documents, email, and more. ALiX should not copy the entire app surface yet, but it should eventually expose a simple workspace mode on top of the Inspector.

### ALiX Requirement

Add an eventual `workspace` surface after the core runtime is stable:

```text
ALiX Workspace
  Run / Chat
  Research
  Coding
  Infrastructure Audit
  Documents / Artifacts
  Memory
  Agents
  Models
  Settings
```

### Timing

- Not M0.9.
- Start design after M0.11 persistence/replay basics.
- Implement as a thin UI projection over durable state, not as a separate runtime.

## Borrowing 2 - Hardware-Aware Model Cookbook

Odysseus emphasizes hardware-aware model onboarding. ALiX needs this even more because the PRD depends on small local models for fast routing, planning, coding, and critic roles.

### ALiX Requirement

Add a model doctor/cookbook flow:

```bash
alix models doctor
alix models fit
alix models install-profile balanced-local
alix models benchmark-routing
alix eval compare-models --role fast-router
alix eval compare-models --role graph-planner
alix eval compare-models --role coding
alix eval compare-models --role critic
```

### M0.9 Impact

M0.9 must keep the model-routing validation spike. It must test whether `qwen3:4b`, `qwen3:8b`, and `qwen2.5-coder:7b` are adequate before they are treated as safe defaults.

### Acceptance Thresholds

| Role | Default Candidate | Minimum M0.9 Threshold |
|---|---|---|
| Fast router | `qwen3:4b` | >= 90% intent classification accuracy on curated tasks |
| Graph planner | `qwen3:8b` | >= 85% valid TaskGraph JSON on curated tasks |
| Coding | `qwen2.5-coder:7b` | >= current baseline on small patch/test-repair tasks |
| Critic | `qwen3:8b` | >= 80% detection of unsupported claims or risky outputs |

If `qwen3:4b` fails the fast-router threshold, promote `qwen3:8b` to the default fast tier and keep `qwen3:4b` for cheap summaries only.

## Borrowing 3 - Model Comparison UX

Odysseus includes model comparison as a user-facing feature. ALiX should adapt this into a role-specific evaluation workflow rather than a generic chat comparison.

### ALiX Requirement

Add role-specific comparison:

```bash
alix eval compare-models --role fast-router
alix eval compare-models --role graph-planner
alix eval compare-models --role coding
alix eval compare-models --role critic
```

Output must include:

- pass/fail against threshold
- cost estimate
- latency
- JSON validity rate where applicable
- policy/risk mistakes
- recommended profile update

## Borrowing 4 - 10-Minute First Success Path

Odysseus is easy to understand because the setup path points users toward a complete workspace. ALiX needs a similarly simple first success path even though it is a runtime-first project.

### ALiX Requirement

Add a first-success path:

```bash
alix init
alix models doctor
alix run "summarize this repo"
alix demo local
alix inspector open
```

`alix demo local` should run a safe local demonstration that shows:

- WorkflowRun created
- TaskNode created
- model routed
- tool call logged
- PolicyDecision placeholder created
- minimal metrics captured
- Inspector remains usable

## Borrowing 5 - Product Packaging

Odysseus benefits from a simple mainstream message: self-hosted AI workspace, local-first, privacy-first, no telemetry. ALiX should sharpen its public message without changing its architecture.

### Recommended ALiX Message

```text
ALiX is the local-first agent control plane for running safe, inspectable AI workflows on your own machine.
```

Secondary message:

```text
Odysseus gives users a self-hosted AI workspace. ALiX gives builders the governed agent OS beneath trustworthy workflows.
```

## What ALiX Should Not Copy Yet

ALiX must not copy Odysseus's broad app scope in early milestones. The following remain out of scope for M0.9 through M1.0 unless explicitly re-scoped:

- full chat workspace
- email send/write
- calendar write
- mobile/PWA
- image editor
- full document suite
- always-on personal assistant loops
- autonomous external account mutation

## Roadmap Integration

| ALiX Milestone | Odysseus-Inspired Addition | Scope Control |
|---|---|---|
| M0.9 | `alix demo local`, model-routing validation spike | No new product domain |
| M0.10 | stronger `alix models doctor` and model-fit reporting | CLI only |
| M0.11 | Inspector starts evolving toward workspace projection | Projection only, no new runtime |
| M1.1 | Research workspace/demo around `research.deep_report` | Built on TaskGraph and artifacts |
| M1.3 | Infrastructure audit demo | No deployment by default |
| Later | optional workspace UI, notes/tasks/docs surfaces | Only after governance matures |

## Sources

- Odysseus GitHub repository: https://github.com/pewdiepie-archdaemon/odysseus
- Odysseus project site: https://pewdiepie-archdaemon.github.io/odysseus/
- Cybernews coverage of local-first/privacy-first positioning: https://cybernews.com/ai-news/pewdiepie-odysseus-artifcial-intelligence/
- DEV Community commentary on Odysseus product surface and risk: https://dev.to/jenueldev/pewdiepie-built-an-open-source-ai-workspace-and-the-point-is-bigger-than-the-hype-579m
