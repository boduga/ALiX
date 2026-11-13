"""GE-04 non-authorizing dispatch-intent reducer tests (unprivileged only)."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parents[2] / "native/ge04"


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc"),
                     "Linux C compiler required")
class ProtectedTransactionStateTests(unittest.TestCase):
    def test_ambiguity_is_permanently_quarantined(self):
        source = r"""
#include "protected-transaction-state.h"
int main(void) {
    enum ge04_tx_state s = GE04_TX_UNOBSERVED;
    if (ge04_tx_can_retry(s)) return 1;
    s = ge04_tx_reduce(s, GE04_TX_RECORD_INTENT);
    if (s != GE04_TX_INTENT_RECORDED || ge04_tx_can_retry(s)) return 2;
    if (ge04_tx_reduce(s, GE04_TX_RESTART_WITH_INTENT) != GE04_TX_QUARANTINED)
        return 3;
    if (ge04_tx_reduce(s, GE04_TX_PROCESS_LOSS) != GE04_TX_QUARANTINED)
        return 4;
    s = ge04_tx_reduce(s, GE04_TX_BEGIN_SEND);
    if (s != GE04_TX_SEND_ATTEMPTED || ge04_tx_can_retry(s)) return 5;
    if (ge04_tx_reduce(s, GE04_TX_PROCESS_LOSS) != GE04_TX_QUARANTINED)
        return 6;
    s = ge04_tx_reduce(s, GE04_TX_OBSERVE_REPLY);
    if (s != GE04_TX_REPLY_OBSERVED || ge04_tx_can_retry(s)) return 7;
    if (ge04_tx_reduce(s, GE04_TX_BEGIN_SEND) != GE04_TX_QUARANTINED)
        return 8;
    for (int state = -1; state <= 9; ++state) {
        if (ge04_tx_can_retry((enum ge04_tx_state)state)) return 9;
        if (ge04_tx_reduce((enum ge04_tx_state)state,
                           GE04_TX_OBSERVATION_CONFLICT) != GE04_TX_QUARANTINED)
            return 10;
    }
    for (int event = 0; event <= 9; ++event) {
        if (ge04_tx_reduce(GE04_TX_QUARANTINED,
                           (enum ge04_tx_event)event) != GE04_TX_QUARANTINED)
            return 11;
    }
    if (ge04_tx_reduce(GE04_TX_UNOBSERVED, GE04_TX_OBSERVE_REPLY) !=
        GE04_TX_QUARANTINED) return 12;
    if (ge04_tx_reduce(GE04_TX_INTENT_RECORDED, GE04_TX_RECORD_INTENT) !=
        GE04_TX_QUARANTINED) return 13;
    return 0;
}
"""
        with tempfile.TemporaryDirectory(prefix="ge04-tx-state-") as tmp:
            root = Path(tmp)
            (root / "test.c").write_text(source)
            compile_result = subprocess.run(
                ["cc", "-std=c11", "-Wall", "-Wextra", "-Werror",
                 "-Wpedantic", "-Wconversion", "-Wshadow",
                 "-I", str(NATIVE), str(root / "test.c"),
                 str(NATIVE / "protected-transaction-state.c"),
                 "-o", str(root / "test")],
                capture_output=True, text=True, timeout=20)
            self.assertEqual(compile_result.returncode, 0,
                             compile_result.stderr)
            result = subprocess.run([str(root / "test")], capture_output=True,
                                    text=True, timeout=2)
            self.assertEqual(result.returncode, 0, result.stderr)
