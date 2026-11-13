/* GE-04 credential-free transport building block. NOT production admission. */
#ifndef GE04_WORKER_STREAM_H
#define GE04_WORKER_STREAM_H
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define GE04_STREAM_MAX_PAYLOAD 65536U
enum { GE04_STREAM_OK=0, GE04_STREAM_DENIED=1, GE04_STREAM_TIMEOUT=2 };
enum { GE04_STREAM_FRESH=0, GE04_STREAM_OPEN=1, GE04_STREAM_FAILED=2, GE04_STREAM_CLOSED=3 };
struct ge04_stream_peer { pid_t pid; uid_t uid; gid_t gid; uint64_t start_ticks; };
struct ge04_stream_session {
 int fd, pidfd, cancel_fd, state;
 struct ge04_stream_peer peer;
 unsigned saw_ctrunc; /* Diagnostic only, never authorization evidence. */
};
#define GE04_STREAM_SESSION_INIT { .fd=-1, .pidfd=-1, .cancel_fd=-1, .state=GE04_STREAM_FRESH }

/* Trusted caller supplies registration provenance; PID arguments are not authority.
 * Borrowed listener: exclusive, nonblocking, listening AF_UNIX stream, PASSCRED
 * enabled before traffic. Borrowed cancel_fd: private FIFO read end; bytes/HUP
 * permanently deny. Session owns accepted FD and pidfd, closes them on failure.
 * Only a fresh initialized session can accept. No reset/reconnect API.
 * Operations are single-owner, with 100..5000ms IPC budgets (not task lifetime).
 */
int ge04_stream_accept(struct ge04_stream_session *, int listener, int cancel_fd,
 const struct ge04_stream_peer *, int timeout_ms);
/* buffer capacity >= MAX_PAYLOAD; length=0 and bounded buffer cleared on failure. */
int ge04_stream_read(struct ge04_stream_session *, unsigned char *buffer,
 size_t capacity, size_t *length, int timeout_ms);
int ge04_stream_write(struct ge04_stream_session *, const unsigned char *buffer,
 size_t length, int timeout_ms);
void ge04_stream_destroy(struct ge04_stream_session *);
#endif
