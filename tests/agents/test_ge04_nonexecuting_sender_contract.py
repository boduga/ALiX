"""Unprivileged C contract tests: never dispatch or authorize."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "native/ge04"
HARNESS = r"""
#include "nonexecuting-sender-contract.h"
#include <assert.h>
#include <stdint.h>
int main(void) {
    struct ge04_sender_contract c;
    ge04_sender_contract_init(&c, 100, 7);
    assert(!ge04_sender_contract_can_send(&c));
    assert(!ge04_sender_contract_can_ack(&c));
    assert(ge04_sender_contract_observe(&c, GE04_SC_RECORD_INTENT, 10, 7, 0)==0);
    assert(ge04_sender_contract_observe(&c, GE04_SC_RECORD_SEND, 20, 7, 0)==0);
    assert(ge04_sender_contract_observe(&c, GE04_SC_RECORD_REPLY, 30, 7, 5)==0);
    assert(ge04_sender_contract_observe(&c, GE04_SC_RECORD_JOB, 40, 7, 5)==0);
    assert(c.state==GE04_SC_JOB_OBSERVED);
    assert(!ge04_sender_contract_can_send(&c));
    assert(!ge04_sender_contract_can_ack(&c));
    assert(ge04_sender_contract_observe(&c, GE04_SC_RECORD_JOB, 50, 7, 5)<0);
    assert(c.state==GE04_SC_QUARANTINED);
    assert(ge04_sender_contract_observe(&c, GE04_SC_RECORD_INTENT, 60, 7, 0)<0);
    ge04_sender_contract_init(&c, 100, 7);
    assert(ge04_sender_contract_observe(&c, GE04_SC_RECORD_REPLY, 10, 7, 5)<0);
    assert(c.state==GE04_SC_QUARANTINED);
    ge04_sender_contract_init(&c, 100, 7);
    assert(ge04_sender_contract_observe(&c, GE04_SC_RECORD_INTENT, 101, 7, 0)<0);
    ge04_sender_contract_init(&c, 100, 7);
    assert(ge04_sender_contract_observe(&c, GE04_SC_RECORD_INTENT, 10, 8, 0)<0);
    ge04_sender_contract_init(&c, 100, 7);
    assert(ge04_sender_contract_observe(&c, GE04_SC_PROCESS_LOSS, 10, 7, 0)<0);
    ge04_sender_contract_init(&c, 0, 7);
    assert(c.state==GE04_SC_QUARANTINED);
    ge04_sender_contract_init(&c, 100, 0);
    assert(c.state==GE04_SC_QUARANTINED);
    return 0;
}
"""


class NonExecutingSenderContractTests(unittest.TestCase):
    def test_native_diagnostic_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="ge04-sc-") as directory:
            path = Path(directory)
            (path / "test.c").write_text(HARNESS)
            subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror",
                            "-I", str(SRC), str(path / "test.c"),
                            str(SRC / "nonexecuting-sender-contract.c"),
                            "-o", str(path / "test")], check=True, timeout=20)
            subprocess.run([str(path / "test")], check=True, timeout=5)

    def test_no_transport_or_privileged_symbols(self):
        code = (SRC / "nonexecuting-sender-contract.c").read_text()
        for forbidden in ("sd_bus_send(", "sd_bus_call(", "execve(",
                          "setuid(", "fork(", "system(", "StartTransientUnit"):
            self.assertNotIn(forbidden, code)
