#!/bin/bash

set -e


# Check: governance must not depend on execution-governor
if grep -R "execution-governor" src/governance --include="*.ts" 2>/dev/null; then
    echo "FAIL: governance imports execution-governor"
    exit 1
fi


# Check: runtime must not depend on governance (import coupling, not documentation)
if grep -RP "(from\s+['\"]|require\()" src/runtime --include="*.ts" \
    | grep -i "governance" 2>/dev/null; then
    echo "FAIL: runtime imports governance"
    exit 1
fi


echo "Boundary checks passed"
