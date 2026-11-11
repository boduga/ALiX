#ifndef GE04_DIAGNOSTIC_FD_WAIT_H
#define GE04_DIAGNOSTIC_FD_WAIT_H
#include "diagnostic-deadline.h"
#include <poll.h>
/* Unprivileged readiness diagnostic. Requires O_NONBLOCK; never performs I/O.
 * Does NOT make a later read/write/connect/send safe or authorize anything.
 */
int ge04_diagnostic_wait_fd(struct ge04_diagnostic_deadline *deadline,
                            int fd, short events);
/* cancel_fd: nonblocking readable pipe/eventfd owned by caller; cancellation wins.
 * -1 disables cancellation. Caller must retain original descriptor custody. */
int ge04_diagnostic_wait_fd_cancel(struct ge04_diagnostic_deadline *deadline,
                                   int fd, short events, int cancel_fd);
#endif
