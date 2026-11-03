# GE-04 — experimental supervisor manifest pinning

**SECURITY HOLD — no admission, helper execution, production integration, or authenticated build provenance.**

`experiments/ge04/supervisor-manifest.py` is a standalone Linux prototype that reads `helper.json` relative to a pinned, owner-only directory descriptor, refuses symlink manifest leaves, rejects group/other-writable, multiply linked or oversized manifest inodes, checks owner UID and metadata stability, and requires an exact `{version:1, helperSha256:<64 lowercase hex>}` schema. It then calls the existing isolated `prepare` preflight with the manifest digest, which validates and seals the helper and persists only a `NOT_AUTHORIZED` pre-spawn record.

Run `python3 -B experiments/ge04/test-supervisor-manifest.py`. The test covers a valid manifest, symlink substitution, mismatched digest, and unsafe directory permissions. A mismatch must not add an evidence record.

**Trust limitation:** this replaces a direct command-line digest with a manifest-file lookup; it does **not** establish independently authenticated provenance. A same-UID actor controlling the manifest directory, its ancestors, or the installation can replace the manifest or helper. There is no signature verification, root-owned installation requirement, cross-UID manifest access test, trusted deployment process, or mount/rename race exclusion. The standalone CLI also accepts a caller-selected manifest path. A production supervisor must pin a protected installation location and trusted digest through its own authenticated deployment authority, not a worker argument.

Next qualification: real privileged deployment-owner installation and distinct-UID denial of manifest replacement, with explicit approved build digest provenance. Then authenticated coordinator admission and crash-safe evidence. Nothing in this experiment clears GE-04.
