/* GE-04 Phase 3B4: native prepared fixed request, NOT dispatched.
 * No StartTransientUnit call is sent. Nothing here can create or adopt a
 * unit, issue a request cookie or authorize phase ACK.
 */
#define _GNU_SOURCE
#include "protected-dispatch-preparation.h"
#include "protected-systemd-request.h"
#include <errno.h>
#include <string.h>
#include <unistd.h>

#define MANAGER_PATH "/org/freedesktop/systemd1"
#define MANAGER_IFACE "org.freedesktop.systemd1.Manager"
#define EXPECTED_SIGNATURE "ssa(sv)a(sa(sv))"

static int refuse(struct ge04_systemd_transaction *tx) {
    if (tx) tx->poisoned = 1;
    errno = EPERM;
    return -1;
}
static int root_identity(void) {
    return getuid() == 0 && geteuid() == 0 &&
           getgid() == 0 && getegid() == 0;
}
void ge04_prepared_dispatch_init(struct ge04_prepared_dispatch *out) {
    if (!out) return;
    out->message = NULL;
    out->prepared = 0;
}
void ge04_prepared_dispatch_close(struct ge04_prepared_dispatch *out) {
    if (!out) return;
    if (out->prepared == 1 && out->message)
        sd_bus_message_unref(out->message);
    ge04_prepared_dispatch_init(out);
}
static int expected_headers(sd_bus_message *message,
                            const struct ge04_systemd_transaction *tx) {
    const char *destination = sd_bus_message_get_destination(message);
    const char *path = sd_bus_message_get_path(message);
    const char *interface = sd_bus_message_get_interface(message);
    const char *member = sd_bus_message_get_member(message);
    return sd_bus_message_get_bus(message) == tx->bus &&
           destination && strcmp(destination, tx->owner) == 0 &&
           path && strcmp(path, MANAGER_PATH) == 0 &&
           interface && strcmp(interface, MANAGER_IFACE) == 0 &&
           member && strcmp(member, "StartTransientUnit") == 0 &&
           sd_bus_message_has_signature(message, EXPECTED_SIGNATURE) == 1;
}
int ge04_prepare_fixed_dispatch(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx,
    struct ge04_prepared_dispatch *out) {
    if (!root_identity() || !claim || !attempt || !journal || !tx ||
        !out || out->prepared || out->message ||
        tx->poisoned || !tx->subscribed || !tx->bus || !tx->job_slot ||
        !tx->owner[0] || tx->request_in_flight || tx->request_cookie ||
        tx->reply_bound || tx->job_seen || tx->job_done_claimed)
        return refuse(tx);

    if (ge04_systemd_recheck_original(claim, attempt, journal, tx) < 0)
        return refuse(tx);
    sd_bus_message *message = NULL;
    int r = sd_bus_message_new_method_call(
        tx->bus, &message, tx->owner, MANAGER_PATH, MANAGER_IFACE,
        "StartTransientUnit");
    if (r < 0 || !message) {
        sd_bus_message_unref(message);
        return refuse(tx);
    }
    r = ge04_append_fixed_transient_request(message);
    if (r < 0 || !expected_headers(message, tx) ||
        ge04_systemd_recheck_original(claim, attempt, journal, tx) < 0) {
        sd_bus_message_unref(message);
        return refuse(tx);
    }
    out->message = message;
    out->prepared = 1;
    /* Preparation does NOT set request_in_flight or request_cookie.
     * No queued/sent request exists and no protected authority results.
     */
    return 0;
}
int ge04_dispatch_prepared(
    struct ge04_systemd_transaction *tx,
    struct ge04_prepared_dispatch *out) {
    (void)out;
    return refuse(tx); /* SECURITY HOLD: no sd_bus_send or method call. */
}
