/* GE-04 Phase 3B3: read-only post-job systemd unit observation.
 *
 * NO unit creation, service admission or phase ACK. A stable matching
 * postbirth unit remains UNQUALIFIED: kernel resources, original exclusive
 * creation and the keeper's generation are independently unproven.
 */
#include "protected-systemd-birth-observer.h"
#include "protected-prebirth-journal.h"
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define MANAGER_PATH "/org/freedesktop/systemd1"
#define MANAGER_IFACE "org.freedesktop.systemd1.Manager"
#define UNIT_IFACE "org.freedesktop.systemd1.Unit"
#define SERVICE_IFACE "org.freedesktop.systemd1.Service"
#define FIXED_UNIT_PATH "/org/freedesktop/systemd1/unit/ge04_2dr1b2_2dview_2dqualification_2eservice"
#define FIXED_CGROUP "/system.slice/" GE04_PREBIRTH_UNIT

static int deny(struct ge04_systemd_transaction *tx) {
    if (tx) tx->poisoned = 1;
    errno = EPERM;
    return -1;
}

static int get_exact_string(sd_bus *bus, const char *owner,
                            const char *interface, const char *property,
                            const char *expected) {
    char *value = NULL;
    int r = sd_bus_get_property_string(bus, owner, FIXED_UNIT_PATH,
                                        interface, property, NULL, &value);
    int ok = r >= 0 && value && strcmp(value, expected) == 0;
    free(value);
    return ok ? 0 : -1;
}

static int get_invocation(sd_bus *bus, const char *owner, char out[33]) {
    sd_bus_message *reply = NULL;
    int r = sd_bus_get_property(bus, owner, FIXED_UNIT_PATH, UNIT_IFACE,
                                "InvocationID", NULL, &reply, "ay");
    if (r < 0 || !reply) {
        sd_bus_message_unref(reply);
        return -1;
    }
    const void *bytes = NULL;
    size_t size = 0;
    r = sd_bus_message_read_array(reply, 'y', &bytes, &size);
    if (r < 0 || size != 16 || !bytes) {
        sd_bus_message_unref(reply);
        return -1;
    }
    static const char hex[] = "0123456789abcdef";
    const uint8_t *data = bytes;
    int nonzero = 0;
    for (size_t i = 0; i < 16; ++i) {
        nonzero |= data[i];
        out[2 * i] = hex[data[i] >> 4];
        out[2 * i + 1] = hex[data[i] & 15];
    }
    out[32] = 0;
    sd_bus_message_unref(reply);
    return nonzero ? 0 : -1;
}

static int sample(struct ge04_systemd_transaction *tx,
                  struct ge04_unqualified_birth_view *view) {
    sd_bus_message *reply = NULL;
    const char *path = NULL;
    int r = sd_bus_call_method(tx->bus, tx->owner, MANAGER_PATH,
                               MANAGER_IFACE, "GetUnit", NULL, &reply,
                               "s", GE04_PREBIRTH_UNIT);
    if (r < 0 || !reply) {
        sd_bus_message_unref(reply);
        return -1;
    }
    r = sd_bus_message_read(reply, "o", &path);
    int correct_path = r >= 0 && path &&
                       strcmp(path, FIXED_UNIT_PATH) == 0;
    sd_bus_message_unref(reply);
    if (!correct_path ||
        get_exact_string(tx->bus, tx->owner, UNIT_IFACE, "Id",
                         GE04_PREBIRTH_UNIT) < 0 ||
        get_exact_string(tx->bus, tx->owner, UNIT_IFACE, "LoadState",
                         "loaded") < 0 ||
        get_exact_string(tx->bus, tx->owner, UNIT_IFACE, "ActiveState",
                         "active") < 0 ||
        get_exact_string(tx->bus, tx->owner, UNIT_IFACE, "SubState",
                         "running") < 0 ||
        get_exact_string(tx->bus, tx->owner, SERVICE_IFACE, "ControlGroup",
                         FIXED_CGROUP) < 0)
        return -1;
    uint32_t pid = 0, restarts = UINT32_MAX;
    if (sd_bus_get_property_trivial(tx->bus, tx->owner, FIXED_UNIT_PATH,
                                    SERVICE_IFACE, "MainPID", NULL,
                                    'u', &pid) < 0 ||
        sd_bus_get_property_trivial(tx->bus, tx->owner, FIXED_UNIT_PATH,
                                    SERVICE_IFACE, "NRestarts", NULL,
                                    'u', &restarts) < 0 ||
        pid < 2 || pid > INT32_MAX || restarts != 0 ||
        get_invocation(tx->bus, tx->owner, view->invocation) < 0)
        return -1;
    view->main_pid = pid;
    view->unqualified = 1;
    return 0;
}

int ge04_observe_unqualified_postbirth(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx,
    struct ge04_unqualified_birth_view *view) {
    if (!view) return deny(tx);
    memset(view, 0, sizeof(*view));
    if (!claim || !attempt || !journal || !tx ||
        !tx->request_in_flight || !tx->request_cookie ||
        !tx->reply_bound || !tx->job_seen || !tx->job_done_claimed ||
        tx->poisoned || !tx->subscribed || !tx->bus || !tx->job_slot)
        return deny(tx);
    struct ge04_unqualified_birth_view first = {0};
    struct ge04_unqualified_birth_view second = {0};
    if (ge04_systemd_recheck_original(claim, attempt, journal, tx) < 0 ||
        sample(tx, &first) < 0 ||
        ge04_systemd_recheck_original(claim, attempt, journal, tx) < 0 ||
        sample(tx, &second) < 0 ||
        ge04_systemd_recheck_original(claim, attempt, journal, tx) < 0 ||
        !first.unqualified || !second.unqualified ||
        first.main_pid != second.main_pid ||
        strcmp(first.invocation, second.invocation) != 0)
        return deny(tx);
    *view = second;
    return 0; /* STILL UNQUALIFIED. No release, ACK or birth ownership. */
}
