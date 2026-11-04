# GE-04 experimental protected evidence inventory

**SECURITY HOLD — read-only prototype, not a privileged supervisor or authorization.**

`experiments/ge04/supervisor-ledger-audit.py` enumerates the protected evidence directory through a trusted directory descriptor. It accepts only canonical UUIDv4 `.json` pre-spawn entries that individually validate as `NOT_AUTHORIZED`; unknown names, orphan staging files, symlinks, hard links, malformed records and inaccessible roots quarantine the whole inventory as `UNCERTAIN`. A clean inventory returns `NOT_AUTHORIZED_ONLY`, which **never** means an action was authorized or executed. No automatic repair, replay, or deletion occurs.

Enumeration and per-record validation are separate reads, **not an atomic snapshot**. Same-UID privileged tampering and directory replacement remain unqualified. This diagnostic does not establish terminal receipts, append-only integrity, authorization, crash-safe transitions or power-loss durability. Production mutation remains disabled.
