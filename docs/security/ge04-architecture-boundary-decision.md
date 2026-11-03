# GE-04 — architecture-boundary decision (blocked)

Status: **SECURITY HOLD; two exact owner-local GE-04 adapter exemptions now implemented for review.** This does not authorize production enablement or merge.

## Verified constraint

The unchanged `tests/architecture/r1-boundary-freeze.test.ts` rejects every runtime import of `approval-store.ts` except the already-sanctioned `worker-approval-port.ts`, and every runtime import of `ownership-registry.ts` without exception. The two new GE-04 authority factories import their concrete stores for `instanceof` checks; those are the two remaining R1 violations after migrating the execution verifier and read-only recovery to the ports. The architecture test originally found three execution imports; the migration eliminates those three but relocates two violations to the factories. Merely moving a factory to its owner directory does not exempt its imports.

## Failed design experiment (not committed)

Moving both factories into the concrete store modules and exporting their symbol-based trust markers made R1 pass 4/4, but a forged plain object with the exported marker passed both trust predicates. That is a security regression. The relocation was reverted; the port modules now use private WeakSets, and copied property descriptors do not confer trust. Do not restore exported markers or rely on duck typing, constructor-name strings, dynamic-import tricks, or test-scanner evasions.

## Architecture decision required

The two legitimate factory imports cannot be made compliant with the *current import policy* simply by moving them inside their ownership domains. A genuine architecture decision is needed:

1. **Recommended:** explicitly sanction a narrowly reviewed, non-construction authority adapter for each protected store, with tests that verify the adapter can only mint restricted ports from real store instances. This requires an intentional, separately reviewed change to the R1 import policy; it is **not** authorized by this work and must not be silently added to the allowlist.
2. Alternatively, redesign the protected-store API and the trusted composition root so no additional module imports the concrete store. Any shared identity-registration or callback seam must prove that arbitrary callers cannot register forged objects; an exported registration function or symbol is insufficient.

Until that decision is approved, leave the current migration uncommitted and the architecture test failing. Do not treat `WeakSet` identity as a process boundary or claim that it fixes the outstanding native-helper, policy/expiry fencing, and durable-receipt gaps.
