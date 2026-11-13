"""GE-04 R1-B1 bootstrap publisher qualification contract, NOT root-ready.

This module accepts three *caller-supplied* records: prebirth intent,
systemd-manager observation, and kernel observation. It rejects disagreement
and changing evidence, then can issue a sealed test-only memfd **unprivileged**.
It does not authenticate source custody or create a service/cgroup/journal.
The privileged publisher is an unconditional refusal pending security review.
"""
try:
    import fcntl
except ImportError:
    fcntl = None
import json
import os
import re
import sys
from types import MappingProxyType

from bootstrap_binding import (
    LIMIT, SEALS, SUPPORTED, UNIT, parse_bootstrap_binding,
)

_FIELDS = frozenset((
    "invocation", "unit", "keeperPid", "keeperTicks",
    "mountId", "mountDevice", "mountRoot", "ancestry",
    "attempt", "nonce", "sourceSha256", "controllerSha256",
))
_MANAGER_FIELDS = frozenset((
    "unit", "invocation", "mainPid", "controlGroup",
    "activeState", "subState", "restartCount", "startTicks",
))
_KERNEL_FIELDS = frozenset((
    "keeperPid", "keeperTicks", "mountId", "mountDevice",
    "mountRoot", "ancestry", "scope", "keeperState", "unitPresent",
))


def _exact(mapping, fields):
    if type(mapping) is not dict or frozenset(mapping) != fields:
        raise ValueError("Incomplete or unsupported qualification record")


def validate_prepublished_evidence(prebirth, manager, kernel):
    """Pure reconciliation, never an authorization or authenticating oracle.

    A real publisher MUST obtain records from independently protected sources
    and prove manager/kernel custody. Python callers may forge all three.
    """
    _exact(prebirth, _FIELDS)
    _exact(manager, _MANAGER_FIELDS)
    _exact(kernel, _KERNEL_FIELDS)
    if not all(type(item) is str for item in (
            prebirth["invocation"], prebirth["unit"],
            prebirth["nonce"], prebirth["sourceSha256"],
            prebirth["controllerSha256"])):
        raise ValueError("Malformed prebirth text")
    if (prebirth["unit"] != UNIT
            or re.fullmatch(r"[0-9a-f]{32}", prebirth["invocation"]) is None
            or any(re.fullmatch(r"[0-9a-f]{64}", prebirth[key]) is None
                   for key in ("nonce", "sourceSha256", "controllerSha256"))):
        raise ValueError("Invalid fixed qualification identity")
    if (type(prebirth["attempt"]) is not int or prebirth["attempt"] <= 0
            or prebirth["attempt"] >= 2**63):
        raise ValueError("Invalid attempt fence")
    expected_scope = "/system.slice/" + UNIT
    if (manager["unit"] != UNIT
            or manager["invocation"] != prebirth["invocation"]
            or manager["controlGroup"] != expected_scope
            or manager["activeState"] != "active"
            or manager["subState"] != "running"
            or type(manager["restartCount"]) is not int
            or manager["restartCount"] != 0
            or type(manager["mainPid"]) is not int
            or manager["mainPid"] != prebirth["keeperPid"]
            or type(manager["startTicks"]) is not int
            or manager["startTicks"] != prebirth["keeperTicks"]):
        raise ValueError("Unbound or restarted systemd invocation")
    if (kernel["scope"] != expected_scope
            or kernel["keeperState"] not in ("R", "S", "D")
            or kernel["unitPresent"] is not True
            or any(kernel[field] != prebirth[field] for field in (
                "keeperPid", "keeperTicks", "mountId", "mountDevice",
                "mountRoot", "ancestry"))):
        raise ValueError("Kernel view contradicts original unit binding")
    # Reuse existing exact, canonical closed bootstrap shape, rather than
    # generating new identities from the currently observed process.
    payload = dict(prebirth)
    payload["schemaVersion"] = 1
    payload["ancestry"] = [list(pair) for pair in prebirth["ancestry"]]
    encoded = (json.dumps(payload, sort_keys=True, separators=(",", ":"))
               + "\n").encode("ascii")
    if len(encoded) > LIMIT:
        raise ValueError("Oversized qualified bootstrap data")
    canonical = parse_bootstrap_binding(encoded)
    return MappingProxyType({
        "status": "UNQUALIFIED_PREBIRTH_RECONCILIATION",
        "record": canonical,
        "canonicalBytes": encoded,
    })


def prepare_unprivileged_fixture_fd(prebirth, read_manager, read_kernel):
    """Create a sealed FD *only* for unprivileged contract tests.

    Never run this as root, including on a disposable VM. The real root
    publisher must be a separate, independently reviewed implementation.
    """
    if not SUPPORTED or not hasattr(os, "memfd_create"):
        raise RuntimeError("Linux sealed memfd unavailable")
    if os.geteuid() == 0:
        raise PermissionError("Privileged bootstrap publisher disabled")
    if not callable(read_manager) or not callable(read_kernel):
        raise ValueError("Missing independent observation readers")
    before = validate_prepublished_evidence(
        prebirth, read_manager(), read_kernel())
    first = before["canonicalBytes"]
    # Reader contracts are executed twice; this refuses source changes but
    # cannot prove those readers access independent privileged authorities.
    after = validate_prepublished_evidence(
        prebirth, read_manager(), read_kernel())
    if first != after["canonicalBytes"]:
        raise ValueError("Bootstrap evidence changed during reconciliation")
    fd = os.memfd_create("ge04-unqualified-bootstrap",
                         os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
    try:
        written = os.write(fd, first)
        if written != len(first):
            raise OSError("Short bootstrap fixture write")
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, SEALS)
        if fcntl.fcntl(fd, fcntl.F_GET_SEALS) != SEALS:
            raise ValueError("Fixture sealing failed")
        return fd
    except BaseException:
        os.close(fd)
        raise


def publish_root_bootstrap(*_args, **_kwargs):
    """No privileged publisher can be activated from this qualification code."""
    raise PermissionError("GE-04 SECURITY HOLD: root publisher unimplemented")
