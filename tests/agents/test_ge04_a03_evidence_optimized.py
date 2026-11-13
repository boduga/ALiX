"""GE-04 evidence validation must not silently skip assertions under -O."""
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CHECKERS = [
    'authority-completeness',
    'effect-dossiers',
    'final-reconciliation',
    'historical-current-map',
    'six-stage-gates',
]


@pytest.mark.parametrize('checker', CHECKERS)
def test_evidence_checker_refuses_optimized_interpreter(checker):
    path = ROOT / 'scripts' / f'check-ge04-a03-02-{checker}.py'
    result = subprocess.run(
        [sys.executable, '-O', str(path)],
        cwd=ROOT, capture_output=True, text=True, timeout=20,
    )
    assert result.returncode != 0
    assert 'refuses optimized Python' in result.stderr + result.stdout
