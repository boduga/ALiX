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

# Use -w for word-boundary matching so pnpm install is not caught by npm install
SEARCH_PATHS=(.github/workflows scripts docs package.json)

# Exemptions below: `npm publish`/`npm sbom` are not package-manager choices
# for the project; `npm install ...$TARBALL` is the sanctioned smoke-install of
# a PACKED tarball in a clean temp dir (pinning the tarball and its native
# builds), because pnpm's tarball install trips ERR_PNPM_IGNORED_BUILDS for
# protobufjs/sharp. Project dependency management stays pnpm.

if grep -Rnw "${SEARCH_PATHS[@]}" \
  -e "npm ci" \
  -e "npm install" \
  -e "npm run" \
  -e "npx " \
  --include='*.yml' \
  --include='*.yaml' \
  --include='*.sh' \
  --include='*.md' \
  --include='package.json' \
  2>/dev/null \
  | grep -v "npm publish" \
  | grep -v "npm sbom" \
  | grep -v "npm install.*TARBALL" \
  | grep -v "package-manager" \
  | grep -v "check-supply-chain.sh" \
  | grep -v "docs/archive/" \
  | grep -v "docs/superpowers/plans/" \
  | grep -v "docs/architecture/" \
  | grep -v "docs/stories/" \
  | grep -v "docs/PRD.md" \
  | grep -v "docs/implementation-plan.md" \
  | grep -v "docs/security/baseline-inventory.md" \
  | grep -v "docs/getting-started.md" \
  | grep -v "docs/user-manual.md"; then
  echo "❌ Found disallowed npm/npx references."
  exit 1
fi

echo "✅ Package manager policy clean."
