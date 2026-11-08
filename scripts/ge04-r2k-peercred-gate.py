"""GE-04-R2K: read-only Linux AF_UNIX peer identity consistency gate.

Kernel SO_PEERCRED ties the accepted socket to peer PID/UID/GID at connect.
The claimed identity from the peer is UNTRUSTED. This module never authorizes,
issues, clears custody, launches workers, or supplies production credentials.

SO_PEERCRED alone cannot authenticate the issuer's intended role, pin a PID
across reuse, or prove that the process still owns a trusted custody lock.
"""
from __future__ import annotations

import json
import os
import re
import socket
import struct
from pathlib import Path


def _bad(reason):
    return {"status": "blocked", "peerIdentityConsistent": False,
            "kernelPeer": None, "reasons": [reason,
            "trusted cross-UID issuer authority unqualified"]}


def _proc_generation(pid):
    """Best-effort /proc snapshot. No pidfd: races remain possible."""
    try:
        with open("/proc/%d/stat" % pid, encoding="ascii") as f:
            first = f.read()
        with open("/proc/%d/stat" % pid, encoding="ascii") as f:
            second = f.read()
        def parse(raw):
            end = raw.rfind(")")
            if end < 0 or raw[end+1:end+2] != " ":
                return None
            fields = raw[end+2:].split()
            if len(fields) < 20 or not re.fullmatch("[1-9][0-9]*", fields[19]):
                return None
            return fields[19]
        a, b = parse(first), parse(second)
        return a if a and a == b else None
    except OSError:
        return None


def inspect_peer_credentials(connection, claim, expected_issuer_uid,
                             forbidden_uids=(), *,
                             generation_reader=_proc_generation):
    """Inspect an *accepted* connected AF_UNIX socket, never client-supplied creds.

    UID inputs are deployment-policy assertions; providing them doesn't prove
    who provisioned that policy. Deny same UID as verifier, root, or forbidden
    worker/coordinator UIDs. A true consistency result remains HOLD.
    """
    if (os.name != "posix" or not hasattr(socket, "SO_PEERCRED")
            or connection.family != socket.AF_UNIX
            or connection.type & socket.SOCK_STREAM == 0):
        return _bad("unsupported or non-stream Unix peer socket")
    if (type(expected_issuer_uid) is not int or expected_issuer_uid <= 0
            or expected_issuer_uid == os.geteuid()
            or any(type(u) is not int or u < 0 for u in forbidden_uids)
            or expected_issuer_uid in forbidden_uids):
        return _bad("issuer UID not independently separated from verifier or worker")
    try:
        raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                                    struct.calcsize("3i"))
        if len(raw) != struct.calcsize("3i"):
            return _bad("malformed kernel peer credentials")
        pid, uid, gid = struct.unpack("3i", raw)
    except (OSError, ValueError, struct.error):
        return _bad("kernel peer credentials unavailable")

    peer = {"pid": pid, "uid": uid, "gid": gid}
    reasons = []
    if pid <= 1 or uid <= 0 or gid < 0:
        reasons.append("invalid kernel process or UID")
    if uid != expected_issuer_uid:
        reasons.append("kernel peer UID does not match configured issuer")
    if uid == os.geteuid() or uid in forbidden_uids:
        reasons.append("issuer not isolated from verifier/worker roles")
    if not isinstance(claim, dict) or set(claim) != {
            "schema", "pid", "uid", "gid", "startTimeTicks", "bootId"}:
        reasons.append("untrusted peer claim schema")
    else:
        if claim["schema"] != "ge04-r2k-v1":
            reasons.append("peer claim version mismatch")
        if (type(claim["pid"]) is not int or claim["pid"] != pid
                or type(claim["uid"]) is not int or claim["uid"] != uid
                or type(claim["gid"]) is not int or claim["gid"] != gid):
            reasons.append("peer claim contradicts kernel SO_PEERCRED")
        ticks = generation_reader(pid)
        if (not isinstance(claim["startTimeTicks"], str)
                or not re.fullmatch("[1-9][0-9]*", claim["startTimeTicks"])
                or ticks is None or claim["startTimeTicks"] != ticks):
            reasons.append("peer process generation absent or changed")
        try:
            boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
            if not isinstance(claim["bootId"], str) or claim["bootId"] != boot:
                reasons.append("peer kernel boot generation mismatch")
        except OSError:
            reasons.append("kernel boot generation unavailable")
    reasons.append("SO_PEERCRED is not privileged issuer authorization or pidfd custody")
    return {"status": "blocked", "kernelPeer": peer,
            "peerIdentityConsistent": len(reasons) == 1, "reasons": reasons}
