#!/usr/bin/env python3
"""Read-only R2R hardware-root readiness gate, NOT GE-04 authorization.

This tool does not allocate TPM indices, install packages, sign attestations,
modify witness state, or lift the security hold. It refuses to claim a trusted
key or external floor merely because a local file contains those values.
"""
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
PIN_PATH = ROOT / "docs/audits/evidence/ge04/r2r-qualification-witness-pin.json"


def assess(*, pin, tpm_version, utilities, operator_attestation=False,
           tpm_counter_provisioned=False, counter_binding_verified=False):
    """An explicit readiness checklist; callers cannot authorize GE-04."""
    expected = hashlib.sha256(bytes.fromhex(pin["publicKeyHex"])).hexdigest()
    checks = {
        "tpm2DeviceDetected": tpm_version == "2",
        "tpmToolsAvailable": all(utilities.values()),
        "operatorKeyProvenanceVerified": operator_attestation is True,
        "independentCounterProvisioned": tpm_counter_provisioned is True,
        "counterBoundToWitnessIdentity": counter_binding_verified is True,
    }
    reasons = [key for key, passed in checks.items() if not passed]
    return {
        "status": "blocked",
        "securityHoldActive": True,
        "witnessKeySha256": expected,
        "readinessChecks": checks,
        "unresolved": reasons,
        "independentAuthorityQualified": False,
        "rollbackResistant": False,
        "notes": "Explicit operator ceremony and hardware counter verification required; no source-controlled JSON is an authoritative floor.",
    }


def inspect():
    pin = json.loads(PIN_PATH.read_text())
    if (pin.get("trustStatus") != "unverified-operator-pin"
            or pin.get("authorization") is not False):
        raise ValueError("unexpected qualification pin status")
    key = bytes.fromhex(pin["publicKeyHex"])
    if len(key) != 32:
        raise ValueError("invalid Ed25519 public key")
    tpm_file = Path("/sys/class/tpm/tpm0/tpm_version_major")
    version = tpm_file.read_text().strip() if tpm_file.exists() else None
    commands = {name: shutil.which(name) is not None for name in (
        "tpm2_getcap", "tpm2_nvreadpublic", "tpm2_nvread", "tpm2_nvincrement")}
    return assess(pin=pin, tpm_version=version, utilities=commands)


if __name__ == "__main__":
    try:
        print(json.dumps(inspect(), sort_keys=True, indent=2))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "blocked", "securityHoldActive": True,
                          "reason": type(exc).__name__}))
    sys.exit(78)
