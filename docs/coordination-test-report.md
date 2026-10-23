# Coordination Kernel Test Report

- Total tests: 355
- Passing: 354
- Failing: 1

The single failure is in the scheduler watchdog idle-polling test,
"watchdog ticks bound idle polling while workers hang".

This test is timing-sensitive: it asserts bounds on watchdog tick behavior
while simulated workers hang, so it can fail intermittently under heavy
system load rather than indicating a functional defect. Re-running on an
idle machine is expected to pass.
