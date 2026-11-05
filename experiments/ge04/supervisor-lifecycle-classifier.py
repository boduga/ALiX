#!/usr/bin/env python3
"""GE-04 pure test-only recovery classifier: NO mutation authority or receipt proof."""
import hashlib
import json

FIELDS = {'version', 'attemptId', 'requestDigest', 'approvalConsumed', 'phase',
          'sequence', 'terminalRecordDigest'}
PHASES = {'PREPARED', 'EFFECT_OBSERVED_UNVERIFIED', 'SETTLED_UNVERIFIED'}
UNCERTAIN = 'UNCERTAIN_NO_REPLAY'

def canonical_request_digest(request):
    if not isinstance(request, dict) or not request or any(not isinstance(k, str) for k in request):
        raise ValueError('invalid request')
    raw = json.dumps(request, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                     allow_nan=False).encode('utf-8')
    return hashlib.sha256(b'ALiX-GE04-REQUEST-v1\0' + raw).hexdigest()

def parse_record(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= 4096:
        raise ValueError('invalid record length')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate key')
            result[key] = value
        return result
    data = json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite number')))
    if (type(data) is not dict or set(data) != FIELDS or
            type(data['version']) is not int or data['version'] != 1 or
            type(data['attemptId']) is not str or not data['attemptId'] or len(data['attemptId']) > 256 or
            type(data['requestDigest']) is not str or len(data['requestDigest']) != 64 or
            any(c not in '0123456789abcdef' for c in data['requestDigest']) or
            type(data['approvalConsumed']) is not bool or
            type(data['phase']) is not str or data['phase'] not in PHASES or
            type(data['sequence']) is not int or data['sequence'] < 1 or
            (data['terminalRecordDigest'] is not None and
             (type(data['terminalRecordDigest']) is not str or
              len(data['terminalRecordDigest']) != 64 or
              any(c not in '0123456789abcdef' for c in data['terminalRecordDigest']))) or
            (data['phase'] != 'SETTLED_UNVERIFIED' and data['terminalRecordDigest'] is not None)):
        raise ValueError('invalid record schema')
    return data

def classify_recovery(raw, *, expected_attempt, expected_request_digest, minimum_sequence=1):
    """Never return SUCCESS or permit replay. No external attestation."""
    try:
        record = parse_record(raw)
        if (type(expected_attempt) is not str or not expected_attempt or
                type(expected_request_digest) is not str or
                type(minimum_sequence) is not int or minimum_sequence < 1 or
                record['attemptId'] != expected_attempt or
                record['requestDigest'] != expected_request_digest or
                record['sequence'] < minimum_sequence or
                not record['approvalConsumed']):
            return UNCERTAIN
        if record['phase'] == 'SETTLED_UNVERIFIED' and record['terminalRecordDigest'] is not None:
            return 'SETTLED_RECORD_PRESENT_UNVERIFIED'
        if record['phase'] == 'EFFECT_OBSERVED_UNVERIFIED':
            return 'EFFECT_OBSERVED_UNVERIFIED'
    except (ValueError, TypeError, UnicodeError, KeyError, OverflowError):
        pass
    return UNCERTAIN
