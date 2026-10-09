/**
 * security.ts — Security diagnostics and Inspector auth management for ALiX.
 *
 * Thin re-export barrel (#717): handlers live in `./security/*` submodules.
 * Public import paths are unchanged for callers (`src/cli.ts`, tests).
 *
 * - `security/shared.ts`         — shared helpers + JSON-mode state
 * - `security/inspector-auth.ts` — `alix security doctor`, `alix inspector auth *`
 * - `security/audit.ts`          — `alix audit {verify|activate|checkpoint|checkpoint-verify}`
 * - `security/credentials.ts`    — `alix credential *`
 * - `security/supply-chain.ts`   — `alix security supply-chain *`
 * - `security/doctor.ts`         — comprehensive doctor + gate
 */

export {
  handleSecurityDoctor,
  handleInspectorAuthCreate,
  handleInspectorAuthList,
  handleInspectorAuthRotate,
  handleInspectorAuthRevoke,
  handleInspectorAuthDoctor,
} from "./security/inspector-auth.js";

export {
  handleAuditVerify,
  activateAuditChain,
  handleAuditActivate,
  handleAuditCheckpoint,
  handleAuditCheckpointVerify,
} from "./security/audit.js";

export {
  handleCredentialList,
  handleCredentialGet,
  handleCredentialSet,
  handleCredentialDelete,
  handleCredentialMigrate,
} from "./security/credentials.js";

export {
  handleSupplyChainLifecycleCheck,
  handleSupplyChainExceptions,
  handleSupplyChainVerifyTarball,
} from "./security/supply-chain.js";

export {
  handleSecurityDoctorComprehensive,
  handleSecurityGate,
} from "./security/doctor.js";
