# GE-04 — experimental pre-spawn ledger reconciliation

**SECURITY HOLD. No supervisor authority, execution, terminal receipt, or production integration.**

`experiments/ge04/supervisor-ledger-reconcile.py` reads the standalone preflight's protected record through a trusted directory descriptor, validates file identity, ownership, permissions, size, exact schema and attempt ID, and returns only `NOT_AUTHORIZED` for a valid pre-spawn record. Every other condition is `UNCERTAIN`; neither result permits execution or automatic replay. The root-gated test covers valid pre-spawn records, missing/invalid IDs, forged admission and terminal state, torn JSON, writable and multiply linked records, and symlink substitution.

This is **not** a durable state machine: it cannot authenticate approval or lease authority, cannot attest terminal helper outcomes, and cannot verify append-only history or a receipt. Same-UID privileged tampering, process crashes, malicious root, and power-loss durability remain unqualified. It is intentionally read-only and disconnected from the production mutation service.
