#!/usr/bin/env bash
# platform-matrix.sh — Verify cross-platform compatibility
#
# Check 1: Path separator (hardcoded '/' vs path.join)
# Check 2: process.env.HOME vs os.homedir()
# Check 3: Unix-specific signals
# Check 4: Requires root or sudo
# Check 5: Binary file permissions
#
# Exit codes: 0 = clean, 1 = warnings found

set -euo pipefail
cd "$(dirname "$0")/.."

EXIT_CODE=0

echo "=== Cross-Platform Compatibility Check ==="

# Check 1: Hardcoded '/' paths that should be path.join
echo ""
echo "--- Check 1: Hardcoded path separators ---"
found_path_sep=0
# Look for patterns like '/' + variable or '/' + path segments
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)
  # Skip joins, template literals with paths, and common patterns
  if echo "$content" | grep -qP "['\"/].+['\"]\s*\+\s*\$"; then
    echo "  WARN: $file:$linenum — potential hardcoded separator: $content"
    found_path_sep=$((found_path_sep + 1))
    EXIT_CODE=1
  fi
done < <(grep -rnP "'/'\s*\+|\"/\"\s*\+" src/ --include='*.ts' 2>/dev/null || true)
if [ "$found_path_sep" -eq 0 ]; then
  echo "  PASS"
fi

# Check 2: process.env.HOME vs os.homedir()
echo ""
echo "--- Check 2: Home directory resolution ---"
found_home_var=0
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  # Skip test files and known good patterns
  if echo "$file" | grep -q "/tests/"; then continue; fi
  echo "  WARN: $file:$linenum — uses process.env.HOME (use os.homedir() for portability)"
  found_home_var=$((found_home_var + 1))
  EXIT_CODE=1
done < <(grep -rn "process.env.HOME" src/ --include='*.ts' 2>/dev/null || true)
if [ "$found_home_var" -eq 0 ]; then
  echo "  PASS"
fi

# Check 3: Unix-specific signals
echo ""
echo "--- Check 3: Unix-specific signals ---"
found_signal=0
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)
  # SIGTERM, SIGKILL, SIGINT are universally supported
  if echo "$content" | grep -qP "SIGUSR|SIGHUP|SIGPIPE"; then
    echo "  WARN: $file:$linenum — platform-specific signal: $content"
    found_signal=$((found_signal + 1))
    EXIT_CODE=1
  fi
done < <(grep -rn "SIG" src/ --include='*.ts' 2>/dev/null || true)
if [ "$found_signal" -eq 0 ]; then
  echo "  PASS"
fi

# Check 4: File permissions / chmod (Windows-incompatible)
echo ""
echo "--- Check 4: File permission operations ---"
found_chmod=0
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  echo "  WARN: $file:$linenum — chmod is no-op on Windows"
  found_chmod=$((found_chmod + 1))
  EXIT_CODE=1
done < <(grep -rn "chmod\|0o755\|0o644" src/ --include='*.ts' 2>/dev/null || true)
if [ "$found_chmod" -eq 0 ]; then
  echo "  PASS"
fi

# Check 5: Shell execution assumptions
echo ""
echo "--- Check 5: Shell execution ---"
found_shell=0
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  linenum=$(echo "$line" | cut -d: -f2)
  # Accept /bin/sh, /bin/bash — flag /bin/zsh, /bin/fish, etc.
  if echo "$line" | grep -qP "/bin/(zsh|fish|dash|ksh)"; then
    echo "  WARN: $file:$linenum — non-portable shell"
    found_shell=$((found_shell + 1))
    EXIT_CODE=1
  fi
done < <(grep -rn "sh\|bash\|zsh" src/ --include='*.ts' 2>/dev/null || true)

# Summary
echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "✅ All cross-platform checks passed."
else
  echo "⚠️  Warnings found (non-blocking, review recommended)."
fi

exit "$EXIT_CODE"
