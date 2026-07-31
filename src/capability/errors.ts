/** Typed capability-domain errors. Consumers (TUI, Web, MCP) map these
 *  onto their own error surfaces without string-parsing messages. */
export class CapabilityNotFoundError extends Error {
  constructor(capabilityId: string) {
    super(`Unknown capability: ${capabilityId}`);
    this.name = "CapabilityNotFoundError";
  }
}

export class CapabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityValidationError";
  }
}

export class ExecutorNotFoundError extends Error {
  constructor(strategy: string) {
    super(`No executor for strategy: ${strategy}`);
    this.name = "ExecutorNotFoundError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(capabilityId: string, actor: string) {
    super(`Permission denied for ${actor} invoking ${capabilityId}`);
    this.name = "PermissionDeniedError";
  }
}

export class InvocationCancelledError extends Error {
  constructor(invocationId: string) {
    super(`Invocation cancelled: ${invocationId}`);
    this.name = "InvocationCancelledError";
  }
}
