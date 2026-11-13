"""Shared fail-closed entry guard for GE-04 read-only diagnostic observers."""
import os
import sys


def require_unprivileged():
    if (sys.platform != 'linux' or os.getuid() == 0 or os.geteuid() == 0
            or os.getgid() == 0 or os.getegid() == 0):
        raise PermissionError('GE-04 unprivileged bounded observation required')
