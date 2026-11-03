# GE-04 — floor update process interruption fixture

**SECURITY HOLD — no power-loss durability claim.**

The root-gated `test-floor-interruption-root.py` injects abrupt child-process exit at two boundaries in the cooperative floor updater: (1) after the staged floor has been written and fsynced but before rename; (2) after rename but before the containing directory is fsynced. The first leaves an orphan stage and the committed floor unchanged. A fresh updater must recover the advisory lock and advance normally. The second exposes the renamed floor to subsequent processes, which must reject rollback. CI runs the test under root and checks its explicit PASS marker.

These are **process-exit** experiments, not power cuts. The post-rename, pre-directory-fsync state is not proven durable across a machine crash; a real reboot may reveal the old or new directory entry. The fixture does not test storage hardware cache behavior, corrupt/torn filesystem metadata, an attacker with root privileges, or release-publication/floor atomicity. A production supervisor must define fail-closed recovery when publication and floor advancement diverge. No production enablement.
