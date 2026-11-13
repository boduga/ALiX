# Decision Packages

## Overview

The production-shaped decision family. Each decision package owns one bounded question — claim support, context relevance, model tier, risk severity — with an enumerated answer space, a minimal projector that bounds what any engine may see, a deterministic local baseline, a shadow runner, and optionally a feature-flagged active selection path. Every package ships shadow-only or `off` by default, and none of them grants execution authority on its own.

## Subdirectories & Boundaries

- Claim Verification: [./claim-verification/README.md](./claim-verification/README.md) - Judges whether evidence supports, contradicts, or cannot judge a claim, with a bounded evidence projection and a deterministic overlap baseline.
- Context Relevance: [./context-relevance/README.md](./context-relevance/README.md) - Scores one context item against a compact objective, then ranks, thresholds, and caps items in deterministic code; shipping profiles are shadow-only.
- Model Tier: [./model-tier/README.md](./model-tier/README.md) - Bounded-choice selection of an enabled canonical model tier from request features, resolved to a concrete model locally and `off` by default.
- Risk Escalation: [./risk-escalation/README.md](./risk-escalation/README.md) - Judges the severity of a single action as low, medium, or high; policy may only be escalated by it, never waived.
- Shared: [./shared/README.md](./shared/README.md) - Pure helpers every shadow runner uses for attempt interpretation, journal-record shape, and baseline tokenization.
