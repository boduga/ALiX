#!/usr/bin/env bash
set -euo pipefail

echo "Checking package manager policy..."

if [ -f package-lock.json ]; then
  echo "❌ package-lock.json is not allowed. Use pnpm-lock.yaml."
  exit 1
fi

if [ -f yarn.lock ]; then
  echo "❌ yarn.lock is not allowed. Use pnpm-lock.yaml."
  exit 1
fi

# Use -w for word-boundary matching so `pnpm install` is not caught by
# `npm install`. The same flag is why the npx pattern below must NOT carry a
# trailing space: `-w` anchors on word boundaries, so `-e "npx "` can never
# match and silently guards nothing.
#
# Executable surfaces (workflows, shell scripts, package.json) are checked for
# npm/npx. Documentation is checked for npm only: prose docs legitimately
# reference `npx tsx` for one-off operator commands, and a doc mention is not a
# package-manager choice. `npx` in a workflow or script IS one, because it
# resolves packages outside the lockfile at run time.
SEARCH_PATHS=(.github/workflows scripts package.json)
DOC_PATHS=(docs)

# Exemptions below: `npm publish`/`npm sbom` are not package-manager choices
# for the project. `npm install ...TARBALL` is sanctioned ONLY on the packed-
# artifact smoke path, which deliberately exercises the documented
# `npm install -g alix` resolution; every such site must install a tarball into
# a temporary directory. Project dependency management stays pnpm. The isolated
# OpenTUI spike (`experiments/opentui/`) deliberately carries its own npm
# lockfile and is never published, so its workflow commands and hand-off notes
# are exempt; no root or published dependency uses npm.

# Relocated history is exempt wherever it lives: B1 re-parented docs/archive/
# under docs/superseded/, and later batches land there too. Superseded docs
# are evidence, not live instructions.
# Common filters: the sanctioned non-choices, this script, and the isolated
# spike. Applied to every scan so the three surfaces below stay consistent.
filter_hits() {
  # Comment-only lines describe a policy; they do not execute it. Match on
  # the text after `file:line:`, so a comment naming `npm install -g alix`
  # (as the smoke-path rationale does) is not treated as a violation.
  grep -vE ':[0-9]+:[[:space:]]*#' \
    | grep -v "npm publish" \
    | grep -v "npm sbom" \
    | grep -vF "scripts/check-package-manager.sh:" \
    | grep -v "experiments/opentui"
}

# 1) Executable surfaces: npm and npx are both forbidden, except the packed-
#    artifact smoke install, which must name a tarball.
EXEC_HITS="$(
  grep -Rnw "${SEARCH_PATHS[@]}" \
    -e "npm ci" \
    -e "npm install" \
    -e "npm run" \
    -e "npx" \
    --include='*.yml' \
    --include='*.yaml' \
    --include='*.sh' \
    --include='package.json' \
    2>/dev/null \
    | filter_hits \
    | grep -v "npm install.*TARBALL" \
    || true
)"

# 2) Documentation: npm only, minus relocated/archived history (evidence, not
#    live instructions). The research note's historical "detect these
#    commands" prose is exempt by exact text, not by file, so new npm
#    instructions in that note are still rejected.
DOC_HITS="$(
  grep -Rnw "${DOC_PATHS[@]}" \
    -e "npm ci" \
    -e "npm install" \
    -e "npm run" \
    --include='*.md' \
    --include='package.json' \
    2>/dev/null \
    | filter_hits \
    | grep -v "docs/2026-10-09-node26-opentui-handoff.md" \
    | grep -v "docs/superseded/" \
    | grep -v "docs/superpowers/plans/" \
    | grep -v "docs/architecture/" \
    | grep -v "docs/stories/" \
    | grep -v "docs/PRD.md" \
    | grep -v "docs/implementation-plan.md" \
    | grep -v "docs/security/baseline-inventory.md" \
    | grep -v "docs/getting-started.md" \
    | grep -v "docs/user-manual.md" \
    | grep -vF 'Detect `npm test`, `npm run test`, `npm run typecheck`, `pytest`, `make test`' \
    || true
)"

if [ -n "$EXEC_HITS" ]; then
  echo "❌ npx/npm references in executable surfaces (.github/workflows, scripts, package.json):"
  printf '%s\n' "$EXEC_HITS"
  echo "   Use pnpm (pnpm exec / pnpm dlx) instead."
  exit 1
fi

if [ -n "$DOC_HITS" ]; then
  echo "❌ Disallowed npm references in documentation:"
  printf '%s\n' "$DOC_HITS"
  exit 1
fi

echo "✅ Package manager policy clean."
