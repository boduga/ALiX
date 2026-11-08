# GE-04-R2O publisher journal and checkpoint — qualification evidence (2026-11-08)

## Disposition
GE-04 SECURITY HOLD ACTIVE. Read-only qualification prototype. No privileged publisher activated, no production worker launches, credential delivery, ledger clearance, recovery authorization or merge.

## New local uncommitted files
- scripts/ge04-r2o-publisher-chain.py
- tests/agents/test_ge04_r2o_publisher_chain.py

## Mechanism
Read two separately rooted protected JSON files: publisher revision-chain journal and checkpoint. Require contiguous revisions from 1, SHA-256 links between canonical entries, publisher and issuer UID separation, policy digest identity, boot ID, and exact checkpoint head agreement. Reject altered, missing, unsafe or conflicting files. A second read detects simple simultaneous changes. No mutation, publishing, signing, new external trust anchor or release capability.

## Results
- R2O focused Python 15/15 PASS.
- R2G-R2O Python 97/97 PASS.
- R2A-R2F and R1B1 Vitest 35/35 PASS.
- pnpm typecheck PASS.
- Live guest alix-ge04-kvm01 negative observation: expected protected publisher journal/checkpoint not present. status=blocked, journalConsistent=false, checkpointMatches=false, publisherProvenanceQualified=false, rollbackResistant=false; FileNotFoundError. Source copied to /tmp inside guest only.
- Explicit coordinated rollback test demonstrates both locally rewound journal + checkpoint can still appear internally consistent. Output remains BLOCKED, never qualified.

## Critical unqualified protections
No independent publisher identity is established by supplied UID fields; unit test simulates a root-owned checkpoint. No externally anchored monotonic counter, signed trusted checkpoint, protected cross-UID update transaction, authenticated policy/issuer source, or actual tamper-proof journal. An adversary controlling publisher journal and checkpoint can roll them back together. No pidfd/cgroup hostile-worker containment or recovery authority. Never promote consistencyChecks into authorization.

## Next suggestion
GE-04-R2P should specify a concrete external monotonic trust anchor and cross-UID issuer provenance, then qualify against real host/VM controls before any admission wiring.
