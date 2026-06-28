# Sidecar Protocol

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 34. Python Sidecar Protocol

### 34.1 Startup Handshake

Before request/response traffic, every stdio sidecar must complete a startup handshake.

Sidecar sends:

```json
{
  "type": "hello",
  "sidecar": "document_parser",
  "version": "1.0.0",
  "schemaVersion": "1.0",
  "operations": ["extract", "summarize"],
  "capabilities": ["document.parse", "artifact.create"],
  "supportsCancellation": true,
  "maxInputBytes": 10485760
}
```

Host replies:

```json
{
  "type": "hello_ack",
  "host": "alix",
  "schemaVersion": "1.0",
  "sessionId": "session_123"
}
```

Rules:

- The host must reject sidecars with incompatible `schemaVersion`.
- The host must validate sidecar capabilities against the Capability Taxonomy before invocation.
- `supportsCancellation` must be reflected in Tool Card and sidecar metadata.
- Sidecars that do not complete handshake within `startupTimeoutMs` fail fast.

### 34.2 Sidecar Request Envelope

```json
{
  "id": "req_123",
  "schemaVersion": "1.0",
  "sidecar": "document_parser",
  "operation": "extract",
  "input": {
    "artifactId": "art_pdf_123"
  },
  "policyDecisionId": "pol_123",
  "timeoutMs": 60000
}
```

### 34.3 Sidecar Response Envelope

```json
{
  "id": "req_123",
  "status": "ok",
  "events": [],
  "artifacts": [],
  "metrics": {
    "durationMs": 1123,
    "memoryMb": 184
  }
}
```

### 34.4 Sidecar Lifecycle Commands

```
alix sidecar list
alix sidecar doctor
alix sidecar install embeddings
alix sidecar run document_parser --input file.pdf
alix sidecar logs <sidecar-id>
```

### 34.5 Cancellation Protocol

When the ALiX host needs to cancel a sidecar operation:

1. The host writes a JSON line to the sidecar's stdin:
   ```json
   {"type": "cancel", "requestId": "<req_id>", "reason": "node_cancelled"}
   ```
2. The sidecar must:
   - Acknowledge with: `{"type": "cancel_ack", "requestId": "<req_id>"}`
   - Stop work on the named request.
   - Flush any partial output as a `partial` artifact if applicable.
   - Emit `{"type": "cancelled", "requestId": "<req_id>"}` when complete.
3. If the sidecar does not respond within `cancellationGraceMs` (default: 5000 ms), the host sends SIGTERM.
4. If SIGTERM is not acknowledged within an additional 3000 ms, the host sends SIGKILL.
5. A SIGKILL scenario emits `sidecar.crashed` with `reason: "cancellation_timeout"`.

**Stdout is protocol output. Stderr is diagnostic output.** The host reads only stdout for protocol messages.

### 34.6 Lifecycle Rules

- Sidecars must be dependency-isolated, preferably through `uv` environments.
- Stdio messages must be JSON lines (one JSON object per line, no pretty-printing).
- Sidecar crashes must emit `sidecar.crashed` and fail only the affected node unless policy escalates.
- A sidecar that crashes during a side-effecting operation must set `sideEffectState: "unknown"` on the parent node.

---

## 47. Sidecar Startup Handshake

The sidecar startup handshake in §34.1 is required before any stdio sidecar request is accepted.

### 47.1 Handshake Validation

The host validates:

- Sidecar name and version
- Schema version compatibility
- Supported operations
- Declared capabilities against the Capability Taxonomy
- Cancellation support
- Maximum input size
- Whether the requested operation is allowed by policy

### 47.2 Failure Behavior

- Missing handshake: fail fast.
- Incompatible schema: fail fast and emit `sidecar.handshake_failed`.
- Unknown capability: fail validation.
- Unsupported cancellation on a cancellable TaskNode: either reject the sidecar or mark the node as requiring non-cancellable execution approval.

---


## v1.5 Hardening Note: Startup Handshake

Every stdio sidecar must send a `hello` message on startup, declaring version, schemaVersion, operations, capabilities, cancellation support, and max input size. The host replies with `hello_ack` before accepting work.
