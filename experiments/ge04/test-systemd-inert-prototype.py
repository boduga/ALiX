#!/usr/bin/env python3
"""GE-04 systemd inert-service prototype policy/parse regression.

No unit is installed, started, enabled or executed by this test.
"""
import configparser
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys

base = Path(__file__).resolve().parent
unit = base / 'alix-ge04-inert-supervisor.service'
parser = configparser.ConfigParser(interpolation=None, strict=True)
parser.optionxform = str
with unit.open(encoding='utf-8') as stream:
    parser.read_file(stream)
assert set(parser.sections()) == {'Unit', 'Service'}, 'unit must not have [Install] activation'
service = parser['Service']
expect = {
    'Type': 'exec', 'User': 'root', 'Group': 'root', 'Restart': 'no',
    'NoNewPrivileges': 'yes', 'ProtectSystem': 'strict', 'ProtectHome': 'yes',
    'PrivateTmp': 'yes', 'PrivateDevices': 'yes', 'RestrictNamespaces': 'yes',
    'RestrictSUIDSGID': 'yes', 'KillMode': 'control-group',
    'RuntimeDirectoryMode': '0700', 'StateDirectoryMode': '0700',
    'CapabilityBoundingSet': '', 'AmbientCapabilities': '',
    'RestrictAddressFamilies': 'AF_UNIX', 'UMask': '0077',
}
for key, value in expect.items():
    assert service.get(key) == value, (key, service.get(key), value)
assert service['ExecStart'] == (
    '/usr/bin/python3 -I -B /opt/alix/ge04/managed-supervisor-entry.py '
    '/etc/alix-ge04-inert/bootstrap.json')
assert '/opt/alix/ge04' not in service['ReadWritePaths']
assert '/etc/alix-ge04-inert' not in service['ReadWritePaths']
assert parser['Unit']['ConditionPathExists'] == '/etc/alix-ge04-inert/bootstrap.json'
assert parser['Unit']['StartLimitBurst'] == '1'

if sys.platform == 'linux' and shutil.which('systemd-analyze'):
    result = subprocess.run(['systemd-analyze', 'verify', str(unit)],
                            capture_output=True, text=True, timeout=12)
    assert result.returncode == 0, (result.stdout, result.stderr)

spec = importlib.util.spec_from_file_location(
    'ge04_managed_startup', base / 'managed-supervisor-entry.py')
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)
try:
    entry.verify_startup('/etc/alix-ge04-inert/bootstrap.json')
except (PermissionError, FileNotFoundError, OSError):
    pass
else:
    raise AssertionError('non-provisioned bootstrap was accepted')

print('GE04 systemd inert prototype PASS: non-installable unit; hardened policy; provisioned bootstrap required')
