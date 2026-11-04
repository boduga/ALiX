#!/usr/bin/env python3
"""SUP-16 inert fail-closed descriptor provenance contract.

Pure policy fixture: NOT a real identity attestation or OS isolation.
"""

def classify_descriptor(evidence):
    if type(evidence) is not dict or set(evidence) != {
        'version', 'originPid', 'currentHolderPid',
        'delegated', 'identityFresh', 'rolePinned'
    }:
        return 'UNVERIFIED'
    if (type(evidence['version']) is not int or evidence['version'] != 1
            or type(evidence['originPid']) is not int or evidence['originPid'] <= 0
            or type(evidence['currentHolderPid']) is not int or evidence['currentHolderPid'] <= 0
            or type(evidence['delegated']) is not bool
            or type(evidence['identityFresh']) is not bool
            or type(evidence['rolePinned']) is not bool):
        return 'UNVERIFIED'
    if (evidence['delegated'] or
            evidence['originPid'] != evidence['currentHolderPid'] or
            not evidence['identityFresh'] or not evidence['rolePinned']):
        return 'UNVERIFIED'
    # Caller-provided evidence cannot establish holder provenance.
    return 'SAME_HOLDER_CLAIM_UNTRUSTED'
