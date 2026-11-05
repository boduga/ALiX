#!/usr/bin/env python3
"""SUP-22 experimental pidfd lifecycle pin for an inert datagram sender.

This is observation only, not an atomic authorization check or a production
security boundary. The fixture provisioner pins a live PID before use.
"""
import importlib.util
import os
from pathlib import Path
import select
import sys


def _load(filename):
    spec = importlib.util.spec_from_file_location(
        'ge04_sup22_' + filename.replace('-', '_'),
        Path(__file__).with_name(filename + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


role = _load('supervisor-role-observation')
message = _load('kernel-message-credentials')


class PinnedSender:
    def __init__(self, pid, uid):
        if (sys.platform != 'linux' or not hasattr(os, 'pidfd_open') or
                type(pid) is not int or pid <= 0 or
                type(uid) is not int or uid < 0):
            raise ValueError('Linux positive PID and nonnegative UID required')
        self.pid = pid
        self.uid = uid
        self.fd = os.pidfd_open(pid, 0)
        self.closed = False
        try:
            self.exe, self.birth = role.snapshot(pid)
            self.verify()
        except BaseException:
            self.close()
            raise

    def verify(self):
        if self.closed:
            raise PermissionError('sender pin closed')
        # An exited or reaped process makes its pidfd readable. Do not trust
        # a matching numeric PID after the original process has exited.
        poller = select.poll()
        poller.register(self.fd, select.POLLIN | select.POLLHUP | select.POLLERR)
        if poller.poll(0):
            raise PermissionError('pinned sender has exited')
        try:
            if role.snapshot(self.pid) != (self.exe, self.birth):
                raise PermissionError('process birth/executable changed')
        except (FileNotFoundError, ProcessLookupError):
            raise PermissionError('pinned sender no longer exists') from None
        if poller.poll(0):
            raise PermissionError('pinned sender exited during inspection')

    def receive(self, receiver):
        self.verify()
        payload = message.receive_inert_message(receiver, self.uid, self.pid)
        self.verify()
        return payload

    def close(self):
        if not self.closed:
            self.closed = True
            os.close(self.fd)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()
