#!/usr/bin/env bash
set -euo pipefail

# Native Linux x86-64 qualification for D9 Phase F, requirement 1:
# "Run reproducible native Linux x86-64 tests and negative
#  crash/replay/approval/identity checks on the exact candidate tree;
#  retain logs and hashes, including build and source identities."
#
# Mirrors scripts/d9-qualify-linux-arm64.sh. Differences are deliberate and
# limited to the architecture gate and the suite list.
#
# This runner produces EVIDENCE. It does not certify the gate: it cannot
# supply the independent review REQ 2 requires, and a PASS here is not an
# owner's security-exception clearance.

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  echo "ERROR: must run inside the ALiX git repository" >&2
  exit 2
fi
cd "$ROOT"

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) ;;
  *)
    echo "ERROR: native Linux x86-64 qualification requires x86_64/amd64; observed: $arch" >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERROR: this qualification runner is Linux-only" >&2
  exit 2
fi

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "ERROR: qualification requires a clean worktree" >&2
  git status --short >&2
  exit 2
fi

commit="$(git rev-parse HEAD)"
tree="$(git rev-parse HEAD^{tree})"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="${1:-/tmp/alix-d9-x86-64-${stamp}}"
mkdir -p "$out"

{
  echo "qualification=d9-phase-f-linux-x86-64"
  echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit=$commit"
  echo "tree=$tree"
  echo "branch=$(git branch --show-current)"
  echo "uname=$(uname -a)"
  echo "uname_m=$arch"
  echo "node=$(node --version)"
  echo "node_platform_arch=$(node -p 'process.platform+"/"+process.arch')"
  echo "pnpm=$(pnpm --version)"
  echo "filesystem=$(findmnt -n -o SOURCE,TARGET,FSTYPE,OPTIONS -T "$ROOT" | tr -s ' ')"
  # Source identity beyond the commit: the lockfile decides what was actually
  # installed, and a dependency graph that differs from the tree is a
  # qualification that does not describe the candidate.
  echo "lockfile_sha256=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)"
  echo "package_json_sha256=$(sha256sum package.json | cut -d' ' -f1)"
} | tee "$out/environment.txt"

run() {
  local name="$1"; shift
  echo "== $name ==" | tee "$out/$name.log"
  "$@" 2>&1 | tee -a "$out/$name.log"
}

# Reproducibility precondition: the recorded lockfile must be the one that
# installs. A dirty install would mean the evidence describes a graph the
# commit does not pin.
run install-frozen pnpm install --frozen-lockfile
run build pnpm build

# Negative crash/replay checks. --test-concurrency=1 is required: these spawn
# real children, send real signals, and assert on durability after SIGKILL.
# Running them in parallel makes the signal timing itself the variable.
run negative-crash-replay node --test --test-concurrency=1 \
  dist/tests/security/effect-journal-sigkill.test.js \
  dist/tests/security/d9-sigkill-durability.test.js \
  dist/tests/security/d9-resumer-sigkill.test.js \
  dist/tests/security/approval-crash-recovery.test.js

# Negative approval/identity checks: single-use consumption, crash recovery
# between claim and effect, and identity binding.
run negative-approval node --test --test-concurrency=1 \
  dist/tests/security/legacy-approval-single-use.test.js \
  dist/tests/security/approval-consumed-propagation.test.js \
  dist/tests/security/worker-approval-atomic-restart.test.js

run focused-vitest pnpm exec vitest run \
  tests/security/effect-journal-dispatch-matrix.vitest.ts \
  tests/security/continuation-cancellation.vitest.ts \
  tests/security/d9-phase-f-shell-counterexamples.vitest.ts \
  tests/security/worker-approval-identity-acceptance.vitest.ts \
  --reporter=dot

# The rest of the gate remains green on the same candidate tree. Without
# these, a security suite could pass while the tree fails to typecheck.
run typecheck pnpm typecheck
run typecheck-unused pnpm typecheck:unused
run dox pnpm check:dox
run staleness pnpm check:staleness
run deps pnpm verify:deps
run lifecycle node scripts/verify-lifecycle-scripts.mjs
run supply-chain bash scripts/check-supply-chain.sh

git diff --check | tee "$out/diff-check.log"

(
  cd "$out"
  sha256sum environment.txt *.log > SHA256SUMS
)

cat > "$out/RESULT.txt" <<EOF
D9 Phase F Linux x86-64 native qualification: PASS
commit=$commit
tree=$tree
arch=$arch
node=$(node --version)
Evidence directory: $out

Scope of this evidence:
  - Native Linux x86-64 only, on the filesystem recorded above.
  - Process-crash/restart and process-tree scope only.

NOT claimed by this run:
  - Kernel crash, power loss, or generalized storage durability.
  - macOS, Windows, containers, network filesystems, or emulation.
  - Independent review (REQ 2). This is author-side execution evidence and
    cannot satisfy a requirement that forbids author self-certification.
  - Owner security-exception clearance (REQ 3). A PASS here is not that.
EOF

cat "$out/RESULT.txt"
