# GE-04 qualification image bytes

GE-04 SECURITY HOLD remains active. This module is disconnected packaging and
integrity tooling, not a worker backend or containment/admission implementation.

`native/ge04/oci_qualification_image.py` builds a fixed Linux amd64 OCI image
layout from one opaque immutable byte payload of 1 byte through 1 MiB. It performs
no filesystem, extraction, process or network operation and has no CLI or runtime
consumer. A nonexecutable payload is intentionally valid: matching a digest does
not establish executable safety, reviewed-source provenance or runtime custody.

## Cross-platform placement boundary (proposed ADR-0019)

This image format is **Linux amd64-specific** by construction. A Windows or
macOS controller does not turn it into a host-native image, and an ARM64 Linux
guest cannot use its architecture-specific payload without a separately
defined, independently pinned ARM64 build and qualification. A future Linux
VM/remote execution placement must independently verify the exact guest CPU
architecture, kernel/runtime release, image provenance, unpacked-root custody,
mount/namespace/cgroup containment and worker registration. Image digest
consistency is integrity evidence only.

See [ADR-0019](../architecture/adrs/ADR-0019-cross-platform-worker-execution.md).
No image format, builder API or production runtime is changed by this proposal.
GE-04 SECURITY HOLD remains active.

## Interface and bounds

- `build_qualification_image(probe)` returns a frozen image with a private-dict
  mapping proxy of file bytes and a detached frozen consistency receipt.
- `verify_qualification_image(files, expected_probe_digest)` accepts only an
  exact built-in dictionary of exact strings to immutable bytes. It requires a
  separately supplied `sha256:<64lowerhex>` payload pin. Proxies/subclasses are
  rejected before their methods can run. A trusted caller can explicitly copy
  the known builder output with `dict(image.files)` before verification.
- Receipt schema1 contains manifest, layer and probe digests. It is not a grant,
  signature, unpacked-root receipt or observed device/inode binding.
- Exactly five files, at most 2 MiB total content; metadata objects at most
  16 KiB each; layer at most 1,053,184 bytes. Paths are the two fixed metadata
  names and three lowercase SHA-256 blob paths. No paths are opened.

The image contains `oci-layout`, `index.json` and config/layer/manifest blobs.
JSON is compact, sorted ASCII with exact field sets. The single uncompressed
USTAR layer has seven entries in order: `dev`, `probe`, `proc`, `run`, `run/alix`,
`tmp`, `workspace`. All owners are root, timestamps zero, names canonical,
directories0755 except tmp01777, probe0555. Headers are fixed byte encodings;
file padding is zero and exactly two zero blocks terminate the layer.

Image defaults name UID/GID20002, `/probe`, `/workspace`, a minimal environment
and a qualification-only label. These defaults are not an effective OCI runtime
policy or evidence that a runtime honors them. The root directory, runtime `/dev`
devices and mount policy are outside this format. No generic OCI compatibility,
tar extraction, shell, base image or registry access is provided.

Verification follows bounded descriptors, checks hashes/sizes/media, decodes only
the fixed layer inventory, checks the caller's payload pin, reconstructs the
entire expected image and compares all bytes. Unknown fields, alternate JSON,
duplicate keys, floats/nonfinite values, malformed/deep metadata, links/devices,
extensions, traversal, altered metadata/padding and trailing bytes deny with
`ValueError`. Rehashing a malicious image does not bypass its fixed schema;
rehashing a changed payload does not bypass the original caller pin.

## Verification and remaining work

```sh
python3 -B -m unittest discover -s tests/agents -p test_ge04_oci_image.py -v
```

Tests independently read the layer with Python tarfile and resolve/hash the OCI
blob graph, pin a separately derived golden fingerprint, cover boundary/type
checks and rehash malicious variants through their enclosing descriptors. No
image is executed or extracted. This is format/integrity evidence only.

The operator selected pinned worker images, native byte streams and an outer
supervisor-owned cgroup with a runc-owned payload group. Full native lifecycle,
protected registration/recovery records, effective bundle/root custody, exact
runtime/syscall policy, hostile worker, bounded task fragmentation and Node image
remain unresolved implementation/qualification gates. The existing single-leaf
fixture evidence does not qualify that new nested layout. No production keys,
broker activation, privileged application service or createScopedMutationService.

The format follows the primary OCI Image Spec v1.1.0
[layout](https://github.com/opencontainers/image-spec/blob/v1.1.0/image-layout.md),
[manifest](https://github.com/opencontainers/image-spec/blob/v1.1.0/manifest.md) and
[configuration](https://github.com/opencontainers/image-spec/blob/v1.1.0/config.md)
contracts, restricted to this one canonical qualification layout.
