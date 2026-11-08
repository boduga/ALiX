"""GE-04-R2H: read-only independently provisioned custody manifest verifier.

Qualification-only. This does not establish an independent privileged issuer,
exclusive writer authority, or clearance. Never launches or mutates anything.
The reference manifest must be provisioned separately from worker inputs.
"""
import json
import os
import stat

_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
_FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
_FIELDS = {"schema", "registrationId", "coordinationRunId", "workerId",
           "attempt", "pid", "uid", "startTimeTicks", "bootId",
           "cgroupRelative", "cgroupDevice", "cgroupInode"}


def _bad(message):
    return {"status": "blocked", "manifestVerified": False,
            "reason": message}


def _read_manifest(path, *, required_uid=0):
    """Walk absolute parent components without following symlinks.

    Reject untrusted write ownership/permissions and file replacement.
    A descriptor is retained while its content is read. Parent path can still
    be swapped after the walk; this is not a production trust boundary.
    """
    if not isinstance(path, str) or not path.startswith("/") or "\0" in path:
        raise ValueError("manifest path must be absolute")
    parts = path[1:].split("/")
    if len(parts) < 2 or any(p in ("", ".", "..") for p in parts):
        raise ValueError("manifest path is unsafe")
    handles = []
    try:
        root_fd = os.open("/", _DIRECTORY_FLAGS)
        handles.append(root_fd)
        for part in parts[:-1]:
            fd = os.open(part, _DIRECTORY_FLAGS, dir_fd=handles[-1])
            handles.append(fd)
            info = os.fstat(fd)
            if info.st_uid not in (0, required_uid) or info.st_mode & 0o022:
                raise PermissionError("untrusted manifest parent")
        fd = os.open(parts[-1], _FILE_FLAGS, dir_fd=handles[-1])
        handles.append(fd)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != required_uid or info.st_mode & 0o077:
            raise PermissionError("untrusted manifest file")
        if info.st_nlink != 1 or info.st_size <= 0 or info.st_size > 4096:
            raise ValueError("invalid manifest size or hardlinks")
        with os.fdopen(os.dup(fd), "rb") as reader:
            data = reader.read(4097)
        after = os.fstat(fd)
        if (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns
        ):
            raise ValueError("manifest changed while reading")
        if len(data) != info.st_size:
            raise ValueError("manifest changed or short read")
        return json.loads(data.decode("utf-8"))
    finally:
        for fd in reversed(handles):
            os.close(fd)


def verify_recovery_manifest(path, record, expected_cgroup_relative, *,
                             boot_id=None, required_uid=0):
    """Compare separately provisioned identity and kernel boot generation.

    Worker-controlled record is never trusted. required_uid is only
    injectable for unprivileged unit fixtures; production use MUST require 0.
    Even perfect matches return blocked, not authorization.
    """
    try:
        manifest = _read_manifest(path, required_uid=required_uid)
        if not isinstance(manifest, dict) or set(manifest) != _FIELDS or manifest["schema"] != "ge04-r2h-v1":
            return _bad("unknown or incomplete manifest schema")
        for name in ("registrationId", "coordinationRunId", "workerId",
                     "startTimeTicks", "bootId", "cgroupRelative"):
            if not isinstance(manifest[name], str) or not manifest[name]:
                return _bad("invalid manifest field")
        for name in ("attempt", "pid", "uid", "cgroupDevice", "cgroupInode"):
            if type(manifest[name]) is not int or manifest[name] < 1:
                return _bad("invalid numeric manifest field")
        if not isinstance(record, dict) or not isinstance(record.get("worker"), dict) or not isinstance(record.get("process"), dict):
            return _bad("invalid recovery record")
        worker, process = record["worker"], record["process"]
        checks = {
            "registrationId": record.get("registrationId"),
            "coordinationRunId": worker.get("coordinationRunId"),
            "workerId": worker.get("workerId"),
            "attempt": worker.get("attempt"),
            "pid": process.get("pid"),
            "uid": process.get("uid"),
            "startTimeTicks": process.get("startTimeTicks"),
        }
        if any(manifest[name] != value or type(manifest[name]) is not type(value)
               for name, value in checks.items()):
            return _bad("durable registration/process identity mismatch")
        if not isinstance(expected_cgroup_relative, str) or manifest["cgroupRelative"] != expected_cgroup_relative:
            return _bad("cgroup path mismatch")
        if boot_id is None:
            with open("/proc/sys/kernel/random/boot_id", encoding="ascii") as f:
                boot_id = f.read().strip()
        if manifest["bootId"] != boot_id:
            return _bad("kernel boot generation mismatch")
        return {"status": "blocked", "manifestVerified": True,
                "reason": "manifest consistency only; independent issuer and live custody unproven",
                "expectedCgroup": {"relative": manifest["cgroupRelative"],
                                   "device": manifest["cgroupDevice"],
                                   "inode": manifest["cgroupInode"]}}
    except (OSError, ValueError, KeyError, TypeError, UnicodeError, json.JSONDecodeError) as exc:
        return _bad("manifest unreadable or untrusted: " + type(exc).__name__)
