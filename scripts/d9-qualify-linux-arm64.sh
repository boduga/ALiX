#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  echo "ERROR: must run inside the ALiX git repository" >&2
  exit 2
fi
cd "$ROOT"

arch="$(uname -m)"
case "$arch" in
  aarch64|arm64) ;;
  *)
    echo "ERROR: native Linux ARM64 qualification requires aarch64/arm64; observed: $arch" >&2
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
out="${1:-/tmp/alix-d9-arm64-${stamp}}"
mkdir -p "$out"

{
  echo "qualification=d9-phase-f-linux-arm64"
  echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit=$commit"
  echo "tree=$tree"
  echo "branch=$(git branch --show-current)"
  echo "uname=$(uname -a)"
  echo "uname_m=$arch"
  echo "node=$(node --version)"
  echo "node_platform_arch=$(node -p 'process.platform+\"/\"+process.arch')"
  echo "pnpm=$(pnpm --version)"
  echo "filesystem=$(findmnt -n -o SOURCE,TARGET,FSTYPE,OPTIONS -T "$ROOT" | tr -s ' ')"
} | tee "$out/environment.txt"

run() {
  local name="$1"; shift
  echo "== $name ==" | tee "$out/$name.log"
  "$@" 2>&1 | tee -a "$out/$name.log"
}

run build pnpm build
run native-node node --test --test-concurrency=1 \
  dist/tests/shell-tool.test.js \
  dist/tests/security/effect-journal-sigkill.test.js \
  dist/tests/security/d9-sigkill-durability.test.js \
  dist/tests/security/d9-resumer-sigkill.test.js \
  dist/tests/security/approval-crash-recovery.test.js
run focused-vitest pnpm exec vitest run \
  tests/security/effect-journal-dispatch-matrix.vitest.ts \
  tests/security/continuation-cancellation.vitest.ts \
  tests/security/d9-phase-f-shell-counterexamples.vitest.ts \
  --reporter=dot
run typecheck-unused pnpm typecheck:unused
run dox pnpm check:dox
run deps pnpm verify:deps

git diff --check | tee "$out/diff-check.log"

(
  cd "$out"
  sha256sum environment.txt *.log > SHA256SUMS
)

cat > "$out/RESULT.txt" <<EOF
D9 Phase F Linux ARM64 native qualification: PASS
commit=$commit
tree=$tree
arch=$arch
Evidence directory: $out
No power-loss, macOS, Windows, container, network-filesystem, or non-native-emulation claim is made.
EOF

cat "$out/RESULT.txt"
