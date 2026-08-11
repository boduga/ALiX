export class CapabilityNotExecutableError extends Error {
  constructor(intent: string) { super(`capability:${intent} is not executable in A7.1`); }
}
