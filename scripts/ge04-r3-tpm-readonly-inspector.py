"""GE-04 R3 TPM2B: read-only local TPM capability/NV inventory.

Never provisions, deletes, increments, extends, seals, unseals, or signs.
The inspector does NOT attest a TPM, administration, NV ownership or rollback
resistance. It does not use sudo or silently fall back to a simulator.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import stat
import subprocess
import yaml

ALLOWED = ("properties-fixed", "properties-variable", "ecc-curves", "handles-nv-index")
TPM = "/dev/tpmrm0"
HANDLE = re.compile(r"^0x[0-9a-fA-F]{1,8}$")
MAX_OUTPUT = 128 * 1024


def _blocked(reason, **extra):
    return {"status": "blocked", "securityHoldActive": True,
            "authorizationGranted": False, "hardwareQualified": False,
            "reason": reason, **extra}


def inspect_tpm(*, device=TPM, executor=subprocess.run):
    """Run only allowlisted *read* commands against a device char node."""
    if device != TPM:
        return _blocked("unexpected TPM device")
    try:
        metadata = os.stat(device)
        if not stat.S_ISCHR(metadata.st_mode):
            raise ValueError("TPM path is not a character device")
        inventory = {}
        for name in ALLOWED:
            result = executor(
                ["tpm2_getcap", "-T", "device:" + TPM, name],
                capture_output=True, text=True, timeout=8, check=False)
            if result.returncode != 0 or len(result.stdout) > MAX_OUTPUT:
                raise ValueError("TPM capability read failed: " + name)
            parsed = yaml.safe_load(result.stdout)
            if name == "handles-nv-index":
                if type(parsed) is not list or len(parsed) > 256:
                    raise ValueError("untrusted NV handle inventory")
                handles = []
                for item in parsed:
                    if type(item) is int and 0 <= item <= 0xFFFFFFFF:
                        handles.append(hex(item))
                    elif type(item) is str and HANDLE.fullmatch(item):
                        handles.append(item.lower())
                    else:
                        raise ValueError("invalid NV handle")
                inventory["existingHandles"] = tuple(handles)
            elif type(parsed) is not dict or not parsed:
                raise ValueError("malformed TPM capability output")
            else:
                inventory[name] = parsed
        fixed = inventory["properties-fixed"]
        variable = inventory["properties-variable"]
        family = fixed.get("TPM2_PT_FAMILY_INDICATOR")
        # tpm2-tools may format raw/value, but do not assume target TPM from
        # manufacturer, count, or user-supplied data.
        if (type(family) is not dict or family.get("value") != "2.0" or
                not isinstance(variable.get("TPM2_PT_PERMANENT"), dict)):
            raise ValueError("TPM family/permission data missing")
        # Observation still blocked; runtime root policy and credentials
        # are not proven by reading these values.
        return _blocked("read-only TPM inventory observed; not provisioned",
                        inventoryObserved=True, inventory=inventory)
    except (OSError, ValueError, yaml.YAMLError, subprocess.SubprocessError,
            TypeError, UnicodeError):
        return _blocked("TPM unavailable, denied, or malformed")


def inspect_nv_public(handle: str, *, device=TPM, executor=subprocess.run):
    """Read metadata for one caller-named handle; never infer its ownership."""
    if device != TPM or type(handle) is not str or not HANDLE.fullmatch(handle):
        return _blocked("invalid TPM device or NV handle")
    try:
        metadata = os.stat(device)
        if not stat.S_ISCHR(metadata.st_mode):
            raise ValueError("not a TPM device")
        result = executor(
            ["tpm2_nvreadpublic", "-T", "device:" + TPM, handle],
            capture_output=True, text=True, timeout=8, check=False)
        if result.returncode != 0 or len(result.stdout) > MAX_OUTPUT:
            raise ValueError("public NV read failed")
        parsed = yaml.safe_load(result.stdout)
        if type(parsed) is not dict or len(parsed) != 1:
            raise ValueError("invalid NV metadata")
        public = next(iter(parsed.values()))
        if type(public) is not dict or "attributes" not in public or "size" not in public:
            raise ValueError("missing NV attributes")
        return _blocked("NV public metadata only; never reuse existing index",
                        nvPublicObserved=True, handle=handle, metadata=public)
    except (OSError, ValueError, yaml.YAMLError, subprocess.SubprocessError,
            TypeError, UnicodeError):
        return _blocked("NV metadata unavailable or malformed")


if __name__ == "__main__":
    import json
    print(json.dumps(inspect_tpm(), indent=2))
