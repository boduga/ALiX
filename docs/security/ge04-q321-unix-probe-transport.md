# GE-04 Q3.21 continuation — Unix probe transport seam

**SECURITY HOLD ACTIVE. No authenticated production IPC or credential delivery.**

`createBrokerProbeServer` creates a Unix-domain socket listener with a mandatory `attestPeer(socket)` callback. Before acknowledging a connection it calls the attestor and applies the existing distinct-UID peer policy. It never reads request data, accepts claimed UID/PID from a request, or transports secrets. A missing attestor fails construction; failed attestation or policy mismatch destroys the connection. The probe is not wired into the scheduler, broker authorizer, or child.

The callback is a **trust boundary**, not an implementation of OS peer authentication. Unit tests use injected synthetic peer identities; they do not demonstrate kernel `SO_PEERCRED`/`getpeereid` or real distinct-UID process isolation. Node's `net.Socket` does not by itself expose a verified peer UID/PID here. The socket pathname is not permission-hardened, and the current probe has no timeout, concurrency limits or request framing. Do not run this as a production broker.

Next: implement and validate a native/kernel-attested peer adapter (with real distinct-UID integration tests), broker-owned socket permissions, bounded transport lifecycle, and atomic durable replay integrated with current-claim revalidation. Do not connect any secret material until these gates pass.
