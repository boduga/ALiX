# ALiX Capability Platform (Phase 1)

## What it is

A reusable execution substrate: Registry (what exists), Resolver (how it runs),
Runtime (invocation lifecycle), Executors (who executes), EventBus (who observes).

Domain integrations live in `src/integrations/`; the platform core is dependency-free.

## Consumer example

```typescript
import { CapabilityPlatform } from "./capability/index.js";
import { registerInitialCapabilities } from "./capability/initial-capabilities.js";
import { registerSessionCapabilities } from "./integrations/session-capabilities.js";

const platform = new CapabilityPlatform();
registerInitialCapabilities(platform.registry, platform.native);
await registerSessionCapabilities(platform.registry, platform.native);

// Invoke — consumers never see the executor
const inv = platform.invoke("core.session.list", {}, { actor: "operator", cwd: "/" });
const result = await inv.wait();   // { status: "completed", output: [...] }

// Discover
const sessionCaps = platform.query({ kinds: ["core"], category: "session" });
```

## Migration pattern

Existing function → Capability definition (`src/capability/initial-capabilities.ts`)
→ Executor adapter (`src/integrations/` or `tool-adapter.ts`) → Invocation.
